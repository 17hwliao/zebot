import json
import os
import sys
import hashlib

import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(__file__))
import masks as M

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".."))
CHAR = os.path.join(ROOT, "assets", "characters", "zenbot")
RIG = os.path.join(CHAR, "rig")
PARTS = os.path.join(RIG, "parts")
EXPR = os.path.join(RIG, "expressions")
ART = os.path.join(ROOT, "docs", "zenbot", "rig", "art")
BUILD = os.path.join(RIG, "_build")

W, H = 1117, 1409
SCALE = 292.0 / H
LOGICAL_W = W * SCALE
X0 = 128.0 - LOGICAL_W / 2.0


def logo_x(px):
    return X0 + px * SCALE


def logo_y(py):
    return -36.0 + py * SCALE


def load_master():
    src = os.path.join(CHAR, "source", "zenbot-master-trim.png")
    im = Image.open(src).convert("RGBA")
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    return np.array(im)


def load_expression(name):
    src = os.path.join(CHAR, "expressions", name + ".png")
    im = Image.open(src).convert("RGBA")
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    return np.array(im)


def cut(rgb, mask):
    out = rgb.copy()
    weights = mask.astype(np.uint16) * 255 if mask.dtype == bool else mask.astype(np.uint16)
    out[:, :, 3] = (out[:, :, 3].astype(np.uint16) * weights // 255).astype(np.uint8)
    return out


def alpha_bbox(im):
    a = im[:, :, 3]
    ys, xs = np.where(a > 0)
    if len(xs) == 0:
        raise ValueError("empty part")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def crop_rgba(im, box):
    return im[box[1]:box[3], box[0]:box[2]].copy()


def save_png(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(im, "RGBA").save(path, optimize=True)
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def smoothstep(a, b, x):
    k = np.clip((x - a) / (b - a), 0, 1)
    return k * k * (3 - 2 * k)


def feather(mask, radius=2):
    im = Image.fromarray((mask * 255).astype(np.uint8), "L")
    im = im.filter(ImageFilter.GaussianBlur(radius))
    return np.array(im).astype(np.float32) / 255.0


def fill_nearest(rgb, source, target, blur=4):
    """Fill target pixels with the nearest source pixel colour, then soften."""
    ind = ndi.distance_transform_edt(~source, return_distances=False, return_indices=True)
    filled = rgb[ind[0], ind[1]]
    if blur:
        filled = np.array(Image.fromarray(filled).filter(ImageFilter.GaussianBlur(blur)))
    out = rgb.copy()
    out[target] = filled[target]
    return out


def is_bg_hair_pixel(rgba):
    """Detect light-blue / periwinkle / lavender background hair pixels around sleeves and hands."""
    r = rgba[:, :, 0].astype(np.int16)
    g = rgba[:, :, 1].astype(np.int16)
    b = rgba[:, :, 2].astype(np.int16)
    # Background hair in the arm/hand zone (y=700..1020) is saturated blue/lavender:
    # b is significantly higher than r, and not dark navy outline (b > 155) and not pure white (r < 225)
    blue_hair = (b > 155) & ((b - r) > 22) & (r < 220)
    lavender_hair = (b > 175) & (r > 135) & (g < 215) & ((b - g) > 12) & (r < 235)
    return blue_hair | lavender_hair


def clean_limb_mask(master, poly_m, keep_skin=False):
    """Remove any background hair pixels near the outer boundary of a limb polygon."""
    bg_hair = is_bg_hair_pixel(master)
    if keep_skin:
        r = master[:, :, 0].astype(np.int16)
        g = master[:, :, 1].astype(np.int16)
        b = master[:, :, 2].astype(np.int16)
        skin = (r > 215) & (g > 185) & (b > 165) & (r >= b)
        bg_hair = bg_hair & ~skin
    # Only strip bg_hair connected to the outside of the polygon (preserves blue jacket stripes inside!)
    outside = ~poly_m
    seed = outside | (poly_m & bg_hair)
    # Restrict flood from polygon border: find bg_hair pixels touching outside
    border_hair = poly_m & bg_hair & M.dilate(outside, 2)
    # Iteratively grow border_hair into adjacent bg_hair inside poly_m
    curr = border_hair.copy()
    for _ in range(18):
        nxt = poly_m & bg_hair & M.dilate(curr, 2)
        if np.array_equal(nxt, curr):
            break
        curr = nxt
    return poly_m & ~curr


def build_body_fill(master):
    body, arm_l_raw, arm_r_raw, hand_l_raw, hand_r_raw = M.body_masks()
    arm_l = clean_limb_mask(master, arm_l_raw)
    arm_r = clean_limb_mask(master, arm_r_raw)
    hand_l = clean_limb_mask(master, hand_l_raw, keep_skin=True)
    hand_r = clean_limb_mask(master, hand_r_raw, keep_skin=True)
    head, phones, orn, hf, face = M.head_masks()
    # Fill behind arms/hands/headphones so torso stays solid when limbs move
    occluders = M.dilate(arm_l | arm_r | hand_l | hand_r | phones, 2)
    rgb = master[:, :, :3]
    base = cv2.medianBlur(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), 9)
    base = cv2.cvtColor(base, cv2.COLOR_BGR2RGB)
    source_ok = body & ~occluders & (master[:, :, 3] > 200)
    if not source_ok.any():
        source_ok = ~occluders
    filled = fill_nearest(base, source_ok, occluders, blur=3)
    out = rgb.copy()
    out[occluders] = filled[occluders]
    return np.dstack([out, master[:, :, 3]]), body, arm_l, arm_r, hand_l, hand_r, head, phones, orn, hf, face


def body_parts(master, master_filled, body, arm_l, arm_r, hand_l, hand_r, head, phones, orn, hf, face):
    parts = {}
    # Torso (z=36) stays solid underneath arms, headphones, and badge — NO ~dilate gaps and NO badge hole!
    torso_mask = body.copy()
    neck = M.poly_mask([(582, 595), (648, 595), (662, 625), (654, 656), (586, 656), (576, 625)])
    torso_mask |= neck
    # Exclude background hair at shoulder corners
    torso_mask = clean_limb_mask(master, torso_mask)
    torso = cut(master_filled, torso_mask)

    # Jacket front (z=44): left & right jacket panels, cleanly overlapping torso without gaps
    jacket_mask = (M.poly_mask(M.JACKET_L) | M.poly_mask(M.JACKET_R)) & torso_mask
    jacket = cut(master, jacket_mask)

    # Badge (z=46): tight Zenix+ white chest band between jacket lapels
    badge_box = (576, 734, 678, 798)
    badge = cut(master, M.rect_mask(*badge_box))

    # Arms (z=50) overlap slightly under hands (z=54) — NO ~dilate gap!
    parts["torso"] = torso
    parts["jacket_front"] = jacket
    parts["badge"] = badge
    parts["arm_l"] = cut(master, arm_l)
    parts["arm_r"] = cut(master, arm_r)
    parts["hand_l"] = cut(master, hand_l)
    parts["hand_r"] = cut(master, hand_r)
    return parts


def skirt_parts(master):
    m = M.poly_mask(M.SKIRT)
    # Remove any background hair peeking at outer hem corners
    m = clean_limb_mask(master, m)
    front = cut(master, m)
    rgb = master.copy()
    rgb[:, :, :3] = np.clip(rgb[:, :, :3].astype(np.float32) * 0.90, 0, 255).astype(np.uint8)
    back = cut(rgb, m)
    return front, back


def legs_shoes(master):
    out = {}
    yy, xx = np.indices((H, W))
    al = master[:, :, 3] > 0

    # Pixel-exact shoes split cleanly at x=600 (left shoe max x=592, right shoe min x=607)
    shoe_l_mask = al & (yy >= 1205) & (xx < 600)
    shoe_r_mask = al & (yy >= 1205) & (xx >= 600)

    # Legs cleanly below skirt, no hair on outer edges, slight overlap under shoes and skirt
    leg_l_mask = clean_limb_mask(master, M.poly_mask(M.LEG_L)) & al
    leg_r_mask = clean_limb_mask(master, M.poly_mask(M.LEG_R)) & al

    out["leg_l"] = cut(master, leg_l_mask)
    out["leg_r"] = cut(master, leg_r_mask)
    out["shoe_l"] = cut(master, shoe_l_mask)
    out["shoe_r"] = cut(master, shoe_r_mask)
    return out


def hair_back(master, body, arm_l, arm_r, hand_l, hand_r, head, phones, orn, hf, face):
    al = master[:, :, 3]
    yy = np.indices((H, W))[0]
    skirt = M.poly_mask(M.SKIRT)
    leg_l = M.poly_mask(M.LEG_L)
    leg_r = M.poly_mask(M.LEG_R)
    shoe_l = (al > 0) & (yy >= 1205)
    front = M.dilate(
        body | arm_l | arm_r | hand_l | hand_r | head | phones | orn | hf
        | skirt | leg_l | leg_r | shoe_l,
        1,
    )
    hair_vis = (al > 0) & ~front
    sil = (al > 0) & (yy < 1145)
    rows = np.full((H, 3), np.nan, np.float64)
    for y in range(H):
        xs = np.where(hair_vis[y])[0]
        if len(xs) >= 8:
            rows[y] = np.median(master[y, xs, :3].astype(np.float64), axis=0)
    ys = np.arange(H)
    for c in range(3):
        ok = ~np.isnan(rows[:, c])
        if ok.sum() < 2:
            rows[:, c] = 240
        else:
            rows[:, c] = np.interp(ys, ys[ok], rows[ok, c])
        rows[:, c] = ndi.gaussian_filter1d(rows[:, c], 18)
    fill = np.clip(np.repeat(rows[:, None, :], W, axis=1), 0, 255).astype(np.uint8)
    rgb = np.where(hair_vis[:, :, None], master[:, :, :3], fill)
    edge = M.dilate(hair_vis, 2)
    rgb[edge] = master[:, :, :3][edge]
    out = np.dstack([rgb, (sil * 255).astype(np.uint8)])
    return out


# Small alignment tweaks (dx, dy, angle_deg around face center (615, 495)) for source expressions
# whose original sprite had a slightly turned/tilted head compared to master neutral.
EXPRESSION_ALIGN = {
    "pout": (-18, 2, 0.0),
    "smug": (-12, 8, 0.0),
    "confused": (0, 2, -9.0),
    "thinking": (-4, 2, -6.0),
}


def align_expression_image(expr, dx, dy, angle_deg):
    if dx == 0 and dy == 0 and angle_deg == 0:
        return expr
    cx, cy = 615.0, 495.0
    m = cv2.getRotationMatrix2D((cx, cy), angle_deg, 1.0)
    m[0, 2] += dx
    m[1, 2] += dy
    return cv2.warpAffine(
        expr,
        m,
        (W, H),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )


def face_variants(master):
    head, phones, orn, hf, face_mask = M.head_masks()
    base = cut(master, face_mask)
    feature = M.poly_mask(M.FACE_EXPRESSION_POLY) & face_mask
    fw = feather(feature, 4.0)[:, :, None]
    results = {}
    names = [
        "neutral", "happy", "wink", "love", "shy", "surprised", "angry", "sad",
        "sleepy", "thinking", "smug", "pout", "worried", "determined", "flustered",
        "scared", "excited", "cry", "confused",
    ]
    for name in names:
        if name == "neutral":
            results[name] = base
            continue
        expr = load_expression(name)
        if name in EXPRESSION_ALIGN:
            dx, dy, ang = EXPRESSION_ALIGN[name]
            expr = align_expression_image(expr, dx, dy, ang)
        # For thinking/confused, tighten bottom chin slightly so fingers near chin never bleed in
        if name in ("thinking", "confused"):
            chin_trim = feature.copy()
            chin_trim[574:, :] = False
            fw_use = feather(chin_trim, 4.0)[:, :, None]
        else:
            fw_use = fw
        rgb = base[:, :, :3].astype(np.float32) * (1 - fw_use) + expr[:, :, :3].astype(np.float32) * fw_use
        rgb = np.clip(rgb, 0, 255).astype(np.uint8)
        out = np.dstack([rgb, base[:, :, 3]])
        results[name] = out
    union = [alpha_bbox(results[n]) for n in names]
    box = (
        min(b[0] for b in union),
        min(b[1] for b in union),
        max(b[2] for b in union),
        max(b[3] for b in union),
    )
    return {n: crop_rgba(results[n], box) for n in names}, box, base, head, phones, orn, hf, face_mask


def other_parts(master, head, phones, orn, hf, face_mask):
    out = {}
    out["hair_front"] = cut(master, hf)
    out["headphones"] = cut(master, phones)
    out["hair_ornament"] = cut(master, orn)
    return out


def make_manifest(parts, face_box, hashes, size_by_id):
    spec = {
        "hair_back": ("hair_back", 10, 10, (8, 10), "normal"),
        "leg_l": ("leg_l", 20, 10, (4, 8), "normal"),
        "leg_r": ("leg_r", 20, 11, (4, 8), "normal"),
        "shoe_l": ("leg_l", 22, 20, (4, 4), "normal"),
        "shoe_r": ("leg_r", 22, 21, (4, 4), "normal"),
        "skirt_back": ("skirt", 28, 28, (8, 4), "normal"),
        "torso": ("chest", 36, 36, (6, 6), "normal"),
        "skirt_front": ("skirt", 40, 40, (8, 5), "normal"),
        "jacket_front": ("chest", 44, 44, (6, 6), "normal"),
        "badge": ("chest", 46, 46, (4, 3), "normal"),
        "arm_l": ("arm_l", 50, 50, (3, 6), "normal"),
        "arm_r": ("arm_r", 50, 51, (3, 6), "normal"),
        "hand_l": ("arm_l", 54, 54, (3, 3), "normal"),
        "hand_r": ("arm_r", 54, 55, (3, 3), "normal"),
        "face_base": ("head", 60, 60, (10, 10), "normal"),
        "hair_front": ("head", 62, 62, (4, 8), "normal"),
        "headphones": ("head", 64, 64, (4, 4), "normal"),
        "hair_ornament": ("head", 66, 66, (4, 4), "normal"),
    }
    entries = []
    textures = {}
    for pid, im in parts.items():
        if pid not in spec:
            continue
        parent, z, _z2, grid, blend = spec[pid]
        bb = face_box if pid == "face_base" else alpha_bbox(im)
        crop = crop_rgba(im, bb)
        rel = f"parts/{pid.replace('_', '-')}.png"
        path = os.path.join(RIG, rel)
        hashes[rel] = save_png(crop, path)
        box = [
            round(logo_x(bb[0]), 4),
            round(logo_y(bb[1]), 4),
            round((bb[2] - bb[0]) * SCALE, 4),
            round((bb[3] - bb[1]) * SCALE, 4),
        ]
        textures[pid] = rel
        entries.append({
            "id": pid, "tex": pid, "file": rel, "box": box, "grid": list(grid),
            "parent": parent, "z": z, "alpha": 1, "blend": blend,
        })
        size_by_id[pid] = (bb[2] - bb[0], bb[3] - bb[1])
    entries.sort(key=lambda e: (e["z"], spec[e["id"]][2]))
    return entries, textures


def transform_part(im, box_px, pivot, angle=0, scale=1.0, translate=(0, 0)):
    a = np.deg2rad(angle)
    c, s = np.cos(a), np.sin(a)
    px, py = pivot
    tx, ty = translate
    m = np.array([
        [c * scale, -s * scale, px + tx - (c * px - s * py) * scale],
        [s * scale, c * scale, py + ty - (s * px + c * py) * scale],
    ], dtype=np.float64)
    inv = cv2.invertAffineTransform(m)
    canvas = np.zeros((H, W, 4), np.uint8)
    x0, y0, x1, y1 = box_px
    canvas[y0:y1, x0:x1] = im
    out = cv2.warpAffine(
        canvas, inv, (W, H), flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0),
    )
    return out


def composite(parts, order, transforms=None):
    canvas = np.zeros((H, W, 4), np.float32)
    transforms = transforms or {}
    for pid in order:
        im = parts[pid]
        if pid in transforms:
            t = transforms[pid]
            im = transform_part(
                im, t["box"], t["pivot"], t.get("angle", 0),
                t.get("scale", 1), t.get("translate", (0, 0)),
            )
        src = im.astype(np.float32) / 255.0
        sa = src[:, :, 3:4]
        canvas[:, :, :3] = src[:, :, :3] * sa + canvas[:, :, :3] * (1 - sa)
        canvas[:, :, 3:4] = sa + canvas[:, :, 3:4] * (1 - sa)
    return np.clip(canvas * 255, 0, 255).astype(np.uint8)
