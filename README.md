# SSPlugin

把 dsh-superagent 相关的 skill 打包成插件，同时支持 **Claude Code** 与 **Cursor**。

当前插件：

| 插件 | 内容 | 说明 |
|---|---|---|
| [`multiple-dsh-superagents`](plugins/multiple-dsh-superagents) | skills ×2 | 多台 dsh-superagent 的部署运维与看板：一个实例只盯一个 GitHub 仓库，实例间靠 profile / 端口 / stateDir / Agent 账号隔离。 |

### 插件里的两个 Skill

| Skill | 定位 | 能力 |
|---|---|---|
| [`multiple-dsh-superagents`](plugins/multiple-dsh-superagents/skills/multiple-dsh-superagents/SKILL.md) | **做加法**：部署与运维 | 新增实例、配置迁移、批量启停巡检、setup 排错、Management API 速查；只改实例，不提供界面 |
| [`superagent-dashboard`](plugins/multiple-dsh-superagents/skills/superagent-dashboard/SKILL.md) | **做观察与开关**：本机看板 | 零依赖 Node 控制台：实例列表、24h 触发/评估/执行中/待人工、一键启停；“跳到面板标签”需要可选补丁（安装器随 skill 分发，由使用者决定是否装、装到哪个 checkout） |

两者的衔接点是 `~/.dsh/superagent-fleet.json`：fleet skill 写入实例清单，看板读同一份清单并聚合各实例的 `/orchestrator/api/*`。看板不复制状态，只做视图与开关。

```bash
# 看板（零依赖，Node 22+）
cd plugins/multiple-dsh-superagents/skills/superagent-dashboard/console
node server.mjs        # → http://127.0.0.1:3099/
```

## 安装

### Claude Code

```bash
# 1. 添加本仓库为 marketplace
/plugin marketplace add https://github.com/shishuai2016/SSPlugin.git

# 2. 安装插件
/plugin install multiple-dsh-superagents@ssplugin

# 3. 开启自动更新（推荐）
#    /plugin → Marketplaces → 选中 ssplugin → Enable auto-update
```

本地调试可直接指向工作区路径：

```bash
/plugin marketplace add /Users/<you>/work/code/SSPlugin
```

### Cursor

在**目标项目**根目录的 `.cursor/settings.json` 里声明插件：

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

`gitRef` 跟着分支走（本仓库默认 `main`），重启 Cursor 即拉取最新内容。

## 仓库结构

单源双清单：内容只存一份，两个 IDE 各一份薄清单。

```
SSPlugin/
├── .claude-plugin/marketplace.json     # Claude Code marketplace 清单
├── .cursor-plugin/marketplace.json     # Cursor marketplace 清单
└── plugins/
    └── multiple-dsh-superagents/
        ├── .claude-plugin/plugin.json  # Claude Code 插件清单
        ├── .cursor-plugin/plugin.json  # Cursor 插件清单
        ├── README.md
        └── skills/
            ├── multiple-dsh-superagents/          # 部署与运维
            │   ├── SKILL.md
            │   └── references/management-api.md
            └── superagent-dashboard/              # 本机看板
                ├── SKILL.md
                ├── patch/panel-deeplink.patch      # 可选：面板深层链接
                └── console/
                    ├── server.mjs
                    ├── deeplink.mjs                # 补丁安装器
                    └── public/index.html
```

## 新增插件

1. 新建 `plugins/<name>/`，按需放 `skills/`、`agents/`、`rules/`、`commands/`、`hooks/`。
2. 写 `.claude-plugin/plugin.json`，用相对路径引用资产（`"skills": "./skills/"`）。
3. 写 `.cursor-plugin/plugin.json`，字段同上，另加 `displayName`；Cursor 不支持的 Claude 专属文件（`mcp-claude.json`、`.claude*`）不要引用。
4. 在两个 `marketplace.json` 的 `plugins` 数组里各加一条 `{name, source, description}`。
5. 本地自检：`skills/<dir>` 目录名与 SKILL.md frontmatter 的 `name` 必须一致，清单里引用的路径必须存在。
