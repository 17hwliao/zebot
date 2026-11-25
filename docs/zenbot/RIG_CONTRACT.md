# zenbot Rig 合约

版本：1  
冻结日期：2026-11-24  
状态：Wave 0 冻结，rig 为可选路径，不替换默认精灵

## 1. 选型

主路径复用 `src/renderer/kit/rig.js`：

- 每个部件是一张透明纹理，映射到 logo 空间的矩形网格。
- 网格顶点经过 `rot` / `warp` deformer 链变换。
- 渲染器放在 SVG `foreignObject` 内的 `<canvas>` 中，由 `petG` 承载。
- 纹理使用浏览器 `<img>` 解码，再由 `rig.upload(key, image)` 上传到 WebGL。
- WebGL 不可用、manifest 校验失败、纹理加载失败或上下文不可恢复时，回退静态精灵。

如果 Electron 或 SVG `foreignObject` 实测不可用，备选方案是纯 SVG 分层 transform rig；切换方案前必须在本文件记录原因、影响和回退证据。

## 2. 坐标与注册

所有 rig 坐标使用桌宠 logo units：

- 参考画布：1117 × 1409 px
- logo 高度：292
- 中心：x = 128
- 脚底：y = 256
- 逻辑宽度：292 × 1117 / 1409 = 231.485
- 像素到 logo：`x = 128 + (px - 558.5) × 231.485 / 1117`
- 像素到 logo：`y = 256 - (1409 - py) × 231.485 / 1117`

母版 `zenbot-master-trim.png` 为 1601 × 2021；拆层前统一最近邻或 Lanczos 重采样到 1117 × 1409 注册画布。原始母版不得覆盖。

每个部件记录：

```json
{
  "id": "face_base",
  "file": "parts/face_base.png",
  "box": [45, 6, 166, 138],
  "grid": [10, 10],
  "parent": "head",
  "z": 60,
  "alpha": 1
}
```

`box` 是该裁切 PNG 在 logo 空间的 `[x, y, width, height]`。纹理 PNG 应裁到部件包围盒，默认 `uvBox = [0, 0, 1, 1]`。

## 3. 部件命名

Wave 1 最小 pilot：

| ID | 内容 | 父 deformer | 默认 z |
| --- | --- | --- | ---: |
| `hair_back` | 后发与长发主体 | `hair_back` | 10 |
| `leg_l` / `leg_r` | 左/右腿 | `leg_l` / `leg_r` | 20 |
| `shoe_l` / `shoe_r` | 左/右鞋 | `leg_l` / `leg_r` | 22 |
| `skirt_back` | 裙摆后半 | `skirt` | 28 |
| `torso` | 身体、衬衫、颈部 | `chest` | 36 |
| `skirt_front` | 裙摆前半 | `skirt` | 40 |
| `jacket_front` | 外套前片 | `chest` | 44 |
| `badge` | `ZENIX+` 胸牌 | `chest` | 46 |
| `arm_l` / `arm_r` | 袖子与手 | `arm_l` / `arm_r` | 50 |
| `face_base` | 脸、前发、耳机、发饰、表情主体 | `head` | 60 |
| `hair_front` | 可选的独立刘海/侧发 | `head` | 62 |

Wave 2 可增加 `hand_l`、`hand_r`、`headphones`、`hair_ornament`、`skirt_side_l`、`skirt_side_r`，但不得重命名以上稳定 ID。

`head` 是 deformer 名称，不要求存在同名 PNG 部件；`face_base` 是表情纹理部件。

## 4. 骨架层级

```text
root
└─ body
   ├─ skirt
   │  ├─ leg_l
   │  └─ leg_r
   ├─ chest
   │  ├─ arm_l
   │  ├─ arm_r
   │  └─ head
   │     ├─ hair_back
   │     └─ face_base
```

推荐 pivot：

- `body`：`[128, 232]`
- `chest`：`[128, 210]`
- `head`：`[128, 96]`
- `hair_back`：`[128, 78]`
- `arm_l`：`[88, 156]`
- `arm_r`：`[168, 156]`
- `skirt`：`[128, 204]`
- `leg_l`：`[109, 219]`
- `leg_r`：`[147, 219]`

pivot 可在 manifest 中微调，但语义和父子关系保持稳定。

## 5. Rig Manifest Schema

文件：`assets/characters/zenbot/rig/manifest.json`

```json
{
  "schemaVersion": 1,
  "id": "zenbot-rig",
  "source": "assets/characters/zenbot/source/zenbot-master-trim.png",
  "drawing": {
    "logoHeight": 292,
    "centerX": 128,
    "feetY": 256,
    "referenceCanvas": [1117, 1409],
    "view": [0, 0, 256, 256]
  },
  "defaults": {
    "expression": "neutral",
    "bubbleAnchor": [128, -58],
    "hit": [128, 118, 142],
    "extent": [-28, -72, 284, 256],
    "accent": "#63d8ff",
    "eye": "#4fd6ff"
  },
  "textures": {
    "face_neutral": "parts/face-neutral.png"
  },
  "parts": [],
  "deformers": {},
  "expressions": {},
  "motions": {},
  "timing": {
    "expressionFadeMs": 180,
    "blinkCloseMs": 130,
    "breathSeconds": 4.2
  },
  "fallback": {
    "figure": "sprite",
    "manifest": "assets/characters/zenbot/manifest.json"
  }
}
```

