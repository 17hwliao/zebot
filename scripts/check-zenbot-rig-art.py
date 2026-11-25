import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
CHAR_ROOT = ROOT / "assets/characters/zenbot"
RIG_ROOT = CHAR_ROOT / "rig"
DOCS_ART = ROOT / "docs/zenbot/rig/art"
BUILD_ROOT = RIG_ROOT / "_build"

EXPRESSION_IDS = [
    "neutral", "happy", "wink", "love", "shy", "surprised", "angry", "sad",
    "sleepy", "thinking", "smug", "pout", "worried", "determined", "flustered",
    "scared", "excited", "cry", "confused",
]
MOTION_IDS = [
    "stand", "jump", "hop", "look", "turn", "nod", "shake", "spin", "sit",
    "sleep", "dizzy", "walk", "run", "wave", "bow", "shiver", "flap", "dance",
]
REQUIRED_DEFORMERS = [
    "root", "body", "chest", "head", "hair_back", "arm_l", "arm_r", "skirt", "leg_l", "leg_r",
]


def load_font(size, bold=False):
    name = "arialbd.ttf" if bold else "arial.ttf"
    candidate = Path("C:/Windows/Fonts") / name
    if candidate.exists():
        return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def check_safe_rel_png(rel):
    if not isinstance(rel, str) or not rel.endswith(".png"):
        raise ValueError(f"invalid png path: {rel!r}")
    if rel.startswith("/") or "\\" in rel or ".." in rel.split("/") or ":" in rel:
        raise ValueError(f"unsafe relative path: {rel!r}")


def inspect_png(path):
    if not path.exists():
        raise FileNotFoundError(f"missing PNG: {path}")
    with Image.open(path) as im:
        im.load()
        if im.mode != "RGBA":
            raise ValueError(f"{path}: expected RGBA, got {im.mode}")
        alpha = im.getchannel("A")
        bbox = alpha.getbbox()
        if bbox is None:
            raise ValueError(f"{path}: completely transparent image")
        arr = np.array(alpha)
        opaque = int((arr > 0).sum())
        total = int(arr.size)
        return {
            "path": path.relative_to(ROOT).as_posix(),
            "size": [im.width, im.height],
            "alpha_bbox": list(bbox),
            "nontransparent_pixels": opaque,
            "nontransparent_fraction": round(opaque / total, 6),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }


