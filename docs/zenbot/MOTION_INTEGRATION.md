# zenbot 动作审计与桌宠接入

日期：2026-11-24（Asia/Shanghai）

状态：精灵动作适配器、manifest、主进程和渲染器接入已完成；粒子去重和确定性动作预览已补，单元测试通过。当前仍是“静态关键帧 + 程序化运动”的精灵模型，不是 Live2D/骨骼分件模型，也没有长期实机交互验收。

## 1. 结论

- 19 个表情和 18 个动作全部进入 `assets/characters/zenbot/manifest.json`，共 37 张透明 PNG。
- 18 个动作都映射到现有 `src/renderer/kit/body.js` 的模式或手势；`stand` 通过 `wake` 模式使用。
- 新增 `src/renderer/figures/zenbot.js`：按 `frame.face`、`frame.mode`、`frame.gesture` 选择表情或动作帧，做 140 ms 交叉淡入和 140 ms 动作尾帧。
- 主进程静态服务、配置、菜单和渲染器已支持 `zenbot` 形象；可通过菜单切换，也可用 `--figure=zenbot` 启动。
- `npm test` 通过 56/56；manifest 校验 19 个表情、18 个动作、37 个唯一素材。
- 已生成 `zenbot-idle-preview.png`（idle 表情）、`zenbot-preview.png`（mock 完成态）以及两张标准化对照图。
- 已用 `--preview-word` 生成 `wave`、`nod`、`flap`、`dance`、`sleep` 和 `love` 的确定性截图。

## 2. 参考对照

参考对象是 Coopanion 的 DeepSeek 大肥鱼 / DeepSeek Chan（`web/whale`）。本项目只参考动作词表、时长和状态行为，不复制其代码或美术；zenbot 使用用户提供的母体和独立生成的 37 张 PNG。

参考侧的 18 个动作和持续时间：

| 词条 | 参考时长 | 参考行为 | zenbot 触发方式 | zenbot 适配 |
| --- | ---: | --- | --- | --- |
| `stand` | 1.2 s | 从坐/睡站起 | `wake` 模式 | 使用 `stand` 帧；坐姿睡眠结束时播放 |
| `jump` | 1.2 s | 原地起跳 | `crouch` 且 `jumpV >= 650`，或 `air` | 跳跃帧覆盖蹲下和腾空 |
| `hop` | 0.9 s | 小跳 | `crouch` 且 `jumpV < 650` | 小跳帧 |
| `look` | 2.7 s | 左右张望 | `look` 模式 | 张望帧，kit 负责转向 |
| `turn` | 0.4 s | 转向另一边 | `facing` 变化 | 越肩转身帧，420 ms |
| `nod` | 0.8 s | 低头两下 | `nod` 手势 | 动作帧 + 3.5% 纵向压缩 |
| `shake` | 0.8 s | 摇头 | `shake` 手势 | 动作帧 + 左右位移 |
| `spin` | 0.8 s | 原地转圈 | `spin` 手势 | 动作帧 + 横向压缩 |
| `sit` | 0.8 s，持续 | 坐下 | `sit` 模式 | 坐姿帧，基线对齐地面 |
| `sleep` | 0.8 s，持续 | 坐着打盹 | `sleep` 模式 | 睡眠帧 + 轻微呼吸位移 |
| `dizzy` | 3.2 s | 头晕 | `dizzy` 模式 | 晕眩帧，kit 负责倾斜 |
| `walk` | 12 s | 走动 | `walk` 模式 | 步行帧 + 行走起伏 |
| `run` | 12 s | 跑到另一边 | `run` 模式；空闲动作也会抽取 | 跑步帧 + 更快起伏 |
| `wave` | 1.7 s | 招手 | `wave` 手势 | 会话连接时问候；动作帧 + 身体轻摆 |
| `bow` | 1.7 s | 鞠躬 | `bow` 手势；空闲动作也会抽取 | 动作帧 + 轻微身体前倾 |
| `shiver` | 1.9 s | 缩身发抖 | `shiver` 手势 | 动作帧 + 高频抖动 |
| `flap` | 1.5 s | 开心扑腾 | `flap` 手势 | 动作帧 + 起跳微动 |
| `dance` | 3.4 s | 踩拍摇摆 | `dance` 模式 | 舞蹈帧 + 左右摇摆 |

参考侧的这些动作是分件 rig 程序化驱动的；zenbot 的每张动作图是一个生成关键帧，因此这里用精灵切换和少量程序化位移/压缩来补偿，而不是复刻其分件动画。

## 3. 状态机映射

`src/core/actions.js` 的状态到 zenbot 表现：

