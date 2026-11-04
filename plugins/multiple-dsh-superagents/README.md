# multiple-dsh-superagents

把 dsh-superagent 当成**一支 Agent 舰队**来管理：一个实例 = 一个仓库，实例之间靠 profile / 端口 / stateDir / Agent 账号四样东西隔离。

插件包含两个 skill，覆盖“部署运维”和“日常看板”两件事：

| Skill | 干什么 | 触发示例 |
|---|---|---|
| [`multiple-dsh-superagents`](skills/multiple-dsh-superagents/SKILL.md) | 新增实例、迁移配置、批量启停巡检、setup 排错 | 「再开一个 superagent 盯 xxx」「实例 status 退 3」 |
| [`superagent-dashboard`](skills/superagent-dashboard/SKILL.md) | 本机网页控制台：一屏看全部实例、一键跳面板、一键启停 | 「打开 superagent 看板」「几台一起看」「停掉某一个」 |

## 什么时候触发

- 再开一个 superagent、给另一个仓库部署第二个实例 → `multiple-dsh-superagents`
- 把已有实例的配置迁移 / 复制到新实例 → `multiple-dsh-superagents`
- 批量启停、巡检、升级 → 看板或 fleet skill 都行
- 实例 `setup` 报错、`status` 退出码异常、工单不出现、飞书不回 → `multiple-dsh-superagents`
- 想一屏看所有实例的触发 / 评估 / 执行中 / 待人工，并跳进对应面板 → `superagent-dashboard`

**不触发**：只想问架构原理，或只是给已在跑的实例提一条需求——那走 GitHub Issue / 飞书入口，不建实例。

## 两个 Skill 的关系

```
multiple-dsh-superagents   做“加法”：建实例、改配置、修故障
        │  写入 ~/.dsh/superagent-fleet.json（实例清单）
        ▼
superagent-dashboard       做“观察与开关”：读清单 + 各实例 API，启停、跳面板
```

看板不复制任何状态，只聚合；它读的清单正是 fleet skill 维护的那一份。所以先有实例，看板才有内容。

## 前置依赖

| 依赖 | 版本 | 谁需要 |
|---|---|---|
| `dsh` | 满足 dsh-superagent 仓库 `engines.dsh`（当前 `^0.2.1-alpha.2`） | 两个 skill |
| `pnpm` / `git` / `tmux` / `gh` | pnpm 可用、git 2.32+、gh 2.48+ | `multiple-dsh-superagents` |
| `node` | 22+（看板零依赖，只用内置 `http` 与 `fetch`） | `superagent-dashboard` |

另外需要能访问 `github.com` 与 `api.github.com`（国内 DNS 污染是高频坑，fleet SKILL.md §3 给了处理方案）。

## 文件

| 路径 | 作用 |
|---|---|
| `skills/multiple-dsh-superagents/SKILL.md` | 主流程：判断任务 → 铁律 → 信息采集 → 前置检查 → 新增实例六步 → 日常运维 → 排错 |
| `skills/multiple-dsh-superagents/references/management-api.md` | 面板同款本地 HTTP API：读状态、取 revision、写 settings / prompts |
| `skills/superagent-dashboard/SKILL.md` | 看板：启动、能力、数据来源、深层链接、排障 |
| `skills/superagent-dashboard/console/server.mjs` | 控制台服务（零依赖 Node，聚合 API + 启停 + 日志取 token） |
| `skills/superagent-dashboard/console/deeplink.mjs` | 可选补丁安装器：status / apply / revert，可指定 checkout 目录 |
| `skills/superagent-dashboard/patch/panel-deeplink.patch` | 面板深层链接补丁（78 行，两个客户端文件） |
| `skills/superagent-dashboard/console/public/index.html` | 单页 UI（列表、四个指标、跳转、启停） |

## 安装

### Claude Code

```bash
/plugin marketplace add https://github.com/shishuai2016/SSPlugin.git
/plugin install multiple-dsh-superagents@ssplugin
```

### Cursor

在目标项目 `.cursor/settings.json`：

```json
{
  "plugins": {
    "ssplugin/multiple-dsh-superagents": {
      "enabled": true,
      "gitUrl": "https://github.com/shishuai2016/SSPlugin.git",
      "gitRef": "main",
      "gitPath": "plugins/multiple-dsh-superagents"
    }
  }
}
```

## 用法

装好后直接说人话即可：

- 「再开一个 superagent 盯 `owner/repo`」→ 走 fleet 流程（铁律核对 → 一次问一项 → 给计划）
- 「打开 superagent 看板」→ 启动 `console/server.mjs`，给出 `http://127.0.0.1:3099/`
- 「停掉 SSPlugin 那个实例」→ 看板或脚本 `stop`，会先等当前步骤跑完

## 可选：让看板“跳到面板标签”

默认不装补丁时，看板全部功能可用，只是点指标会打开**面板首页**（DSH 主面板选择只在内存，刷新回 Conversation；面板不接受 URL 路由）。

想让“触发 / 评估 / 执行中 / 待人工”一点直达标签，再装这个补丁——它是改 `dsh-superagent` 检出目录里的两个客户端文件，所以**由使用者决定是否安装、装到哪个目录**：

```bash
cd skills/superagent-dashboard/console
node deeplink.mjs status --dir <你的 dsh-superagent 目录>
node deeplink.mjs apply  --dir <你的 dsh-superagent 目录> --build
node deeplink.mjs revert --dir <你的 dsh-superagent 目录>
```

看板会读 `<checkout>/src/client/route.ts` 自动判断装没装：`/api/fleet` 里带 `deepLinks` 字段，没装的实例在页面顶部有黄色提示。细节见 `superagent-dashboard/SKILL.md` 的「深层链接」一节。

## 维护

两个 `SKILL.md` 各自是唯一真相。fleet 的流程改动只动 `skills/multiple-dsh-superagents/`；看板的实现改动只动 `skills/superagent-dashboard/console/`。
