# zenbot Rig 动作参数系统

日期：2026-11-24  
范围：Wave 1 + Wave 2 的程序化动作、连续微动、表情辅助参数和 deformer 适配  
实现：`src/renderer/characters/zenbot-rig-motions.js`  
元数据：`assets/characters/zenbot/rig/motions/spec.json`

本层只计算参数，不创建 DOM、WebGL、纹理或 figure。运行时仍由 rig runtime 读取
`assets/characters/zenbot/rig/manifest.json`，把参数交给 `kit/rig.js` 渲染。默认 sprite
路径、`PetUpdate` 字段和 art manifest 均未改动。

## 1. 导出 API

```js
import {
  ZENBOT_RIG_MOTION_IDS,
  ZENBOT_RIG_DEFORMER_IDS,
  ZENBOT_RIG_GESTURE_IDS,
  ZENBOT_RIG_MOTION_SPECS,
  ZENBOT_RIG_LIMITS,
  resolveZenbotRigMotion,
  evaluateZenbotRig,
  adaptZenbotRigState,
  createZenbotRigDeformerAdapter,
} from './characters/zenbot-rig-motions.js';
```

### `evaluateZenbotRig(frame, time, options)`

纯函数。输出只由入参决定，不读取 `Date.now()`、`performance.now()` 或 `Math.random()`，
也不保存上一帧状态。`time` 是单调递增的秒数；传入较小值会让结果回到对应时间点，调用方
负责不倒退。

```js
const state = evaluateZenbotRig(frame, seconds, {
  manifest,
  phase: pet.phase / (Math.PI * 2),
  velocityX: pet.velX,
  blink: { seed: sessionSeed },
  expressionAge: seconds - faceChangedAt,
  expressionFadeSeconds: manifest.timing.expressionFadeMs / 1000,
});
```

`frame` 沿用现有 figure 契约，至少可读取：

| 字段 | 含义 |
| --- | --- |
| `frame.face` | 表情名或 alias |
| `frame.mode` | `idle`、`walk`、`run`、`look`、`sit`、`sleep`、`dizzy`、`dance`、`wake`、`crouch`、`air`、`land` 等 |
| `frame.modeT` | 当前模式已持续秒数；用于动作进度 |
| `frame.motionT` | 可选；动作自身的连续计时，跨模式切换时由运行时保留 |
| `frame.talk` | 0–1 口型强度 |
| `frame.facing` | `1` / `-1`；与 `options.previousFacing` 不同时触发 `turn` |
| `frame.gesture` | `{ kind, k }`；`kind` 是 7 个短手势之一，`k` 为 0–1 |
| `frame.jumpV` | `crouch` 区分 `jump`（`>= 650`）和 `hop` |
| `frame.airKind` | 保留读取；`air` 按契约选 `jump` |
| `frame.look` | `[x, y]` 视线偏移，logo units |
| `frame.blink` / `frame.eyeClose` | 0–1 眨眼闭合量，优先于自动 blink |
| `frame.swing` | kit 的次级摆动输入，±40° |
| `frame.drowse` | 0–1 困倦度，透传到输出 |
| `frame.faceMix` | 0–1 表情混合量 |

### `options`

| 字段 | 默认 | 用途 |
| --- | --- | --- |
| `manifest` | 无 | 读取 `timing`、`expressionAliases`；也便于直接把同一对象交给 adapter |
| `motion` | 无 | 强制动作，主要用于确定性预览或测试 |
| `motionT` | 无 | 覆盖当前动作计时；`frame.motionT` 次之，`frame.modeT` 再次 |
| `phase` | `0` | walk/run/dance 循环相位，单位是圈（0–1，可超出后取模） |
| `velocityX` | `0` | 水平速度，驱动 hair/skirt 次级摆动 |
| `gaitWeight` | `1` | walk/run 步态总权重；运行时收步时在 0.2–0.25 s 内降到 0 |
| `sitK` | `frame.sit` | 无 frame 时的坐姿量，用于坐下↔站起的连续过渡 |
| `blink` | 自动确定性日程 | 数字、函数、`{ value }`、`{ seed, period, jitter, closeSeconds }` 或 `false` |
| `talk` | `frame.talk` | 无 frame 时的口型强度 |
| `talkHz` | `9.5` | 口型频率，限制在 8–12 Hz |
| `gaze` | `frame.look` | `[x, y]` 或 `{ x, y }` |
| `breathSeconds` | manifest / 4.2 | idle 呼吸周期 |
| `expressionAliases` | manifest 别名 | 表情别名解析 |
| `expressionAge` + `expressionFadeSeconds` | 无 | 从 0 平滑到 1 的表情混合 |
| `turn` | 无 | 无更高优先级动作时触发 `turn` |
| `previousFacing` | 无 | 朝向变化触发 `turn` |