校验要求：

- 路径不得为绝对路径、反斜杠、父目录或非 PNG。
- `parts` 的 `parent` 必须存在于 `deformers`，deformer 父链不得成环。
- 所有 `box` 宽高必须大于零。
- `z` 必须有限，重复 z 按 parts 顺序稳定排序。
- `face_base` 和至少一个 `neutral` 表情纹理必须存在。
- 19 个表情 ID 和 18 个动作 ID 必须与精灵 manifest 一致；缺失项记录后由 runtime 回退到精灵。
- 纹理、部件和表情引用必须通过 `availableFiles` 磁盘检查（测试可省略）。

## 6. 表情映射

- 表情列表沿用 `ZENBOT_EXPRESSION_IDS`。
- `face_base` 的纹理在运行时切换；过渡使用 `face_base@mix`，默认 180 ms。
- `expressionAliases` 与精灵 manifest 完全一致。
- 当 rig 缺少某个表情纹理时，使用 rig `neutral`；当 rig 整体不可用时，直接回退精灵的同一别名逻辑。

19 个表情：

`neutral`、`happy`、`wink`、`love`、`shy`、`surprised`、`angry`、`sad`、`sleepy`、`thinking`、`smug`、`pout`、`worried`、`determined`、`flustered`、`scared`、`excited`、`cry`、`confused`。

## 7. 动作映射

rig 使用连续参数 `breath`、`blink`、`gazeX`、`gazeY`、`talk`、`bodyY`、`bodyRot`、`headRot`、`armLRot`、`armRRot`、`hairSway`、`skirtSway`、`legL`、`legR`、`squash`、`turn` 和可选 `faceMix`。动作 ID 与现有 18 个动作一致：

`stand`、`jump`、`hop`、`look`、`turn`、`nod`、`shake`、`spin`、`sit`、`sleep`、`dizzy`、`walk`、`run`、`wave`、`bow`、`shiver`、`flap`、`dance`。

动作选择规则保持：

- 手势优先于模式。
- `crouch` 根据 `jumpV >= 650` 区分 `jump` / `hop`。
- `air` → `jump`。
- `wake` → `stand`。
- facing 变化在没有更高优先级动作时触发 `turn`。
- 动作完成后参数平滑回 idle，不做硬切。

## 8. Figure 兼容接口

`createZenbotRigFigure(options)` 必须返回与精灵相同的最小接口：

```js
{
  draw(petG, face, frame),
  anchors: { bubble: [x, y] },
  extent: [x0, y0, x1, y1],
  hits: [[x, y, r]],
  gestures: [...],
  particles: { heart, z, tear, note },
  colors: { z },
  skinMeta: { id, label, accent, eye },
  words: [...],
  preloadWord(word),
  setCalibration(value),
  dispose()
}
```

额外允许：

```js
{
  renderer: 'rig',
  ready: Promise<void>,
  get stats()
}
```

`draw` 至少识别 `frame.face`、`frame.mode`、`frame.modeT`、`frame.talk`、`frame.facing`、`frame.gesture`、`frame.jumpV`、`frame.airKind`。`PetUpdate` 不新增 rig 专有字段。

## 9. 选择与回退

- `sprite`：强制现有 `createZenbotFigure`。
- `rig`：尝试 rig；加载失败仍回退 sprite，并记录一次错误。
- `auto`：初始优先 rig；运行期 WebGL 丢失且恢复失败时切换 sprite。
- 默认仍是 sprite。`--zenbot-rig` 只覆盖当前启动，不写配置；持久化选择由后续设置项决定。

回退不得清空气泡、命中区或校准；sprite 和 rig 共用同一套 `anchors`、`extent`、`hits`、`calibration` 语义。

## 10. 文件所有权

| 所有者 | 文件 |
| --- | --- |
| 根代理 | `RIG_BASELINE.md`、`RIG_CONTRACT.md`、`docs/DESIGN.md`、`PROJECT_STATE.md`、`src/renderer/main.js`、`src/main/main.js`、`src/main/config.js`、`src/main/menu-model.js`、集成测试入口 |
| rig-art | `assets/characters/zenbot/rig/**`、`docs/zenbot/rig/art/**`、`scripts/check-zenbot-rig-art.py` |
| rig-runtime | `src/renderer/figures/zenbot-rig.js`、`src/renderer/characters/zenbot-rig-manifest.js`、`tests/zenbot-rig-runtime.test.js`、`docs/zenbot/rig/runtime.md` |
| rig-motion | `assets/characters/zenbot/rig/motions/**`、`src/renderer/characters/zenbot-rig-motions.js`、`tests/zenbot-rig-motion.test.js`、`docs/zenbot/rig/motions.md` |
| rig-verify | `docs/zenbot/rig/evidence/**`、`tests/zenbot-rig-integration.test.js`、`scripts/check-zenbot-rig.py` |

跨所有权修改只能由根代理执行。worker 不提交 Git，不推送，不修改原始母版或精灵回退素材。

