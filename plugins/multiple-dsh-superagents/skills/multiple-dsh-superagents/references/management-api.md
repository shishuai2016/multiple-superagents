# Management API 速查

面板用的就是这套本地 HTTP API，Agent 可以直接调用。所有请求：

```
GET/POST/PUT http://127.0.0.1:<PORT>/orchestrator/api/<route>
x-orchestrator-request: 1
content-type: application/json   # 有 body 时
```

Host 必须是 `127.0.0.1:<PORT>` 或 `localhost:<PORT>`，缺头或跨站 Origin 一律 403。

## 读

```bash
api=http://127.0.0.1:3083/orchestrator/api
curl -s -H 'x-orchestrator-request: 1' $api/state       # setup / health / load / paused / masterId
curl -s -H 'x-orchestrator-request: 1' $api/settings    # blocks + sources（含各自 revision）
curl -s -H 'x-orchestrator-request: 1' $api/sources     # 每个 Source 的状态、当日统计、被丢弃的消息
```

`GET /settings` 的结构里，**每个可写对象都带 `revision`**：`blocks.policy.revision`、`blocks.eval.revision`、`blocks.executor.revision`、`sources[i].revision`（i 看 `id`）。

## 取 revision（每次保存前都要重取）

```bash
rev_of () {  # rev_of <block>  或  rev_of source:<id>
  curl -s -H 'x-orchestrator-request: 1' $api/settings | python3 -c '
import json,sys
want=sys.argv[1]; d=json.load(sys.stdin)
if want.startswith("source:"):
    sid=want.split(":",1)[1]
    print([s["revision"] for s in d["sources"] if s["id"]==sid][0])
else:
    print(d["blocks"][want]["revision"])' "$1"
}
```

## 写

保存某个块时，`value` 必须是**整个块**（缺的键取默认），并带上刚才取到的 `revision`：

```bash
# GitHub Source
curl -s -X PUT -H 'x-orchestrator-request: 1' -H 'content-type: application/json' \
  $api/settings/source:github -d '{
    "value": {"enabled": true,
              "config": {"repository": "owner/name",
                         "cli": "/Users/me/.local/bin/gh-agent-name"}},
    "revision": 0 }'

# 策略：允许名单（空名单 = 所有请求被丢弃）
curl -s -X PUT -H 'x-orchestrator-request: 1' -H 'content-type: application/json' \
  $api/settings/policy -d '{
    "value": {"rules": [ ...保持原样... ],
              "sources": {"github": {"allowed": [{"id": "me"}],
                                     "bots": [{"id": "dependabot[bot]"}]}}},
    "revision": 0 }'

# 执行：目录与 prepare
curl -s -X PUT -H 'x-orchestrator-request: 1' -H 'content-type: application/json' \
  $api/settings/executor -d '{
    "value": {"model": null, "maxWorkers": 3,
              "directory": "/Users/me/work/code/name",
              "prepare": "git -C ... fetch ... && git -C ... worktree add ...",
              "blockedCommands": []},
    "revision": 0 }'

# 评估：模式与模型
curl -s -X PUT -H 'x-orchestrator-request: 1' -H 'content-type: application/json' \
  $api/settings/eval -d '{"value": {"mode": "observe", "timeoutSeconds": 120, "model": null}, "revision": 0}'
```

策略里的 `rules` 必须先读出来再整体写回，**不要凭空构造**——默认只有 `copy`、`visual` 两条，删掉它们等于让它什么活都不接。

## 提示词

```bash
curl -s -H 'x-orchestrator-request: 1' $api/prompts > /tmp/p.json
# 改 current.config.<section>，然后：
python3 -c '
import json; d=json.load(open("/tmp/p.json"))
json.dump({"config": d["current"]["config"], "baseRevision": d["revision"]},
          open("/tmp/p-put.json","w"))'
curl -s -X PUT -H 'x-orchestrator-request: 1' -H 'content-type: application/json' \
  $api/prompts --data @/tmp/p-put.json
```

三个团队段：`communication`、`scope`（工单范围）、`delivery`（交付要求，含提交署名与 auto-merge 条件）。保存返回 `{revision, effect: "next-request"}`，对下一次模型请求生效，不重启。

## 其它动作

| 动作 | 调用 |
| --- | --- |
| 暂停/恢复处理 | `POST /executor/pause` body `{"paused": true}` |
| 重跑 setup（会重启） | `POST /setup/check` |
| 立即同步白名单 | `POST /policy-sync/<source id>` |
| 重试工单 | `POST /tickets/<id>/retry` |
| 停止工单 | `POST /tickets/<id>/stop` |

## 返回与错误

- 成功保存：`{"saved": true, "revision": n, "policy_changed": bool, "restarting": bool, "context_delivery": "..."}`
- `restarting: true` 表示服务在重启，此时 API 短暂不可用；轮询 `scripts/dsh-superagent --profile <P> status` 直到不以 1 退出，再重读 revision。
- `400` 值非法或账号检查失败（响应体里 `setup` 说明原因）；`404` 对象不存在；`409` revision 过期；`500` 其它。