## 2. 输出

```js
{
  schemaVersion: 1,
  time: 12.34,
  motion: {
    id: 'wave',
    gestureId: 'wave',
    baseId: 'walk',
    layer: 'gesture',
    elapsed: 0.714,
    duration: 1.7,
    progress: 0.42,
    loop: false,
    phase: 0.84,
    phaseRadians: 5.277876,
    cadence: 2.1,
    step: 1,
    gaitWeight: 1
  },
  expression: {
    face: 'happy',
    mix: 1,
    blink: 0,
    eyeOpen: 1,
    drowse: 0,
    gazeX: 2.5,
    gazeY: -1.2,
    gazeWeight: 0
  },
  mouth: {
    open: 0.49,
    openUnits: 2.72,
    width: 45.95,
    height: 2.72,
    rate: 9.5,
    shape: 'talk',
    talk: 0.5
  },
  params: {
    breath: 0.12,
    blink: 0,
    gazeX: 2.5,
    gazeY: -1.2,
    talk: 0.5,
    bodyY: -1.8,
    bodyRot: 2.5,
    headRot: -1.5,
    armLRot: 14.2,
    armRRot: -102.4,
    hairSway: 2.1,
    skirtSway: -1.5,
    legL: 19.4,
    legR: -19.4,
    squash: 0,
    turn: 0,
    faceMix: 1
  },
  deformers: {
    body: { a: 2.5, tx: 0, ty: -1.8, sx: 1, sy: 1 },
    // chest, head, hair_back, arm_l, arm_r, skirt, leg_l, leg_r
  }
}
```

`deformers` 使用 `kit/rig.js` 的 rot 状态字段：

- `a`：旋转角度，degrees。
- `tx` / `ty`：logo units 平移；`+ty` 向下。
- `sx` / `sy`：绕 deformer pivot 的缩放。

坐标沿用 `RIG_CONTRACT.md`：1117 × 1409 注册画布、logo 高度 292、中心 x=128、
脚底 y=256。动作层不自行改变坐标原点。

## 3. Deformer 映射

规范 ID 与默认 pivot：

| 规范 ID | 父链中的位置 | 默认 pivot | 本层用途 |
| --- | --- | --- | --- |
| `body` | root → body | `[128, 232]` | 整体起伏、倾斜、turn/spin 水平压缩 |
| `chest` | body → chest | `[128, 210]` | 呼吸、鞠躬、步态前倾 |
| `head` | chest → head | `[128, 96]` | 点头、摇头、视线和睡眠低头 |
| `hair_back` | head → hair_back | `[128, 78]` | 后发次级摆动、转动拖尾 |
| `arm_l` | chest → arm_l | `[88, 156]` | 左袖/手 |
| `arm_r` | chest → arm_r | `[168, 156]` | 右袖/手；wave 主用手 |
| `skirt` | body → skirt | `[128, 204]` | 裙摆拖尾、坐姿 |
| `leg_l` | skirt → leg_l | `[109, 219]` | 左腿步态与坐姿 |
| `leg_r` | skirt → leg_r | `[147, 219]` | 右腿步态与坐姿 |

`adaptZenbotRigState(state, manifestOrDeformers, options)` 把规范状态映射到实际 manifest
deformer 名：

```js
const adapted = adaptZenbotRigState(state, manifest);
rig.render(adapted.deformers);

// 或复用同一映射
const adapt = createZenbotRigDeformerAdapter(manifest);
const next = adapt(evaluateZenbotRig(frame, seconds, { manifest }));
```

默认取同名 deformer；找不到时跳过并记录在 `missingDeformers`。以下情况支持别名：

```js
adaptZenbotRigState(state, manifest, {
  aliases: { body: 'body_main', head: 'head_main' },
});

// 或 manifest 声明：
// "body_main": { "kind": "rot", "canonicalId": "body" }
// "motionBindings": { "deformers": { "body": "body_main" } }
```

`strict: true` 时缺任一规范 deformer 会抛错。返回对象还包含
`deformerMapping`（规范名 → manifest 名）和 `missingDeformers`。未传 manifest 时保持
九个规范名不变。

## 4. 动作选择

优先级从高到低：

