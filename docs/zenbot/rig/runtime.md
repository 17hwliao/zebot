# zenbot Rig 运行时

日期：2026-11-24  
范围：Wave 1 + Wave 2 的 rig manifest 校验、纹理加载、表情过渡、动作参数和失败回退  
实现：

- `src/renderer/characters/zenbot-rig-manifest.js`
- `src/renderer/figures/zenbot-rig.js`

本运行时只增加可选 rig 路径；`createZenbotFigure`、默认 sprite、`PetUpdate` 字段和主进程
配置均未改动。rig manifest 或 WebGL 不可用时，由上层回退现有精灵。

## 1. 接入方式

从渲染器模块导入异步工厂，加载成功后交给 `body.setFigure`：

```js
import { createZenbotRigFigure } from './figures/zenbot-rig.js';

const figure = await createZenbotRigFigure({
  // 可省略；默认就是 /characters/zenbot/rig/
  baseUrl: '/characters/zenbot/rig/',
  calibration: { ...calibration },
  calibrate: CALIBRATE,
  onError(error) {
    console.error('[codex-pet] zenbot rig error', error);
  },
  onFailure(error) {
    // 运行期不可恢复。切回 createZenbotFigure，并保留 calibration、气泡和命中区。
    console.error('[codex-pet] zenbot rig failed; falling back to sprite', error.code);
  },
});

body.setFigure(figure);
figure.setCalibration?.({ ...calibration });
```

`baseUrl` 指向 rig 资源根目录。若传入 `/characters/zenbot/` 或 `/characters/zenbot`，工厂会
自动补成 `.../rig/`；也可显式传 `rigBaseUrl`。可选 `spriteBaseUrl` 默认取 rig 根目录的父
目录，用于读取精灵 `manifest.json` 并核对 9 个别名和 19/18 覆盖。

`createZenbotRigFigure` 是 `async` 工厂：返回时 manifest、WebGL surface、neutral 表情和
全部部件纹理已经可用。初始化失败会抛出 `ZenbotRigError`，不会返回半成品。

### 选项

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `baseUrl` / `rigBaseUrl` | `/characters/zenbot/rig/` | rig manifest 和部件 PNG 的根 URL |
| `spriteBaseUrl` | rig 根的父目录 | 精灵 manifest 根；仅用于别名/覆盖核对 |
| `manifest` | 无 | 直接注入已解析 manifest，供测试或离线集成 |
| `spriteManifest` / `referenceManifest` | 无 | 直接注入精灵 manifest |
| `loadReferenceManifest` | `true` | 是否尝试读取精灵 manifest；失败不阻止 rig 初始化 |
| `calibration` | `{ x: 0, y: 0, scale: 1 }` | 与精灵相同的校准语义 |
| `calibrate` | `false` | 显示校准十字、命中圈和气泡锚点 |
| `availableFiles` | 无 | 可选 `Set`；提供时按磁盘文件名过滤/拒绝引用 |
| `pixelRatio` | 1–2（跟设备 DPR） | canvas 背衬倍率；上限 4 |
| `contextLossTimeoutMs` | `4000` | WebGL 上下文丢失后等待恢复的时间 |
| `poseRate` | `22` | 内置动作回退的平滑速率（仅 fallback 路径） |
| `motionEvaluator` / `motionAdapter` | 动态导入 | 可注入测试替身或替代动作层 |
| `useMotionLibrary` | `true` | 关闭后强制使用内置动作参数 |
| `onError(error)` | 无 | 初始化异常和非致命纹理/动作错误 |
| `onFailure(error)` | 无 | 运行期不可恢复错误；上层应切回精灵 |

### 返回接口

除精灵最小接口外，额外提供：

