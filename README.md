# Codex Pet

一个把 Codex 会话状态映射成桌面宠物动作的本地应用。桌宠不包含 Agent 运行时，也不调用模型；它只消费 Codex 会话事件或网关事件，并把结果表现成走动、表情、气泡和语音唤醒。

## 当前状态

这是第一条可运行的纵向切片：

- Electron 透明置底窗口，覆盖当前显示器的工作区底边。
- 桌面内走动、拖拽、甩出、坐下、睡觉、表情和气泡。
- 可插拔状态机：`thinking`、`working`、`waiting`、`speaking`、`happy`、`error`、`idle`、`sleeping`。
- 只读的 Codex rollout 适配器，映射 `task_started`、工具调用、`AgentMessage` 和 `task_complete`。
- 网关 WebSocket 适配器和 mock 适配器。
- 本地 sherpa-onnx 关键词唤醒；麦克风采集、单声道混音和 16 kHz 重采样已经接通。
- `Ctrl+Alt+Space` 作为不依赖麦克风的手动唤醒入口。
- 形象层与动作层解耦，当前菜单只提供 zenbot 和原版 DeepSeek 鲸鱼娘；旧星音/机器人配置自动迁移到 zenbot。
- zenbot 已接入 19 个表情和 18 个动作，默认使用分件 Rig，失败回退精灵；步态有支撑足约束，头顶固定随头部、下方长发摆动。精灵动作图自带的爱心、眼泪、Z 和音符会关闭 kit 的同类粒子，避免重复绘制。材质与方法见 `docs/zenbot/MOTION_INTEGRATION.md`。

还没有实现：命令级 ASR、TTS/口型同步、Codex `app-server` 实时适配器，以及桌宠自己监听的网关服务端。当前网关模式是**连接现有网关**的客户端。

Codex rollout 适配器只跟随启动后的新增记录，不回放整段旧会话；如果桌宠在一轮任务中途启动，可能需要等下一轮或改用网关事件。

## 运行

```powershell
git clone https://github.com/17hwliao/zebot.git
cd zebot
npm install
npm start
```

演示模式不依赖 Codex 会话：

```powershell
npm run mock
```

直接以 zenbot 形象运行或抓预览：

```powershell
npx electron . --mock --figure=zenbot
npx electron . --mock --figure=zenbot --screenshot --out=docs/zenbot/zenbot-preview.png
npx electron . --figure=zenbot --preview-word=wave --screenshot --out=docs/zenbot/zenbot-wave-preview.png
```

`--preview-word` 接受表情或动作词条，并在截图前约 450 ms 触发一次，便于稳定核对 `wave`、`nod`、`flap`、`dance`、`sleep` 等帧，不再依赖 mock 时序。

本机人工验收可运行 `npx electron . --zenbot-rig --acceptance`：直接打开居中窗口，先走路再循环演示，无需唤醒。顶部可切换两套角色、19 个表情、18 个动作和口型演示；窗口可拖动、缩放和关闭。验收模式不消费 mock/Codex 会话事件，避免演示动作被工作状态打断。

原版鲸鱼娘可用 `npx electron . --figure=whale --acceptance` 打开，保留原版眨眼、瞳孔跟随、口型、头发/裙摆/尾巴/鲸鳍物理以及 8 套配色 × 3 套服装。配色和服装在右键菜单“鲸鱼娘配色 / 服装”切换。普通桌宠右键“动作”也可立即触发走路、跑步等动作。

带本地语音唤醒启动：

```powershell
npm install --include=optional
npm run voice:model
npm run voice
```

默认唤醒词是“小扣”或“小扣小扣”。关键词表在 `assets/keywords.txt`，模型下载到 `%USERPROFILE%\.codex-pet\voice`。如果依赖或模型不可用，桌宠仍会正常启动，并可用 `Ctrl+Alt+Space` 唤醒。

捕获一张窗口预览：

```powershell
npm run screenshot
```

## 目录

- `src/main/`：Electron 窗口、静态资源服务、IPC 和运行时装配。
- `src/core/`：状态机、动作目录、气泡策略和空闲行为。
- `src/adapters/`：Codex 会话、网关和 mock 事件源。
- `src/renderer/`：宠物舞台、气泡和形象绘制。
- `src/voice/`：关键词唤醒和后续命令识别接口。
- `assets/keywords.txt`：默认唤醒词表。
- `docs/DESIGN.md`：动作、状态、窗口和语音设计。
- `docs/EVENT-PROTOCOL.md`：网关与桌宠之间的 JSON 协议。

## 形象选择

形象可在托盘/右键菜单的“形象”中切换：

- `zenbot`：当前默认形象，默认自动优先分件 Rig，失败回退精灵；使用自有母体、37 张关键帧和分件素材。
- `whale`：从本机 Coopanion 导入的原版 DeepSeek 鲸鱼娘，保留原始署名与完整许可证。

2026-11-25 用户明确要求导入原版鲸鱼娘，替代此前仅参考动作词表的限制。导入来源及署名见 `assets/characters/whale/NOTICE.md`。zenbot 自身的美术没有替换成鲸鱼娘；其眨眼、口型由自有表情局部合成，仍不同于原版独立五官模型，详细差距见 `docs/zenbot/MOTION_PARITY.md`。

动作底座的 `src/renderer/kit/` 复制自 Coopanion，因此这一部分也带 AGPL 约束，详情见 `src/renderer/kit/NOTICE.md`。如果要闭源分发，先替换该目录或单独处理许可证。

## 与网关的关系

桌宠只消费 `docs/EVENT-PROTOCOL.md` 的事件，不包含 Agent 运行时。与 magpie 联合使用时，由网关增加 `/pet` 的 WebSocket/HTTP 端点和 token，再把 Codex 的轮次、工具、完成和错误事件转发过来。当前仓库已完成客户端适配器，尚未替 magpie 写服务端。

