---
name: superagent-dashboard
version: 1.0.0
description: "本机网页控制台 SuperagentDashboard：把多台 dsh-superagent 实例聚合成一个页面，看列表、24 小时触发/评估/执行中/待人工，一键跳到对应面板标签，一键启停。用在「superagent 看板/控制台/总览」「几台 superagent 一起看」「启停某个实例」「打开它的面板」这类请求；反触发：只想改某个实例的配置或排查单条工单（那走面板或 Management API），或者根本还没装 superagent。"
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

## 深层链接（跳标签）

控制台的指标链接指向 `/panel/<profile>?tab=triggers|evals|executions|person`，服务端 302 到：

```
http://127.0.0.1:<port>/?token=…#trigger?filter=recent
                                #eval?window=24h
                                #execution?filter=working|person
```

面板侧原本**只有 sessionStorage 路由**，不接受 URL 定位。这条能力依赖 checkout 里的客户端补丁：

- `src/client/route.ts` — `routeFromUrl()`，`initialLocation()` 优先解析 hash / `?tab=`
- `src/client/index.tsx` — 命中深层链接时 `layout.selectPanel('dsh-superagent')`

补丁文件：`<checkout>/patches/panel-deeplink.patch`。改完要 `pnpm build` 并重启实例；上游 `git pull` 后需要 `git apply` 重放。

## 排障

| 症状 | 处理 |
|---|---|
| 端口被占 | `PORT=4001 node server.mjs`，或 `lsof -ti tcp:3099 \| xargs kill` |
| 卡片显示「已停止」但进程在 | 端口与清单 `port` 不一致；核对 `config.json` 里的 `port` |
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