1. `frame.gesture.kind` 为 `nod` / `shake` / `spin` / `wave` / `bow` / `shiver` / `flap`。
2. `options.motion` 或 `frame.motion`；短手势 ID 仍进入 gesture 层。
3. `wake` → `stand`；`walk` / `run` / `look` / `sit` / `sleep` / `dizzy` / `dance` 直接映射。
4. `crouch` 按 `jumpV >= 650` 选 `jump`，否则 `hop`。
5. `air` → `jump`。
6. 空闲时 `turn: true` 或 `previousFacing` 变化 → `turn`。
7. 否则 idle 连续层。

短手势运行在 gesture 层，当前模式保留为 base 层。两层都触及同一 deformer 时，手势值
为主，base 只保留 15% 的次要分量；没有冲突的腿、裙、另一只手臂继续当前模式。因此
`walk + wave` 仍保留步态，只由右手、胸和头执行招手。

## 5. 18 个动作参数表

所有区间单位为秒，来自 `RIG_BASELINE.md`。`walk` / `run` 的 manifest 片段为 12 s，
但运动层按循环计算；12 s 只用于片段长度和预览进度。

| 动作 | 时长 | 起势 | 峰值/保持 | 尾帧 | 主要幅度 |
| --- | ---: | --- | --- | --- | --- |
| `stand` | 1.2 | 0–0.18 | 0.18–0.45 伸展 | 0.45–1.2 | body −2.1、chest 1.4°、arm 7° |
| `jump` | 1.2 | 0–0.16 下蹲 | 0.16–0.58 腾空 | 0.58–1.2 | body 高 34、squash 0.14、arm 52° |
| `hop` | 0.9 | 0–0.12 轻蹲 | 0.12–0.42 小跳 | 0.42–0.9 | body 高 15、squash 0.09、arm 26° |
| `look` | 2.7 | 0–0.25 | 0.25–1.8 左右张望 | 1.8–2.7 | head 2.4°/2.1、gaze ±5/±4 |
| `turn` | 0.4 | 0–0.12 | 0.12–0.3 越肩 | 0.3–0.4 | body 3.5°、sx 0.44、head 4.5° |
| `nod` | 0.8 | 0–0.12 | 0.12–0.62 两次低头 | 0.62–0.8 | head 4.8°、headY 3.6、chest 2.1° |
| `shake` | 0.8 | 0–0.1 | 0.1–0.64 左右摇 | 0.64–0.8 | head 4.2°、headX 3.2、bodyX 2.6 |
| `spin` | 0.8 | 0–0.12 | 0.12–0.64 转体 | 0.64–0.8 | sx 最小 0.18、arm 14°、hair 3.4° |
| `sit` | 0.8 + 保持 | 0–0.35 屈膝 | 0.35–0.6 落座 | 保持 | bodyY 8.5、leg 27°、skirt 2.8° |
| `sleep` | 0.8 + 保持 | 0–0.5 放松 | 0.5 后呼吸保持 | 保持 | bodyY 8、head 3.8°、breath 5.25 s |
| `dizzy` | 3.2 | 0–0.25 失衡 | 0.25–2.4 摇头 | 2.4–3.2 回正 | body 4.8°、head 5.2°、arm 14° |
| `walk` | 循环 | 0–0.2 起步 | 2.1 cycles/s | 停止 0.25 s | leg 23°、arm 17°、bob 1.9 |
| `run` | 循环 | 0–0.16 起步 | 4.4 cycles/s | 停止 0.2 s | leg 40°、arm 34°、lean 8° |
| `wave` | 1.7 | 0–0.18 抬手 | 0.18–1.2 挥手 | 1.2–1.7 放下 | arm_r −112°、摆动 12°、head 2.4° |
| `bow` | 1.7 | 0–0.22 低头 | 0.22–0.8 保持 | 0.8–1.7 回正 | body 5°、chest 21°、head 8° |
| `shiver` | 1.9 | 0–0.16 缩肩 | 0.16–1.35 高频抖动 | 1.35–1.9 放松 | bodyX 1.1、head 2.4°、arm 9.2° |
| `flap` | 1.5 | 0–0.16 蹲下 | 0.16–0.85 扑腾 | 0.85–1.5 落稳 | body 高 23、arm 82°、skirt ≤4° |
| `dance` | 3.4 | 0–0.25 起拍 | 0.25–2.8 左右踩拍 | 2.8–3.4 收势 | body 4.8°、arm 32°、leg 18° |

## 6. 曲线与连续系统

- 所有分段使用 `smoothstep`，单次冲击使用 `sin²(πk)` 钟形；没有硬切端点。
- 一次性动作在尾部回到 0；`sit` / `sleep` 在 `lasting` 后保持姿态。
- 输出数值统一 clamp 到有限范围，并保留 6 位小数，避免 `-0`。

### idle 呼吸

