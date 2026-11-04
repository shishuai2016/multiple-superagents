---
name: superagent-dashboard
version: 1.0.0
description: "本机网页控制台：一屏看多台 dsh-superagent 的状态、24h 触发/评估/执行中/待人工，一键跳面板标签、一键启停。用在「superagent 看板/控制台/总览」「几台一起看」「启停某个实例」。反触发：改实例配置或查单条工单（走面板或 Management API）。"
metadata:
  requires:
    bins: ["node"]
---

# SuperagentDashboard

一个**只读聚合 + 启停**的本机网页控制台：不复制任何 superagent 状态，只把各实例自己的管理 API 和启停脚本汇总到一页。

```
浏览器 → 127.0.0.1:3099 ─┬→ 3082 /orchestrator/api/*   （状态、触发、评估、工单）
                        ├→ 3083 /orchestrator/api/*
                        ├→ 3084 /orchestrator/api/*
                        └→ scripts/dsh-superagent start|stop|restart
```

## 何时用 / 何时不用

| 场景 | 用不用 |
|---|---|
| 想知道一共有几台、各自活着没有 | ✅ |
| 想知道最近的触发、评估、执行中、待人工 | ✅ |
| 想启停某一台 / 全部 | ✅ |
| 想跳到某台面板的某个标签 | ✅ |
| 想改某台的策略、提示词、来源配置 | ❌ 用面板或 Management API |
| 只想看某一条工单的细节 | ❌ 用面板 Execution 标签 |

## 快速开始

代码在本 skill 目录的 `console/` 下（Claude Code 里 `${CLAUDE_PLUGIN_ROOT}` 指向插件根）：

```bash
cd "${CLAUDE_PLUGIN_ROOT}/skills/superagent-dashboard/console"
node server.mjs                 # → http://127.0.0.1:3099/
PORT=4000 node server.mjs       # 换端口
```

源码仓库里则是：

```bash
cd plugins/multiple-dsh-superagents/skills/superagent-dashboard/console
node server.mjs
```

后台常驻：

```bash
nohup node server.mjs > ~/.dsh/fleet-console.log 2>&1 &
lsof -ti tcp:3099 | xargs kill   # 停止
```

前置条件：

- `~/.dsh/superagent-fleet.json` 里登记了实例（这个文件由 superagent 的部署流程维护）
- 每个实例的 `scripts/dsh-superagent` 存在于清单的 `checkout` 字段所指目录（缺省 `~/work/code/dsh-superagent`）

## 页面能做什么

每台实例一张卡片：

| 元素 | 含义 |
|---|---|
| 状态点 | 绿=正常，黄=有问题（卡片下方列 `⚠`），灰=已停止 |
| 健康 chip | GitHub / 飞书来源状态；其它内部健康项仅在异常时显示 |
| **触发 24h** | 最近 24 小时收到的消息数（点击→面板「触发」标签） |
| **评估 24h** | 最近 24 小时判定次数（点击→「评估」标签） |
| **执行中** | `运行中/并发上限`（点击→「执行」标签，筛 working） |
| **待人工** | 卡在等人处理的工单数（点击→「执行」标签，筛 person） |
| 打开面板 | 跳该实例面板；token 从最新日志现取，重启后自动更新 |
| 启动 / 停止 / 重启 | 调用官方脚本，停止前弹确认 |

页面每 3 秒自动刷新，可关闭。

## 数据来源

| 用途 | 来源 |
|---|---|
| 实例清单 | `~/.dsh/superagent-fleet.json`（`FLEET_FILE` 可覆盖） |
| 运行状态、健康、负载 | `GET /orchestrator/api/state` |
| 触发 / 评估 / 执行 / 待人工 | `GET /orchestrator/api/overview`（24 小时窗口） |
| 来源统计 | `GET /orchestrator/api/sources` |
| 面板 token | `<checkout>/.artifacts/dsh-superagent-<profile>-*.log` 最新一条 |
| 启停 | `<checkout>/scripts/dsh-superagent --profile <p> --url …` |

## 深层链接（跳标签）— 可选，需要先问用户

控制台的四个指标是链接，指向：

