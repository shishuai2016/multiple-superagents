---
name: multiple-dsh-superagents
version: 1.0.0
description: "部署和管理多台 dsh-superagent 实例（一实例一 GitHub 仓库）：新增、迁移配置、批量启停巡检、修复 setup。触发：再开一个 superagent、部署第二个实例、fleet、多仓库。反触发：只问原理，或给已有实例提需求（走 GitHub/飞书入口）。"
metadata:
  requires:
    bins: ["dsh", "pnpm", "git", "tmux", "gh"]
---

# multiple-dsh-superagents

把 dsh-superagent 当成"一支 Agent 舰队"来管理：**一个实例 = 一个仓库**，实例之间靠 profile / 端口 / stateDir / Agent 账号四样东西隔离。

## 先判断本轮任务

| 用户想做的事 | 走哪节 |
| --- | --- |
| 新增一个盯某仓库的实例 | §2 → §5 |
| 已有实例配置错、setup 报错 | §7 |
| 启停、巡检、升级 | §6 |
| 只想提需求 | 不要建实例：让对方在 GitHub Issue/评论 @ Agent，或飞书私聊 bot |

## §1 铁律（先读，违反会造成不可逆损坏）

1. **一个实例只服务一个仓库。** `Source:github` 只有一个 `repository` 字段。多仓库 = 多实例，不要试图在一个 profile 里插两个 github Source（`policy.sources` 只有 `github`/`feishu` 两个键，`DSH_SUPERAGENT_GITHUB_REPOSITORY` 只有一份，会互相覆盖）。
2. **`dsh superagent --from-default-profile` 会重建 profile 并删掉它的 `cordis.patch.yml`。** 只用于全新实例。已有实例升级/修改只能编辑该文件。
3. **Agent 账号必须与操作者账号不同。** 触发器靠"Agent 账号的 GitHub 通知"，自己 @ 自己不会产生通知。若用户坚持用自己账号，必须打开 `observeIssues/observePulls/observeComments` 全量观察开关，并明确告知噪音与 token 成本。
4. **四样隔离物缺一不可**：profile 名、端口、`stateDir`、Agent 账号（含独立的 `GH_CONFIG_DIR` wrapper）。共用 stateDir 会撞锁和 sqlite；共用账号会互相抢通知并标记已读。
5. **不要问 secret**。App Secret / token 一律让用户在**自己的终端**用 stdin 输入，不进聊天记录。
6. **只有 NEW 才建**：`stateDir` 路径必须是绝对路径，且不能指向另一个实例的目录。

## §2 信息采集（一次问一项，等回答再问下一项）

按下面的节奏：**每个问题单独一条消息、短、给推荐答案**。全部收齐后一次性给出计划，用户确认后才执行。

必填（没有默认值）：

1. **仓库**：`owner/name`，必须在 github.com（不支持 GitHub Enterprise Server）。
2. **Agent 的 GitHub 账号**：专用账号（可以是新建的）。**账号注册、给仓库写权限、接受邀请、`gh-agent auth login` 只能由用户做。**

有默认值（不问，写进计划即可）：

| 项 | 默认 |
| --- | --- |
| profile | `superagent-<仓库名>` |
| 端口 | 从 3082 起递增，取第一个未占用 |
| stateDir | `~/.dsh/state/superagent-<仓库名>`（绝对路径） |
| 本地克隆 | `~/work/code/<仓库名>` |
| GitHub 白名单 | 只放操作者自己的 login |
| 提交署名 | 该实例的 Agent 账号 |
| auto-merge | 不开 |
| maxWorkers | 3 |
| accept 模式 | `observe` |
| 飞书 | 不接；要接则**必须另建一个自建应用 + 一套 `lark-cli` 配置目录**（一个 bot 只能归一个实例） |

要额外确认的边界情况：

- 仓库是**空仓库**（零 commit）→ prepare 的 `worktree add` 会失败，必须先推一个基线 commit（征求同意后由你推）。
- 用户想开 auto-merge → 需要一个**有 merge 权限的另一个账号**的 CLI，并写进 Delivery requirements。

## §3 前置检查（一次跑完，全部要过）

```bash
node -v                 # 22.19+ 或 24+
pnpm -v
git --version           # 2.32+
tmux -V
python3 --version       # 3.8+
gh --version            # 2.48+
dsh --version           # 必须满足仓库 package.json 的 engines.dsh（现为 ^0.2.1-alpha.2）
curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 https://github.com   # 必须 200
curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 https://api.github.com
```

缺的项**不要问用户，直接写进计划的"我来补"部分**（`brew install tmux`、`npm i -g @deepseek-ai/dsh@<版本>` 等）。