| 状态 | 表情 | 动作 | 说明 |
| --- | --- | --- | --- |
| `waiting` | `worried` | `look` | 等待确认，气泡常驻 |
| `error` | `sad` | `shake` | 工具失败或轮次失败 |
| `working` | `determined` | 按工具：`nod` / `look` / `flap` | 工具开始和结束都有反馈 |
| `speaking` | `neutral` | 无动作帧 | 说话时只加轻微纵向抖动，不做口型 |
| `thinking` | `thinking` | 无动作帧 | 保持思考表情 |
| `listening` | `neutral`（别名） | 无动作帧 | kit 的倾听倾斜负责姿态 |
| `happy` | `happy` | `jump` / `dance` / `spin` | 轮次完成 |
| `idle` | `neutral` | 随机 `look` / `hop` / `wink` / `nod` / `walk` / `sit` / `turn` | `wink` 是表情词，kit 会按表情处理 |
| `sleeping` | `sleep`（运动帧） | `sleep` | 长时间无事件后 |
| `offline` | `sleepy` | 无动作帧 | 网关离线 |

表情别名（`manifest.expressionAliases`）处理 kit 自己产生的脸名：

- `listening` → `neutral`
- `sleep` → `sleepy`
- `content` / `bowing` → `happy`
- `waking` → `sleepy`
- `squeeze` → `neutral`
- `dragged` → `scared`
- `run` → `determined`
- `dizzy` → `confused`

## 4. 精灵适配器

文件：`src/renderer/figures/zenbot.js`

行为：

- 两层 `<image>` 交叉淡入，默认 140 ms；动作结束后保留 140 ms 尾帧，避免手势边界闪烁。
- 动作帧优先于表情帧；动作帧本身带有表情，所以两者不做逐层合成。
- 手势 `nod`、`shake`、`spin`、`wave`、`bow`、`shiver`、`flap` 注册到 `figure.gestures`，让 kit 不再叠加整组倾斜，避免“动作图已经低头 + kit 再低头”的双重形变。
- `groupTilt` 降低 `walk`、`run`、`dance` 的整组倾斜，因为动作图本身已经带前倾或摇摆。
- `facing` 变化时显示 `turn` 帧 420 ms；这是对 kit 直接翻转朝向的视觉补帧。
- `talk` 值驱动很小的纵向抖动；不伪装成口型。
- 图片缓存上限 10 张，超出时释放最久未用的 `<img>`；预加载 `happy`、`nod`、`look`、`wave`、`walk`、`jump`。
- 导出 `ZENBOT_PARTICLES`，关闭 kit 的 `heart`、`z`、`tear`、`note` 粒子；这些符号已经烘焙在对应表情或动作图里，关闭后可避免双层重影。

### 确定性动作预览

截图主进程接受 `--preview-word=<word>`：

1. 主进程把词条和触发时刻传给渲染器。
2. 渲染器先用 `figure.preloadWord(word)` 预加载目标素材，避免截图时仍停在旧帧交叉淡入。
3. 截图模式在页面加载后的目标时刻调用一次 `body.doWord(word)`，捕获点约在其后 450 ms，避开起始下落和 mock 随机时序。
4. 若身体仍在空中，会短间隔重试，最多 6 次；触发时刻按页面加载时间计算，预加载耗时不会把动作推到截图之后。
5. 非截图模式默认在页面加载约 1.2 s 后触发，便于直接观察单动作。

这解决了先前 `--screenshot-delay=1500` 截到工具/`nod`、而不是 `wave` 的问题，以及 `flap`/`sleep` 因未预加载而带旧帧残影的问题。

## 5. 画布、比例和基线

manifest 使用：

- 参考画布：1117 × 1409
- 逻辑高度：292
- 身体中心：x = 128
- 脚底基线：y = 256
- 归一化方式：先按参考画布宽高比计算逻辑宽度，再按每张图的真实宽度缩放；画布底边对齐 `feetY`。

针对生成图的比例漂移：

- `hop` 的生成人物明显偏小：`scale = 1.24`
- `flap` 的生成人物偏小、腾空留白偏多：`scale = 1.18`
- `turn` 的人物在画布内偏左：`offsetX = 10`
- `sit`、`sleep`、`run` 的画布高度本来就不同，按画布宽度归一化后保留其坐姿/冲刺姿态差异，没有强行拉成站姿高度。

标准化后的角色包围盒相对 `stand`：

