# Codex Pet 设计

## 1. 目标与非目标

目标：做一个严格服务于 Codex Agent 的本地桌宠。它观察 Codex 的会话状态，用动作、表情、气泡和语音表现“正在思考 / 正在执行 / 需要确认 / 完成 / 出错”，并能在空闲时自己走动、坐下和睡觉。

非目标：

- 不实现 Agent 运行时，不接 Cortico / Coopanion 的 Persona、Memory 或 World。
- 不在桌宠进程里调用模型。
- 不默认接管键鼠、不默认截屏、不默认常开麦克风。
- 不把 Codex 的完整会话内容展示在桌面上；气泡只显示短摘要。

## 2. 与 Cortico / Coopanion 的关系

只复用“桌宠表现层”的设计和接口思路：

- 透明、无边框、置顶、贴工作区底边。
- 身体之外点击穿透。
- 走动、拖拽、甩出、坐下、睡觉、表情和气泡。
- 形象包与动作词表解耦。

不复用 Cortico Core。Codex 是唯一的 Agent；网关只负责把 Codex 事件转成桌宠事件。

## 3. 总体结构

```text
Codex CLI / Codex Desktop
        │  rollout JSONL（只读） 或 app-server
        ▼
Codex Event Adapter ──────┐
                           │
Gateway Adapter (WS/HTTP) ─┼──► Pet Runtime ──► Renderer
                           │      │              │
Mock Adapter ──────────────┘      │              ├─ 走动 / 表情 / 气泡
                                  │              └─ 点击 / 拖拽 / 甩出
                                  ▼
                            Voice Wake Service
```

进程边界：

- **Electron main**：窗口、显示器、静态服务、适配器、状态机、语音服务。
- **Renderer**：只负责画和交互，不读 Codex 日志，不做状态判断。
- **Gateway**：可以是 magpie 的新端点，也可以是独立的小桥接进程；桌宠只认 `docs/EVENT-PROTOCOL.md`。

## 4. 状态机

状态优先级从高到低：

| 状态 | 触发 | 表现 | 退出 |
| --- | --- | --- | --- |
| `waiting` | 需要用户确认 / 输入 | 看向用户、担心、气泡常驻 | 确认或取消后 |
| `error` | 轮次失败、工具失败、网关断开 | 难过 / 发抖 / 错误气泡 | 6 秒后或下一轮开始 |
| `working` | 有工具调用正在执行 | 认真、点头、工作指示灯 | 所有工具结束 |
| `speaking` | 收到 Agent 文本 | 说话口型、气泡 | 3 秒无新文本 |
| `thinking` | 轮次已开始、无工具 | 思考表情、缓慢呼吸 | 工具开始或轮次结束 |
| `listening` | 唤醒词 / 按住说话 | 倾听表情、耳朵抬起 | 命令结束或超时 |
| `happy` | 轮次完成 | 开心、跳一下或转圈 | 4 秒 |
| `idle` | 无活动 | 随机张望、走动、坐下 | 有新事件 |
| `sleeping` | 空闲超过 15 分钟 | 睡觉、Z 粒子 | 鼠标靠近 / 新事件 |
| `offline` | 适配器未连接 | 困倦、低亮度 | 重新连接 |

`waiting` 和 `error` 不会被空闲行为覆盖。`working` 可以被 `waiting` 和 `error` 抢占。`speaking` 可以被 `waiting` 抢占。

### Codex 事件映射

| Codex 记录 | 桌宠事件 | 动作 |
| --- | --- | --- |
| `session_meta` | `session.attached` | 张望一下，进入 idle |
| `event_msg: task_started` | `turn.started` | `nod`，进入 thinking |
| `response_item: function_call` | `tool.started` | 进入 working；按工具选择 `nod` / `look` / `flap` |
| `response_item: function_call_output` | `tool.finished` | 回执点头；失败则短暂 worried |
| `event_msg: item_completed: UserMessage` | `user.message` | 看向用户，气泡显示输入摘要 |
| `event_msg: item_completed: AgentMessage` | `agent.message` | 进入 speaking，气泡显示短摘要 |
| `event_msg: item_completed: Reasoning` | `agent.reasoning` | 保持 thinking |
| `event_msg: item_completed: CommandExecution` | `tool.result` | 成功点头，非零退出码进入 error |
| `event_msg: token_count` | `usage.updated` | 更新能耗条；不改变主状态 |
| `event_msg: task_complete` | `turn.completed` | 进入 happy，播放 `dance` 或 `jump` |
| `event_msg: turn_aborted` | `turn.failed` | 进入 error，播放 `shake` |
| `turn_context` | `session.context` | 更新模型名和上下文信息 |

工具到动作的默认映射：

| 工具 | 动作 |
| --- | --- |
| `exec_command` / `shell` | `nod`，状态 `shell` |
| `apply_patch` | `nod`，状态 `edit` |
| `view_image` | `look`，状态 `image` |
| `web_search` | `look`，状态 `search` |
| `update_plan` | `nod`，状态 `plan` |
| `spawn_agent` | `flap`，状态 `agents` |
| `request_user_input` | `look`，进入 waiting |
| 未知工具 | `confused` + `look` |

## 5. 动作与形象层

动作词表来自 Coopanion 的 kit 设计，但本项目使用自己的 `PetUpdate`：

```js
{
  state: "working",
  expression: "determined",
  motion: "nod",
  bubble: { text: "正在运行测试…", tone: "work", holdMs: 3000 },
  move: { x: 0.62, run: false },
  speaking: false
}
```

形象层实现一个最小接口：

```js
createFigure() => ({
  draw(petG, face, frame),          // 必需
  anchors: { bubble },              // 可选
  extent: [x0, y0, x1, y1],         // 可选
  hits: [[x, y, r]],                // 可选
  setScheme(id, opts),              // 可选
  dispose(),                        // 可选
})
```