```js
{
  renderer: 'rig',
  ready: Promise<void>,
  state,              // 'ready' | 'lost' | 'failed' | 'disposed'
  failure,            // 不可恢复的 ZenbotRigError，或 null
  complete,           // 19 表情 + 18 动作覆盖是否齐全
  coverage, warnings, // 覆盖缺项和 manifest warning 的拷贝
  stats,              // 纹理、绘制次数、上下文丢失、覆盖缺项
  manifest,           // 规范化 manifest 的深拷贝，仅诊断
}
```

`draw(petG, face, frame)` 读取现有 frame 字段：`face`、`mode`、`modeT`、`talk`、
`facing`、`gesture`、`jumpV`、`airKind`，以及 kit 已提供的 `look`、`swing`、`sit`、
`drowse` 等。没有新增 `PetUpdate` 字段。

## 2. 加载顺序

1. 读取 `baseUrl/manifest.json`。
2. 可选读取父目录的精灵 manifest，核对表达式、动作和别名。
3. 校验并规范化 rig manifest。
4. 创建 SVG `foreignObject`，在其中创建 `<canvas>`，再调用 `kit/rig.js` 的 `createRig`。
5. 动态导入 `src/renderer/characters/zenbot-rig-motions.js`；不可用时使用内置动作回退。
6. 并行加载 neutral 表情和所有部件纹理，上传 WebGL。
7. 渲染首个静态帧，工厂返回。

纹理失败会进入失败表。运行期再次请求时，`2.5 s` 后允许重试。初始化阶段 neutral 或部件
纹理失败属于致命错误：抛出 `RIG_ERR_TEXTURE`，上层回退精灵。

## 3. Manifest 校验

`validateZenbotRigManifest(raw, options)` 检查：

- `schemaVersion === 1`，`id` 非空；`source`、纹理和部件路径必须是安全相对 PNG 路径。
  拒绝绝对路径、Windows 盘符、URL scheme、反斜杠、`..`、编码分隔符、`#`/`?` 等字符。
- `drawing`: `logoHeight`、`centerX`、`feetY`、`referenceCanvas`、`view`。默认要求冻结值
  `292 / 128 / 256 / [1117, 1409]`；`view` 必须是非零矩形。
- `defaults`: 气泡锚点、命中圆、extent、accent/eye 十六进制颜色；缺省时用契约值
  `[128, -58]`、`[128, 118, 142]`、`[-28, -72, 284, 256]`、`#63d8ff` 补全。
- `parts`: 非空数组；唯一 id；`box` 宽高大于零；`grid` 为正整数；`uvBox` 在 0–1 内；
  `alpha` 在 0–1 内；`z` 有限；`parent` 必须存在于 `deformers`；必须包含 `face_base`。
- `deformers`: 只允许 `rot` / `warp`；父链必须存在且不成环；`rot.pivot` 可省略，按契约
  的推荐 pivot 补全；`warp` 必须有正矩形。
- `textures`: 纹理表值是安全 PNG 路径。部件可写 `file`，也可通过 `tex`/`texture` 引用
  全局纹理表；同一纹理不能指向两个不同文件。
- `expressions`: 值可以是 PNG 文件、全局纹理 id，或 `{ file }` / `{ texture }` 对象；
  缺少 `neutral` 是致命错误。
- `expressionAliases`: 与精灵 manifest 完全一致；额外、缺失或改目标都会拒绝。
- 19 个表情和 18 个动作：缺单个表情/动作会写入 `coverage` 和 `warnings`，不阻止
  Wave 1 pilot 运行。缺表情时该表情使用 rig neutral；缺动作时使用程序化动作。
- `availableFiles`: 提供时，缺失部件纹理是致命错误；缺失表情从表中移除并记录 warning；
  `face_base` 自身文件缺失但 neutral 表情存在时，使用 neutral 表情文件。

规范化结果保留 `textures`、`parts`、`deformers`、`expressions`、`motions`、`timing`、
`coverage`、`warnings` 和可选 `fallback`。`createZenbotRigModel(manifest)` 输出
`kit/rig.js` 需要的 `{ view, deformers, parts }`。