**github.com 不通是高频坑**：`api.github.com` 可能通而 `github.com` 不通（国内解析到 `20.205.243.166` 常被墙）。此时 push/PR 全废，必须先解决：

```bash
# 方案一：开启本地代理（Clash/Surge 等），让终端走系统代理
# 方案二：把 github.com 钉到可用 IP（需要 sudo，只能用户执行）
printf '140.82.112.3 github.com\n140.82.112.3 www.github.com\n140.82.112.3 gist.github.com\n' | sudo tee -a /etc/hosts
```

## §4 盘点现状（避免撞端口/撞 profile）

```bash
dsh --version
for p in 3082 3083 3084 3085; do printf "%s " $p; lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && echo busy || echo free; done
grep -l -E 'id: dsh-superagent\b' ~/.dsh/profiles/*/cordis.patch.yml 2>/dev/null
cat ~/.dsh/superagent-fleet.json 2>/dev/null   # 舰队登记表（本 skill 维护）
```

## §5 新增实例（六步）

### 5.1 准备检出与构建（幂等，可复用同一份代码）

```bash
mkdir -p ~/work/code && cd ~/work/code
[ -d dsh-superagent ] || git clone https://github.com/deepseek-ai/dsh-superagent-prototype dsh-superagent
cd dsh-superagent && pnpm install && pnpm build
```

多实例**共用一个检出**即可（插件以 `link:` 方式装到各 profile），不要每个实例克隆一份。

### 5.2 建 profile 并装插件

```bash
cd ~/work/code/dsh-superagent
dsh <PROFILE> --from-default-profile web --dump-config > /dev/null
dsh plugin --profile <PROFILE> add "link:$PWD"
```

> ⚠️ **profile 名是位置参数**，不是 `--profile`：`dsh <PROFILE> ...`。写成 `dsh superagent --profile X` 会报 `select a profile only once`。
> ⚠️ 只在全新 profile 时执行第一条。已有 profile 会**删掉**其 `cordis.patch.yml`。

### 5.3 写机器配置

编辑 `~/.dsh/profiles/<PROFILE>/cordis.patch.yml`：

```yaml
- id: webserver
  config:
    host: 127.0.0.1
    port: <PORT>
- id: dsh-superagent
  config:
    stateDir: /绝对路径/.dsh/state/superagent-<仓库名>
# 只有接飞书时才放开
# - id: dsh-superagent-feishu
#   disabled: false
```

`stateDir` 必须绝对路径；非法值或未知键会**阻止启动**，日志会指出是哪个键。

### 5.4 写账号 wrapper（每个实例一个配置目录）

```bash
mkdir -p ~/.local/bin ~/.config/gh-agent-<仓库名>
cat > ~/.local/bin/gh-agent-<仓库名> <<'EOF'
#!/bin/sh
GH_CONFIG_DIR="$HOME/.config/gh-agent-<仓库名>" exec gh "$@"
EOF
chmod +x ~/.local/bin/gh-agent-<仓库名>
```

### 5.5 交接给用户（一次给完，等他回 done）

```bash
# 1) 注册专用账号后，给仓库 Write 权限
# 2) 以该账号登录
~/.local/bin/gh-agent-<仓库名> auth login
~/.local/bin/gh-agent-<仓库名> api user --jq .login          # 必须打印 Agent 账号
~/.local/bin/gh-agent-<仓库名> api /user/repository_invitations --jq '.[] | [.id, .repository.full_name] | @tsv'
~/.local/bin/gh-agent-<仓库名> api -X PATCH /user/repository_invitations/<id>   # 接受邀请
~/.local/bin/gh-agent-<仓库名> api repos/<owner>/<name> --jq .permissions        # push: true
```

> `gh auth login` 用**隐身窗口**，否则浏览器里已登录的操作者账号会串号。device flow 走 `github.com/login/device`，正好是最容易被墙的一步。

### 5.6 启动 + 落配置

```bash
cd ~/work/code/dsh-superagent
./scripts/dsh-superagent --profile <PROFILE> start
./scripts/dsh-superagent --profile <PROFILE> status     # 4=等配置，见 §7
```

`status` 退出码：`0` 正常 / `1` 没跑或重启可修 / `2` 部件报错（重启无用）/ `3` 等 setup。
注意：`status` 在 shell 里用 `; echo $?` 取值，别接管道（管道会吞掉退出码）。

配置顺序（每步都用 §8 的 revision 取法）：`source:github` →（可选 `source:feishu`）→ `policy` → `executor` → `prompts`。
保存后若返回 `restarting: true`，轮询 `status` 直到不再以 1 退出，再从 `GET settings` 重读 revision。

**executor.prepare 模板**（把路径与仓库替换掉）：