当前默认形象是 `terminal-bot`，纯 SVG，不依赖第三方美术。后续可以替换为：

| 形象 | 来源 | 许可 | 适配难度 |
| --- | --- | --- | --- |
| 鲸鱼娘 | [Coopanion whale](https://github.com/Pal-AI-Lab/Coopanion/tree/main/packages/cortico-world-desktop-pet/web/whale) | AGPL-3.0-or-later；角色原设溟月、二创 ZipZipPipe；围裙含厂商商标 | 低，已有完整 rig 和 30+ 动作词 |
| Coo | [Coopanion coo](https://github.com/Pal-AI-Lab/Coopanion/tree/main/packages/cortico-world-desktop-pet/web/coo) | AGPL-3.0-or-later | 低，纯 SVG |
| BongoCat 猫 | [ayangweb/BongoCat](https://github.com/ayangweb/BongoCat) `resources/models` | 仓库 Apache-2.0；模型/角色权利仍需单独核对 | 中，Live2D `.moc3`，需接 Cubism 渲染 |
| 星音 | `assets/characters/xingyin/` | 用户自有素材 | 中，透明 PNG 5 姿态 + 9 皮肤，需自己做序列帧/弹簧 |
| zenbot | 本地 `assets/characters/zenbot/` | 用户自有母体与生成素材，本机使用 | 已接入，透明 PNG 19 表情 + 18 动作，精灵切换 + 程序化微动 |
| Live2D 示例模型 | [CubismWebSamples](https://github.com/Live2D/CubismWebSamples) | Live2D Free Material License，不是开源许可 | 中，需核对模型条款 |

更多 BongoCat 模型：[Awesome-BongoCat](https://github.com/ayangweb/Awesome-BongoCat)。Live2D 导入参考项目：[cortico-world-figure](https://github.com/as124da1231/cortico-world-figure)，但它不是本项目的依赖，使用前需独立审计。

形象替换不应改动状态机；只替换 `createFigure` 和动作词表。

zenbot 的动作选择、画布归一化、动作时长和限制见 `docs/zenbot/MOTION_INTEGRATION.md`。当前实现是静态关键帧精灵，不是 Live2D/骨骼分件模型。

## 6. 窗口与交互

- 窗口覆盖当前显示器工作区底边，高度默认 420 px。
- `transparent: true`、`frame: false`、`alwaysOnTop: true`、`skipTaskbar: true`。
- 默认 `setIgnoreMouseEvents(true, { forward: true })`。
- Renderer 根据 `layout().hit` 计算鼠标是否在身体、气泡或控件上；进入命中区时关闭穿透，离开时恢复。
- 拖拽、甩出、落地、坐下、睡觉都在 renderer 的舞台内完成，不移动 OS 窗口，避免多显示器 DPI 和窗口闪烁问题。
- 右键菜单后续提供：隐藏、静音、暂停、设置、退出。
- 多显示器：每个显示器一个窗口，或跟随鼠标所在显示器；MVP 先做主显示器。

## 7. 语音唤醒

两阶段设计：

1. **唤醒**：sherpa-onnx KeywordSpotter + 16 kHz 单声道麦克风，本地常开，CPU 占用低。
2. **命令**：唤醒后录音，VAD 静音 800 ms 截止，交给本地 ASR 或网关转写；转写文本作为 `voice.command` 送入网关。

默认唤醒词：`小扣`、`小扣小扣`。关键词表在 `assets/keywords.txt`，按 sherpa-onnx 的拼音 tokens 生成。当前选用的中文 KWS 模型不能识别英文 `Hey Codex`；如果要英文唤醒，需要更换训练集或单独训练/选择支持英文的关键词模型。

隐私规则：

- 默认只在本地做关键词识别。
- 不保存原始音频；命令录音在转写后删除。
- 托盘/设置里有明显的麦克风状态。
- 没有模型或没有麦克风时，语音服务降级为 `unavailable`，不影响桌宠运行。
- 提供 `Ctrl+Alt+Space` 作为可靠的手动唤醒替代入口。
- 当前只做到“唤醒”，命令 ASR 和 TTS 仍属于后续阶段。

## 8. 网关协议

见 `docs/EVENT-PROTOCOL.md`。核心原则：

- 事件只描述“发生了什么”，不描述“宠物应该怎么画”。
- 桌宠自己决定动作，网关不需要知道表情词表。
- 所有事件带 `v`、`type`、`ts`、`seq`；断线重连按 `seq` 去重。
- 本地回环 + token；不信任其他本机进程。

## 9. 安全与隐私

- Codex rollout 只读，不修改会话文件。
- 气泡只显示截断摘要，默认不显示完整命令输出、文件内容或密钥。
- 不默认截屏、不默认键鼠注入、不默认读取其他窗口。
- 网关 token 存在用户配置目录，权限尽量设为仅当前用户可读。
- 第三方形象/模型文件按各自许可证处理；不把 AGPL 代码复制进闭源发行版。

## 10. MVP 与后续

MVP：

- 透明窗口 + 走动/拖拽/甩出/坐下/睡觉。
- Codex rollout 适配器 + mock 适配器。
- 状态机 + 气泡 + 错误/完成反馈。
- 关键词唤醒接口 + 模型下载脚本。

后续：

- 在 magpie 中实现网关 WebSocket 端点和鉴权。
- app-server 适配器，获得真正的实时工具开始/结束事件。
- 命令 ASR、TTS、口型同步。
- 多显示器、托盘、设置页、开机启动。
- 形象包热切换：鲸鱼娘 / BongoCat / 星音。