```
/panel/<profile>?tab=triggers|evals|executions|person
  → 302 → http://127.0.0.1:<port>/?token=…#trigger?filter=recent
                                          #eval?window=24h
                                          #execution?filter=working|person
```

面板本身**没有 URL 路由**：标签只存在内存 + sessionStorage，主面板选择刷新即回 Conversation。所以“一键定位”依赖一个 78 行的客户端补丁，打在 `dsh-superagent` 的检出目录里：

- `src/client/route.ts` — `routeFromUrl()`，`initialLocation()` 优先解析 hash / `?tab=`
- `src/client/index.tsx` — 命中深层链接时 `layout.selectPanel('dsh-superagent')`

### 先问，再改

这是改别人的代码，动手前必须问清两件事：

1. **要不要装**：不装的话看板仍可用，只是“跳转”退化成“打开面板首页 → 点侧栏图标 → 点标签”（多两次点击，不会报错）。
2. **作用在哪个 checkout**：默认取舰队清单里的 `checkout`，用户也可以给绝对路径。

补丁随插件分发：`patch/panel-deeplink.patch`；安装器在 `console/deeplink.mjs`（零依赖）。

### 检测与应用

```bash
cd "${CLAUDE_PLUGIN_ROOT}/skills/superagent-dashboard/console"

node deeplink.mjs status                     # 目录存在 / 已应用 / 已构建 / 工作区干净
node deeplink.mjs status --dir ~/work/code/dsh-superagent

node deeplink.mjs apply --dir <checkout> --build   # 应用 + pnpm build
node deeplink.mjs revert --dir <checkout>          # 反向应用
```

`apply` 之后必须**重启实例**，再让用户**硬刷新**面板页（⌘⇧R）。

### 失败与回退

- `git apply` 失败（上游版本变了）：脚本打印被拒片段，提示手工合并或 `git apply --reject`；不会强行改文件。
- 回退：`revert` 只做反向 patch，不动别的文件；若文件已被手工改过会失败，并提示 `git checkout -- src/client/route.ts src/client/index.tsx`。
- 升级上游后：`git pull` 会覆盖补丁，重新 `apply` 即可。

### 看板如何知道有没有装

`server.mjs` 会读 `<checkout>/src/client/route.ts` 判断补丁在不在，`/api/fleet` 里每台实例带 `deepLinks: true|false`。没装时页面顶部会出现一条黄色提示，链接的 tooltip 也会说明“只会打开面板首页”。

## 排障

| 症状 | 处理 |
|---|---|
| 端口被占 | `PORT=4001 node server.mjs`，或 `lsof -ti tcp:3099 \| xargs kill` |
| 卡片显示「已停止」但进程在 | 端口与清单 `port` 不一致；核对 `config.json` 里的 `port` |
| 页面 500 或 `ENOENT … public/index.html` | 控制台进程是旧路径启动的（目录被移动/重命名过）：`lsof -ti tcp:3099 \| xargs kill`，然后在新目录重跑 `node server.mjs` |
| 「打开面板」404 | 日志里还没有 token；实例启动后日志会打印一行带 token 的 URL |
| 面板页 404 / 空白 | token 过期（每次重启都变）；从控制台重新点「打开面板」 |
| 面板报 `Failed to load plugins` / `entry did not activate` | 客户端 bundle 换了但页面是旧的：硬刷新（⌘⇧R）；仍失败看浏览器控制台第一条异常 |
| 面板报 `web boot: … failed` 且刚改过客户端代码 | 检查 `ctx.xxx` 服务是否都在插件 `inject` 里声明——Cordis 对未声明服务取值会抛异常，`?.` 挡不住 |
| 改了 `observe*` 后指标不动 | 观察流关闭时只有 @ 与工单线程会进；见 fleet skill |
| 启停按钮转圈很久 | 启动要等健康检查，约 10–30 秒；接口超时上限 120 秒 |

## 安全

- 只监听 `127.0.0.1`，并校验 Host 头；不接受外部访问。
- 不做鉴权：本机任何进程都能调，和直接读 `~/.dsh` 等价。
- 停止是优雅的：正在跑的 Executor 会先完成当前步骤；停止后自动救援暂停，只有 `start/restart` 能恢复。