```text
breath = sin(2πt / 4.2)
chest.ty = -0.6 × breath
head.ty  = +0.2 × breath
```

睡眠时周期 5.25 s，幅度 0.75 倍。呼吸以绝对 `time` 计算，所以模式切换不会重新起拍。

### talk 口型

```text
carrier = 0.5 + 0.5 sin(2π × hz × t + 0.65 sin(2π × 2.3t))
open    = talk × (0.18 + 0.82 × carrier^0.72)
```

`talk` 先 clamp 到 0–1，`hz` clamp 到 8–12 Hz；最大开口 5.5 logo units，宽度 42–50。
`talk = 0` 时严格闭嘴。

### blink

默认时间表不使用全局随机数：

```text
start(n) = n × 3.8 + hash(n, seed) × 1.4
close    = 0.11–0.16 s
```

相邻间隔覆盖约 2.4–5.2 s。`hash` 是纯整数混合函数。也可直接传
`{ value }`、函数或 `false`。`frame.eyeClose` / `frame.blink` 优先级最高。

### gaze

`frame.look` 或 `options.gaze` 先 clamp 到 x ±5、y ±4 logo units。`look` / `dizzy`
动作有自己的 gaze 权重；返回值按权重与原视线混合。离开视线目标后的回正由运行时输入
完成，本层不保存上一帧。

### walk / run 步态

```text
phase = 2π × (phaseOffset + cadence × elapsed)
leg_l = -legAmplitude × sin(phase)
leg_r = +legAmplitude × sin(phase)
arm_l = -armAmplitude × sin(phase)
arm_r = +armAmplitude × sin(phase)
```

左腿向前时右腿向后；腿的 `ty` 只在摆动侧抬起。`motion.phase` 是 0–1 循环相位，
`phaseRadians` 是弧度，`step` 在每半个周期切换，可用于脚步声。

`options.phase` 应由运行时基于自身连续相位提供；不提供时从当前模式开始时刻起算。
步态在前 0.16–0.2 s 用 `smoothstep` 从 0 起势；收步时由运行时把 `gaitWeight` 从 1
平滑降到 0，再切 idle。

### hair / skirt 次级摆动

```text
hair = clamp(motionHair + 0.5 × velocitySway + 0.085 × swing, ±3.5°)
skirt = clamp(motionSkirt + velocitySway + 0.068 × swing, ±4°)
```

`velocitySway = clamp(-velocityX × 0.012 × facing, ±3)`。walk/run 的自身摆动与
`sin(phase - 0.55..0.7)` 错相，形成滞后；dance 另加不超过 1.2° 的摆动分量。

## 7. 表情与口型

`expression.face` 按 `frame.face` → alias → 19 个合法 ID 解析；未知值回退 `neutral`。
`expression.mix` 可直接使用 figure 的 faceMix，或由 `expressionAge` /
`expressionFadeSeconds` 算 smoothstep。`expression.blink` 与表情纹理独立，因此闭眼、
视线和口型可以叠在任意表情上。

该层不切换纹理。runtime 需要用 `expression.face` 选择 rig 表情纹理，用
`expression.mix` 做 `face_base@mix` 交叉淡入，用 `mouth` 驱动口型部件或 warper。

## 8. 测试与限制

`node --test tests/zenbot-rig-motion.test.js`：22/22 通过。覆盖：

- 18 个动作 ID、九种 deformer 名、时长和 spec.json 一致性。
- crouch 的 `jump` / `hop` 区分和腾空幅度差。
- 短手势优先、base 模式保留、腿步态不被取消。
- walk/run 一周期严格重复、密集采样连续性、run 幅度更大。
- crouch → air → land 的 jump 相位连续、sit → stand 连续性、步态起势与收步权重。
- talk / blink / gaze 的边界、clamp、频率限制和确定性。
- 不调用 `Math.random()`；同时间不同 `dt` 输出一致。
- manifest 同名、别名、缺失和 `strict` 适配。

已知限制：

- 2D rot rig 没有真正的水平轴 yaw；`turn` 用 `sx` 压缩模拟，`spin` 用 `sx` 翻转，
  视觉上不等同于 3D 转身。
- 腿只有一个 rot deformer，没有膝关节；走跑的抬脚依靠 `leg.ty`。
- 坐姿的身体下移和腿部旋转是参数近似，须结合实际拆层 pivot 和遮挡检查。
- `sit` / `sleep` 的 `lasting` 姿态会一直保持，退出时的平滑回 idle 由运行时决定
  （可继续用本层 `stand` 或把动作计时重新开始）。
- 本层未连接 runtime，也未做 Electron 视觉验收；不能把单元测试通过当作实际画面通过。