## 4. 纹理与表情过渡

- 每个非 `face_base` 部件按自己的纹理键上传；`face_base` 的纹理键专门承载表情。
- 初始显示 `expressions.neutral`。
- 切换表情时先加载目标 PNG，再把目标上传到 `<face_tex>@mix`，`state.mix` 在
  `timing.expressionFadeMs`（默认 180 ms）内从 0 到 1。
- 过渡完成后把目标上传到 `<face_tex>`，并把 `mix` 归零；旧 `@mix` 纹理不再参与采样。
- 目标纹理正在加载时继续显示旧表情；加载失败时回退 rig neutral，并等待重试窗口。
- 图片缓存按 LRU 限制为 32 项，失败 URL 单独记录，不在每帧重复请求。
- `preloadWord(word)` 对表情预加载 PNG；对 18 个动作直接 resolve，因为动作由参数层生成。
- 若 art 提供 `eyelid_l` / `eyelid_r` / `eyelids` 部件，运行时用 `state.alpha` 驱动闭眼；
  若提供 `jaw` rot deformer，则用 `mouth.height` 驱动口型。Wave 1 分件没有这两个可选部件时，
  blink/talk 参数仍被计算，但不会单独改变 baked 表情纹理。

## 5. 动作参数

运行时优先使用 rig-motion worker 的 `zenbot-rig-motions.js`：

```js
evaluateZenbotRig(frame, seconds, { manifest, blink, ... })
adaptZenbotRigState(state, manifest)
```

该层输出九个稳定 deformer 的 `{ a, tx, ty, sx, sy }`，运行时直接交给
`rig.render(state)`。`turn` 由运行时检测 `frame.facing` 符号变化，并在没有更高优先级动作时
以显式 `motion: 'turn'` 和动作内计时播放，避免 idle 的 `modeT` 让转身瞬间结束。

动态导入失败或动作层抛错时，运行时记录一次 `RIG_ERR_MOTION`，切到本文件内置的
`evaluateZenbotRigMotion`。内置回退同样覆盖 18 个动作和 7 个短手势，并按契约优先规则选：

1. `gesture.kind` 优先；
2. `crouch` 按 `jumpV >= 650` 分 `jump` / `hop`；
3. `air → jump`，`wake → stand`；
4. 朝向变化且无更高优先级动作 → `turn`；
5. 结束回 idle 用指数平滑，不硬切。

表情纹理与动作层解耦：`frame.face` 通过 alias 和 rig 可用纹理选择；动作本身的姿态不会
替换 `face_base`，除非 kit 已把动作自己的 face 放进 frame。

## 6. WebGL、失败码与回退

`kit/rig.js` 已负责 `webglcontextlost` 的 `preventDefault`、`webglcontextrestored` 时重建
GL 资源和重新上传纹理。运行时额外监听同一 canvas：

- 丢失时 `state = 'lost'`，暂停 `rig.render`，记录 `contextLosses`。
- 恢复时 `state = 'ready'`，下一帧继续绘制。
- 超过 `contextLossTimeoutMs` 仍未恢复，进入 `failed`，调用 `onFailure`。

初始化失败直接抛出；运行期不可恢复通过 `onFailure` 通知。所有错误都是
`ZenbotRigError`，带 `code`、可选 `path` 和 `fallback: true`。

| code | 时机 | 上层动作 |
| --- | --- | --- |
| `RIG_ERR_DOM` | 没有 DOM 或缺少 SVG/canvas API | 回退精灵 |
| `RIG_ERR_BASE_URL` | `baseUrl` 为空 | 回退精灵或修正调用 |
| `RIG_ERR_FETCH` | manifest 读取失败 | 回退精灵 |
| `RIG_ERR_MANIFEST` | 校验失败 | 回退精灵 |
| `RIG_ERR_TEXTURE` | neutral/部件纹理失败 | 回退精灵 |
| `RIG_ERR_WEBGL` | 初始化或渲染失败 | 回退精灵 |
| `RIG_ERR_CONTEXT_LOST` | 上下文丢失且超时未恢复 | 回退精灵 |
| `RIG_ERR_MOTION` | 外部动作层异常，已切内置回退 | 记录，不一定要回退 |
| `RIG_ERR_DISPOSED` | 加载过程中 figure 已销毁 | 忽略 |