| 动作 | 高度比 | 宽度比 | 说明 |
| --- | ---: | ---: | --- |
| `stand` | 1.000 | 1.000 | 基准 |
| `jump` | 0.969 | 0.996 | 腾空屈腿 |
| `hop` | 1.034 | 1.135 | 校正后接近基准 |
| `look` | 0.924 | 0.943 | 侧倾张望 |
| `turn` | 0.972 | 0.865 | 三分之四侧身，宽度自然变窄 |
| `sit` | 0.872 | 1.004 | 坐姿更矮 |
| `sleep` | 0.976 | 1.004 | 坐睡，长发占比高 |
| `run` | 0.848 | 1.000 | 冲刺压低 |
| `flap` | 1.021 | 1.070 | 校正后接近基准 |
| `dance` | 1.003 | 1.000 | 接近基准 |

诊断图：

- `docs/zenbot/motions-normalization.png`
- `docs/zenbot/expressions-normalization.png`

生成脚本：`scripts/zenbot-normalization-check.py`。它读取同一份 manifest，按接入时的缩放和基线规则合成，便于发现比例漂移。

## 6. 接入位置

- `assets/characters/zenbot/manifest.json`：37 个素材、缩放、偏移、时长、别名和预加载。
- `src/renderer/characters/zenbot-manifest.js`：manifest 校验、素材列表和解析。
- `src/renderer/figures/zenbot.js`：精灵动画、交叉淡入、动作选择、程序化微动、calibration。
- `src/renderer/main.js`：加载/切换/回退 zenbot，校准通道接入。
- `src/main/main.js`：zenbot manifest 目录校验、静态挂载 `/characters/zenbot/`、`--zenbot` / `--figure=zenbot`。
- `src/main/menu-model.js`：形象菜单中的 zenbot 选项。
- `src/main/config.js`：持久化 `figure: "zenbot"`。
- `src/core/pet-state.js`：连接时 `wave`，完成时 `jump` / `dance` / `spin`，确认完成时 `nod`。
- `src/renderer/kit/body.js`：向 figure 帧补充 `jumpV` 和 `airKind`，用于区分 jump/hop。

## 7. 验证

```powershell
npm test
python scripts/check-zenbot-art.py
python scripts/zenbot-normalization-check.py
npx electron . --mock --figure=zenbot --screenshot --out=docs/zenbot/zenbot-preview.png
npx electron . --figure=zenbot --screenshot --out=docs/zenbot/zenbot-idle-preview.png
npx electron . --figure=zenbot --preview-word=wave --screenshot --out=docs/zenbot/zenbot-wave-preview.png
npx electron . --figure=zenbot --preview-word=nod --screenshot --out=docs/zenbot/zenbot-nod-preview.png
npx electron . --figure=zenbot --preview-word=flap --screenshot --out=docs/zenbot/zenbot-flap-preview.png
npx electron . --figure=zenbot --preview-word=dance --screenshot --out=docs/zenbot/zenbot-dance-preview.png
npx electron . --figure=zenbot --preview-word=sleep --screenshot --out=docs/zenbot/zenbot-sleep-preview.png
```

已验证：

- 56/56 单元测试通过。
- 37 张 PNG 可解码、RGBA、四角透明。
- manifest 19 个表情、18 个动作、37 个唯一素材。
- idle、`wave`、`nod`、`flap`、`dance`、`sleep` 和 `love` 在 Electron 中实际渲染；脚底基线、阴影和气泡锚点正常，关键截图无旧帧残影。
- `love` 截图中只看到素材内烘焙的爱心，没有 kit 追加的第二组爱心；`sleep` 只保留素材里的 Z，没有额外 Z 粒子。
- 18 个动作都有明确的运行时选择路径；`bow` 和 `run` 现在也会进入空闲动作抽取。

未验证：

- 长时间桌面交互、拖拽甩出、连续工具切换下的动作连贯性。
- 用户对动作图风格和动作语义的最终确认。
- 逐张原尺寸像素级人工审阅。

## 8. 限制与下一步

- 当前不是分件 rig：没有头/发/手臂/裙摆的独立图层，也没有真正的中间帧。
- 动作帧带自己的表情，不能和 19 张表情逐层组合；动作期间以动作帧为准，结束后交叉淡回表情。
- 没有说话口型；`talk` 只做轻微抖动。
- 18 个动作都可由状态机、空闲行为、`body.doWord()` 或 `--preview-word` 触发；尚未做长时间交互下的节奏和连贯性调优。
- 如果要继续提升动态感，优先做：
  1. 为 `walk` / `run` 增加 2–4 张循环帧，而不是单张滑动。
  2. 为 `nod` / `shake` / `wave` 增加中间帧。
  3. 将头、发、手臂、裙摆拆层，保留现有 `createZenbotFigure` 接口，逐步替换为 rig 渲染。
  4. 保留状态机和 `PetUpdate` 不变，只替换 figure 与 manifest。