```bash
git -C <CLONE> fetch --no-tags "https://github.com/<owner>/<name>.git" \
  "${DSH_SUPERAGENT_GITHUB_PR_HEAD:-HEAD}:refs/dsh-superagent/$DSH_SUPERAGENT_TICKET" && \
git -C <CLONE> worktree add -b "agent/$DSH_SUPERAGENT_NAME" "$DSH_SUPERAGENT_DIR" \
  "refs/dsh-superagent/$DSH_SUPERAGENT_TICKET"
```

**prompts 必改两处**：`delivery` 段里删掉 auto-merge 整段（用户答"不开"时），并写入提交署名。改完立刻本地模拟一次 prepare 验证能开出 worktree，再删掉测试分支。

### 5.7 登记

写入 `~/.dsh/superagent-fleet.json`：

```json
{"instances":[{"profile":"superagent-<name>","repo":"owner/name","port":3083,
  "stateDir":"/Users/x/.dsh/state/superagent-<name>","clone":"/Users/x/work/code/<name>",
  "ghWrapper":"/Users/x/.local/bin/gh-agent-<name>","agentLogin":"xxx","createdAt":"YYYY-MM-DD"}]}
```

## §6 日常运维

```bash
# 非 3082 端口必须显式带 --url，脚本默认只认 3082
./scripts/dsh-superagent --profile <P> --url http://127.0.0.1:<PORT> start|stop|restart|status
```

> ⚠️ 忘记 `--url` 时脚本会去探测 3082，撞上实例 #1 就报 `An existing orchestrator answers at this URL; refusing duplicate startup.`，看着像"重复启动"，其实是端口默认值问题。

- 每小时自检：挂在**操作者常用的 profile**（不是 superagent 自己的 profile），`status` 退出 1 时 `--respect-stop restart`；退出 2/3 只报告不重启（重启修不好）。
- 升级：等没有 Executor 正在跑 → 备份 `<stateDir>/orchestrator.sqlite` → `git pull && pnpm install && pnpm build` → `restart`。**数据库不能被旧版本打开**，回滚只能靠备份。
- 日志：`.artifacts/dsh-superagent-<profile>-<date>-<pid>.log`，保留最近 20 个。
- **面板 URL 带 token，裸访端口会返回 `web authentication required`**，且 token 每次重启都变。取法：

```bash
grep -ho 'http://127.0.0.1:<PORT>/?token=[A-Za-z0-9_-]*' \
  "$(ls -t .artifacts/dsh-superagent-<profile>-*.log | head -1)" | tail -1
```

## §7 排错

| 症状 | 处理 |
| --- | --- |
| `status` 退出 3 | 看 `status` 输出的 `setup`，按 `place` 改对应设置；常见是仓库未填或 Agent CLI 未登录 |
| 启动报 `existing orchestrator answers at this URL` | 忘了 `--url http://127.0.0.1:<PORT>`，脚本默认探测 3082 |
| `The agent GitHub CLI cannot read its account` | wrapper 没登录：`<wrapper> auth login` |
| `cannot push to ...` | Agent 账号没有仓库写权限 |
| `The prepare command failed` | 手动跑一遍 prepare 命令，看真实报错（多为克隆路径错/空仓库/无 worktree 权限） |
| 工单永远不出现 | ①发送者不在白名单（此时面板显示"未订阅"）②Source 未启用 ③处理被暂停 ④GitHub 靠**新评论**触发，编辑正文加的 @ 收不到 |
| 飞书不回 | ①发送者 `open_id` 不在 `policy.sources.feishu.allowed` ②纯提问不构成工作请求（默认只有 copy/visual 两条规则）③权限改后没重新发版 |
| `dsh-superagent configuration has keys it does not use` | 删掉日志指名的键 |
| 端口占用 | 换端口并重启；不要两个实例共用一个 |
| 升级后面板 "Failed to load plugins" | 重启该实例 |

## §8 Management API 速查

详见 [`references/management-api.md`](references/management-api.md)。要点：

- 基址 `http://127.0.0.1:<PORT>/orchestrator/api`，必须带 `x-orchestrator-request: 1`。
- 每次保存都要带 `revision`（乐观锁），409 表示版本过期，重读再改。
- 设置块只有四个：`policy`、`eval`、`executor`、`source:<id>`；提示词走 `PUT /prompts`。

## §9 完成标准

- [ ] 每个实例：`status` 退出 0，`setup: null`，`errors: {}`，`github: ready`
- [ ] prepare 命令实测能开出 worktree（并已清理测试分支）
- [ ] 白名单非空（空名单会让所有请求被丢弃）
- [ ] 端到端：白名单账号在 Issue 里新发一条 `@<agent> ...`，一分钟内出现工单
- [ ] 舰队登记表已更新