回退时不要清空气泡、命中区或校准；这些值来自 `anchors`、`hits`、`extent` 和
`setCalibration`，与精灵共用同一坐标语义。`onFailure` 中可异步创建精灵，
`body.setFigure(sprite)` 会调用 rig 的 `dispose()`。

## 7. 坐标与兼容

- 所有 rig 坐标是桌宠 logo units：参考画布 `1117 × 1409`，中心 `x = 128`，脚底
  `y = 256`，逻辑高度 `292`。
- manifest 的 `drawing.view` 默认 `[0, 0, 256, 256]`；canvas 放在对应
  `foreignObject` 中，CSS 尺寸等于 view 尺寸，背衬按 `pixelRatio` 放大。
- `anchors.bubble`、`extent`、`hits` 都经过与精灵相同的校准变换。
- `gestures`、`particles`、`colors.z`、`skinMeta`、`words`、`preloadWord`、
  `setCalibration`、`dispose` 与精灵接口兼容；`particles` 默认关闭爱心、Z、泪和音符，
  避免与 art 中已烘焙的符号重复。

## 8. 验证

```powershell
cd zebot
node --test tests/zenbot-rig-runtime.test.js
npm test
```

当前运行时测试覆盖：

- 合法 manifest、严格坐标、模型输出、同一 z 的部件顺序。
- 相对 PNG 路径、父链环、缺失父 deformer、box/grid/uv/alpha 错误、缺 `face_base`、
  缺 neutral。
- `availableFiles` 的过滤、warning 和致命缺失。
- 别名与精灵 manifest 完全一致的对错路径。
- 19/18 覆盖缺项记录，不误判为整体失败。
- 表达式 alias → neutral 回退、18 动作选择、动作参数有限性和平滑。
- rig-motion worker 输出经 `adaptZenbotRigState` 映射到实际 manifest deformer。
- 用 mock WebGL surface 完成一次真实工厂挂载、纹理切换、`draw`、校准、`preloadWord`
  和上下文丢失超时回退；这不是浏览器视觉验收，但覆盖了成功路径的代码连接。
- Node 无 DOM 的 `RIG_ERR_DOM`，以及有 DOM 但 WebGL 不可用的 `RIG_ERR_WEBGL`
  明确拒绝。

## 9. 已知限制

- 本次实现时 `assets/characters/zenbot/rig/manifest.json` 尚未由 art worker 交付；运行时用
  手工 fixture 测试，真实分件 manifest 的加载尚未验证。
- 未做 Electron 透明窗口、多显示器 DPI、SVG `foreignObject` 内 WebGL 的真实视觉验收；
  mock WebGL 只验证代码连接，不证明真实 GPU 输出、透明合成或画面位置。
- blink 需要可选眼睑部件，talk 需要可选 jaw deformer；只有 baked `face_base` 时，
  表情纹理不会单独闭眼或张嘴。
- `turn` / `spin` 是 2D 压缩/翻转近似，不等同 3D 转身；`walk` / `run` 腿只有一个 rot
  deformer，没有膝关节。
- 内置动作回退与 rig-motion 层曲线不同；正常运行应使用 rig-motion 层，fallback 只保证
  18 个动作持续可用。
- 贴图缓存和 GL 资源随 figure 释放；没有跨 figure 的持久缓存。
- canvas 背衬倍率在创建时确定；窗口移到不同 DPI 显示器后不会自动重建 canvas。
