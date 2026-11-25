# Codex Pet 事件协议

版本：`v1`。传输：本地 WebSocket（首选）或 HTTP POST（兼容）。

## 1. 信封

所有消息使用同一个信封：

```json
{
  "v": 1,
  "type": "agent.state",
  "ts": 1795224930000,
  "seq": 42,
  "session": "01a1fbbe-7fa9-76d3-949f-455174fffe57",
  "source": "codex",
  "data": {}
}
```

- `v`：协议版本。
- `type`：事件类型。
- `ts`：Unix 毫秒。
- `seq`：同一连接内单调递增；断线重连后从 1 重新开始也可以，桌宠按 `session + ts` 去重。
- `session`：Codex 会话 ID，可为空。
- `source`：`codex`、`gateway`、`voice`、`pet`。
- `data`：类型相关字段。

## 2. Agent 事件

### `agent.state`

高层状态。适合网关无法提供细粒度工具事件时使用。

```json
{
  "v": 1,
  "type": "agent.state",
  "ts": 1795224930000,
  "seq": 1,
  "session": "01a1...",
  "source": "codex",
  "data": {
    "state": "working",
    "label": "运行测试",
    "tool": "shell",
    "model": "deepseek-v4.1-flash"
  }
}
```

`state` 取值：`idle`、`thinking`、`working`、`waiting`、`speaking`、`happy`、`error`、`sleeping`、`offline`。

### `agent.tool`

工具开始或结束。比 `agent.state` 更细。

```json
{
  "v": 1,
  "type": "agent.tool",
  "ts": 1795224930000,
  "seq": 2,
  "source": "codex",
  "data": {
    "phase": "started",
    "id": "call_123",
    "name": "exec_command",
    "label": "npm test",
    "ok": null
  }
}
```

`phase`：`started`、`finished`。

### `agent.message`

Agent 对用户说的话。桌宠只显示 `text` 的短摘要。

```json
{
  "v": 1,
  "type": "agent.message",
  "ts": 1795224930000,
  "seq": 3,
  "source": "codex",
  "data": {
    "text": "我已经把测试跑完了。",
    "final": true
  }
}
```

### `agent.approval`

需要用户确认。

```json
{
  "v": 1,
  "type": "agent.approval",
  "ts": 1795224930000,
  "seq": 4,
  "source": "codex",
  "data": {
    "id": "approval_1",
    "kind": "command",
    "summary": "允许运行 npm install 吗？",
    "options": ["允许", "拒绝"]
  }
}
```

### `agent.done` / `agent.error`

```json
{ "v": 1, "type": "agent.done", "ts": 1795224930000, "seq": 5, "source": "codex", "data": { "summary": "测试通过" } }
```

```json
{ "v": 1, "type": "agent.error", "ts": 1795224930000, "seq": 6, "source": "codex", "data": { "message": "命令退出码 1" } }
```

### `gateway.status`

网关自身的状态：模型切换、额度、限流、断线。

```json
{
  "v": 1,
  "type": "gateway.status",
  "ts": 1795224930000,
  "seq": 7,
  "source": "gateway",
  "data": {
    "state": "failover",
    "provider": "deepseek",
    "model": "deepseek-v4.1-flash",
    "message": "主账号额度用尽，已切换备用账号"
  }
}
```

`state`：`online`、`offline`、`failover`、`quota`、`rate-limit`。

## 3. 语音事件

### `voice.wake`

```json
{ "v": 1, "type": "voice.wake", "ts": 1795224930000, "seq": 8, "source": "voice", "data": { "keyword": "小扣小扣" } }
```

### `voice.command`

```json
{ "v": 1, "type": "voice.command", "ts": 1795224930000, "seq": 9, "source": "voice", "data": { "text": "帮我看看测试为什么失败" } }
```

## 4. 桌宠回传

桌宠 → 网关：

### `pet.touch`

```json
{ "v": 1, "type": "pet.touch", "ts": 1795224930000, "seq": 10, "source": "pet", "data": { "kind": "poke" } }
```

`kind`：`poke`、`pet`、`drag`、`drop`、`throw`。

### `pet.command`

供网关/语音控制桌宠：

```json
{
  "v": 1,
  "type": "pet.command",
  "ts": 1795224930000,
  "seq": 11,
  "source": "gateway",
  "data": { "action": "say", "text": "我在这里。" }
}
```

`action`：`say`、`emote`、`move`、`quiet`、`sleep`、`wake`。

## 5. 传输与鉴权

WebSocket：

```text
ws://127.0.0.1:3426/pet?token=<token>
```

HTTP 兼容：

```text
POST http://127.0.0.1:3426/pet/event
Authorization: Bearer <token>
Content-Type: application/json
```

要求：

- 只监听 `127.0.0.1`，不要监听 `0.0.0.0`。
- token 至少 32 字节随机值，写入用户配置目录，权限仅当前用户可读。
- 限制消息大小（建议 256 KB）和速率。
- 不把 token 放进 URL 日志；生产可改用 `Sec-WebSocket-Protocol` 或首帧认证。

