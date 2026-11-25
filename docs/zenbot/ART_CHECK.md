# zenbot 美术文件检查

检查日期：2026-11-24（Asia/Shanghai）。文件检查范围为静态美术；运行时截图另行列在 `MOTION_INTEGRATION.md`，不替代长时间设备验收。

## 文件检查

- 19 个表情、18 个动作均已归档到 `assets/characters/zenbot/` 对应目录。
- 37 张均可解码、RGBA、有透明区域、四角 alpha=0，词条无缺失。
- `art-validation.json` 记录每张的 SHA-256、尺寸、alpha bbox、透明像素比例和边缘像素信息。
- 两张 contact sheet 均为 2400×2936；预览按比例缩放，原始 PNG 未调整画布或缩放。
- 部分图的低透明度边缘像素延伸至画布边缘；所有图的边缘 alpha 均低于 128。结合总览检查，未发现明显人物裁切，但此阈值本身不能证明绝无细微裁切。

## 可视核对

本聊天逐格查看两张总览，检查每个词条的人物、头身比例、发色、服装、全身轮廓、语义及明显禁止元素；未逐张进行原尺寸像素级人工检查。

- 表情第一行：neutral、happy、wink、love、shy，默认、笑脸、眨眼、心形眼、害羞可区分。
- 表情第二行：surprised、angry、sad、sleepy、thinking，惊讶、愤怒、悲伤、困倦、托腮思考可区分。
- 表情第三行：smug、pout、worried、determined、flustered，得意、嘟嘴、担心、坚定、慌乱可区分。
- 表情第四行：scared、excited、cry、confused，害怕、期待、大哭、歪头疑惑可区分。
- 动作第一行：stand、jump、hop、look、turn，站立、跳跃、轻跳、遮光张望、越肩转身可区分。
- 动作第二行：nod、shake、spin、sit、sleep，点头、带摆动线摇头、旋转、抱膝坐地、坐着打盹可区分。
- 动作第三行：dizzy、walk、run、wave、bow，眩晕、迈步、奔跑、招手、鞠躬可区分。
- 动作第四行：shiver、flap、dance，缩肩抱臂发抖、双臂弯曲扑腾并离地、单臂举起随音符舞动可区分。
- 总览中未发现明显背景场景、水印、鲸鱼附肢、女仆装或额外角色；胸牌在小比例预览中可见，未做 OCR 逐字校对。

## 母版透明度澄清

先前直接展示 trim 母版时出现白底与平台字样，曾据此登记疑点。实际 alpha 检查表明，右下字样所在抽查区域（图像右侧 10%、下侧 8% 的交集）alpha 全为 0；`neutral` 同区域亦如此。深浅底正常 alpha 合成的 `master-alpha-check.png` 中均不显示这些字样或矩形白底。疑点因此收拢为透明像素保留 RGB 内容的显示差异，无需重绘或替换母版；原文件未修改。

## 侧边聊天产物

侧边聊天线程 `01a20c04-0245-74a2-a1bc-d240e6c620fc` 的正文已不可访问，但保留了脸部审计图和两张动作候选。经姿态对照，两张候选分别合并为更清晰的 `flap` 与 `turn`；旧版保存在 `docs/zenbot/alternates/`。恢复依据和哈希见 `docs/zenbot/SIDE_CHAT_RECOVERY.md`。该判断依据视觉语义，不是对原提示词的逐字恢复。

## 后续边界

- 静态关键帧已全部归档并接入桌宠；用户尚未确认动作表现、动态模型方向和长时间实机体验。
- 图像尺寸及主体占比存在差异，尤其 hop、坐姿与跑姿。将来接入需依据 alpha bbox、基线及动作语义处理比例，不能把本总览缩放当作渲染规格。
- manifest、renderer 和动作状态机接入已完成；确定性动作截图见 `zenbot-wave-preview.png`、`zenbot-nod-preview.png`、`zenbot-flap-preview.png`、`zenbot-dance-preview.png` 和 `zenbot-sleep-preview.png`。
- 可复现文件检查和总览：在项目根目录运行 `python scripts/check-zenbot-art.py`。需要当前环境已存在的 Pillow；未安装新依赖。