def draw_parts_overview(manifest):
    parts = manifest["parts"]
    cols = 6
    rows = (len(parts) + cols - 1) // cols
    tw, th = 260, 300
    sheet = Image.new("RGB", (cols * tw + 40, rows * th + 90), "#1f2430")
    draw = ImageDraw.Draw(sheet)
    draw.text((24, 20), f"zenbot rig parts overview ({len(parts)} parts, sorted by z)", font=load_font(28, True), fill="#eef2f7")
    for idx, part in enumerate(parts):
        col = idx % cols
        row = idx // cols
        x0 = 20 + col * tw
        y0 = 76 + row * th
        draw.rounded_rectangle((x0 + 6, y0 + 6, x0 + tw - 6, y0 + th - 6), radius=12, fill="#2a3142", outline="#44506b", width=2)
        im = Image.open(RIG_ROOT / part["file"]).convert("RGBA")
        im.thumbnail((tw - 36, th - 76), Image.Resampling.LANCZOS)
        sheet.paste(im, (x0 + (tw - im.width) // 2, y0 + 18 + (th - 76 - im.height) // 2), im)
        label = f"{part['id']} (z={part['z']})"
        draw.text((x0 + tw // 2, y0 + th - 26), label, font=load_font(16, True), fill="#e2e8f0", anchor="mm")
    out = DOCS_ART / "parts-overview.png"
    sheet.save(out)
    return out


def draw_expressions_overview(manifest):
    cols = 5
    rows = (len(EXPRESSION_IDS) + cols - 1) // cols
    tw, th = 260, 300
    sheet = Image.new("RGB", (cols * tw + 40, rows * th + 90), "#1f2430")
    draw = ImageDraw.Draw(sheet)
    draw.text((24, 20), f"zenbot rig expressions overview ({len(EXPRESSION_IDS)} expressions)", font=load_font(28, True), fill="#eef2f7")
    for idx, name in enumerate(EXPRESSION_IDS):
        col = idx % cols
        row = idx // cols
        x0 = 20 + col * tw
        y0 = 76 + row * th
        draw.rounded_rectangle((x0 + 6, y0 + 6, x0 + tw - 6, y0 + th - 6), radius=12, fill="#2a3142", outline="#44506b", width=2)
        rel = manifest["expressions"][name]["file"]
        im = Image.open(RIG_ROOT / rel).convert("RGBA")
        im.thumbnail((tw - 36, th - 76), Image.Resampling.LANCZOS)
        sheet.paste(im, (x0 + (tw - im.width) // 2, y0 + 18 + (th - 76 - im.height) // 2), im)
        draw.text((x0 + tw // 2, y0 + th - 26), name, font=load_font(18, True), fill="#e2e8f0", anchor="mm")
    out = DOCS_ART / "expressions-overview.png"
    sheet.save(out)
    return out


def draw_compose_comparison():
    master_im = Image.open(CHAR_ROOT / "source/zenbot-master-trim.png").convert("RGBA").resize((1117, 1409), Image.Resampling.LANCZOS)
    comp_path = BUILD_ROOT / "compose-check.png"
    if not comp_path.exists():
        raise FileNotFoundError(f"missing {comp_path}; run finish.py first")
    comp_im = Image.open(comp_path).convert("RGBA")

    m_arr = np.array(master_im)
    c_arr = np.array(comp_im)
    union = (m_arr[:, :, 3] > 0) | (c_arr[:, :, 3] > 0)
    rgb_diff = np.abs(m_arr[:, :, :3].astype(np.int16) - c_arr[:, :, :3].astype(np.int16)).max(axis=2)
    alpha_diff = np.abs(m_arr[:, :, 3].astype(np.int16) - c_arr[:, :, 3].astype(np.int16))
    diff_mag = np.maximum(rgb_diff, alpha_diff)
    visible_diff = union & (diff_mag > 12)

    # Create amplified diff visualization
    diff_vis = np.zeros((1409, 1117, 4), dtype=np.uint8)
    diff_vis[:, :, 3] = 255
    diff_vis[:, :, 0] = np.clip(diff_mag * 4, 0, 255).astype(np.uint8)
    diff_vis[:, :, 1] = np.where(visible_diff, 40, 24).astype(np.uint8)
    diff_vis[:, :, 2] = np.where(visible_diff, 40, 32).astype(np.uint8)
    diff_im = Image.fromarray(diff_vis, "RGBA")

    pw, ph = 520, 660
    sheet = Image.new("RGB", (pw * 3 + 80, ph + 110), "#1c212c")
    draw = ImageDraw.Draw(sheet)
    draw.text((24, 18), "zenbot rig composition comparison (master vs composed vs 4x diff)", font=load_font(26, True), fill="#eef2f7")
    panels = [
        ("Master (1117x1409)", master_im),
        ("Rig Composed (18 parts)", comp_im),
        (f"Diff > 12: {int(visible_diff.sum())} px", diff_im),
    ]
    for i, (title, im) in enumerate(panels):
        x0 = 20 + i * (pw + 20)
        y0 = 72
        bg = Image.new("RGBA", (pw, ph), (242, 244, 248, 255) if i < 2 else (24, 24, 32, 255))
        thumb = im.copy()
        thumb.thumbnail((pw - 16, ph - 16), Image.Resampling.LANCZOS)
        bg.alpha_composite(thumb, ((pw - thumb.width) // 2, (ph - thumb.height) // 2))
        sheet.paste(bg.convert("RGB"), (x0, y0))
        draw.text((x0 + pw // 2, y0 + ph + 18), title, font=load_font(20, True), fill="#e2e8f0", anchor="mm")
    out = DOCS_ART / "compose-comparison.png"
    sheet.save(out)
    return out, {
        "unionPixels": int(union.sum()),
        "differingPixelsGt12": int(visible_diff.sum()),
        "differingFraction": round(float(visible_diff.sum()) / max(1, int(union.sum())), 6),
        "meanRgbDiffOnUnion": round(float(rgb_diff[union].mean()), 4) if union.any() else 0.0,
    }


def main():
    manifest_path = RIG_ROOT / "manifest.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"missing rig manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    if manifest.get("schemaVersion") != 1:
        raise ValueError("manifest schemaVersion must be 1")
    for d in REQUIRED_DEFORMERS:
        if d not in manifest.get("deformers", {}):
            raise ValueError(f"missing required deformer: {d}")

    DOCS_ART.mkdir(parents=True, exist_ok=True)
    parts_report = []
    seen_part_ids = set()
    for part in manifest.get("parts", []):
        pid = part["id"]
        if pid in seen_part_ids:
            raise ValueError(f"duplicate part id: {pid}")
        seen_part_ids.add(pid)
        check_safe_rel_png(part["file"])
        if part["parent"] not in manifest["deformers"]:
            raise ValueError(f"part {pid} references unknown deformer {part['parent']}")
        x, y, w, h = part["box"]
        if w <= 0 or h <= 0:
            raise ValueError(f"part {pid} has non-positive box")
        info = inspect_png(RIG_ROOT / part["file"])
        info["id"] = pid
        info["parent"] = part["parent"]
        info["z"] = part["z"]
        parts_report.append(info)

    if "face_base" not in seen_part_ids:
        raise ValueError("missing required part: face_base")

    expr_report = []
    for name in EXPRESSION_IDS:
        entry = manifest.get("expressions", {}).get(name)
        if not isinstance(entry, dict) or "file" not in entry:
            raise ValueError(f"missing expression in manifest: {name}")
        check_safe_rel_png(entry["file"])
        info = inspect_png(RIG_ROOT / entry["file"])
        info["id"] = name
        expr_report.append(info)

    missing_motions = [m for m in MOTION_IDS if m not in manifest.get("motions", {})]
    if missing_motions:
        raise ValueError(f"missing motions in manifest: {missing_motions}")

    parts_sheet = draw_parts_overview(manifest)
    expr_sheet = draw_expressions_overview(manifest)
    comp_sheet, comp_stats = draw_compose_comparison()

    report = {
        "manifest": manifest_path.relative_to(ROOT).as_posix(),
        "partsCount": len(parts_report),
        "expressionsCount": len(expr_report),
        "motionsCount": len(manifest["motions"]),
        "deformersCount": len(manifest["deformers"]),
        "composite": comp_stats,
        "outputs": {
            "partsOverview": parts_sheet.relative_to(ROOT).as_posix(),
            "expressionsOverview": expr_sheet.relative_to(ROOT).as_posix(),
            "composeComparison": comp_sheet.relative_to(ROOT).as_posix(),
        },
        "parts": parts_report,
        "expressions": expr_report,
    }
    report_path = DOCS_ART / "art-check-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "parts": len(parts_report),
        "expressions": len(expr_report),
        "motions": len(manifest["motions"]),
        "differingPixelsGt12": comp_stats["differingPixelsGt12"],
        "differingFraction": comp_stats["differingFraction"],
        "report": str(report_path),
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        sys.exit(1)
