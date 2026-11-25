import json
import hashlib
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import build as B
import masks as M

EXPRESSION_IDS = ["neutral", "happy", "wink", "love", "shy", "surprised", "angry", "sad",
                  "sleepy", "thinking", "smug", "pout", "worried", "determined", "flustered",
                  "scared", "excited", "cry", "confused"]
MOTION_IDS = ["stand", "jump", "hop", "look", "turn", "nod", "shake", "spin", "sit",
              "sleep", "dizzy", "walk", "run", "wave", "bow", "shiver", "flap", "dance"]
ALIASES = {
    "listening": "neutral",
    "sleep": "sleepy",
    "content": "happy",
    "waking": "sleepy",
    "squeeze": "neutral",
    "bowing": "happy",
    "dragged": "scared",
    "run": "determined",
    "dizzy": "confused",
}


def load_sprite_manifest():
    path = os.path.join(B.CHAR, "manifest.json")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def seconds_of(sprite_manifest):
    out = {}
    for motion_id, entry in sprite_manifest.get("motions", {}).items():
        if isinstance(entry, dict) and isinstance(entry.get("seconds"), (int, float)):
            out[motion_id] = entry["seconds"]
    return out


def main():
    master = B.load_master()
    (master_filled, body, arm_l, arm_r, hand_l, hand_r,
     head, phones, orn, hf, face_mask) = B.build_body_fill(master)

    body_set = B.body_parts(master, master_filled, body, arm_l, arm_r, hand_l, hand_r,
                            head, phones, orn, hf, face_mask)
    skirt_front, skirt_back = B.skirt_parts(master)
    leg_set = B.legs_shoes(master)
    hair_back = B.hair_back(master, body, arm_l, arm_r, hand_l, hand_r,
                            head, phones, orn, hf, face_mask)
    head_set = B.other_parts(master, head, phones, orn, hf, face_mask)
    face_crops, face_box, face_base, *_ = B.face_variants(master)

    parts = {
        "hair_back": hair_back,
        **leg_set,
        "skirt_back": skirt_back,
        "skirt_front": skirt_front,
        **body_set,
        **head_set,
        "face_base": face_base,
    }

    hashes = {}
    sizes = {}
    entries, textures = B.make_manifest(parts, face_box, hashes, sizes)

    expr_hashes = {}
    expressions = {}
    for name in EXPRESSION_IDS:
        rel = f"expressions/{name}.png"
        expr_hashes[rel] = B.save_png(face_crops[name], os.path.join(B.RIG, rel))
        expressions[name] = {"file": rel}

    sprite = load_sprite_manifest()
    motion_seconds = seconds_of(sprite)
    motions = {
        motion_id: {
            "seconds": motion_seconds.get(motion_id),
            "source": "procedural",
            "spec": "motions/spec.json",
        }
        for motion_id in MOTION_IDS
    }

    deformers = {
        "root": {"kind": "rot", "parent": None, "pivot": [128, 256]},
        "body": {"kind": "rot", "parent": "root", "pivot": [136, 232]},
        "chest": {"kind": "rot", "parent": "body", "pivot": [140, 144]},
        "head": {"kind": "rot", "parent": "chest", "pivot": [140, 94]},
        "hair_back": {"kind": "rot", "parent": "head", "pivot": [140, 64]},
        "arm_l": {"kind": "rot", "parent": "chest", "pivot": [109, 115]},
        "arm_r": {"kind": "rot", "parent": "chest", "pivot": [164, 115]},
        "skirt": {"kind": "rot", "parent": "body", "pivot": [140, 146]},
        "leg_l": {"kind": "rot", "parent": "skirt", "pivot": [118, 175]},
        "leg_r": {"kind": "rot", "parent": "skirt", "pivot": [152, 175]},
    }

    drawing = dict(sprite.get("drawing", {}))
    drawing["view"] = [-28, -72, 284, 276]
    manifest = {
        "schemaVersion": 1,
        "id": "zenbot-rig",
        "name": "zenbot",
        "source": "assets/characters/zenbot/source/zenbot-master-trim.png",
        "drawing": drawing,
        "defaults": sprite.get("defaults", {}),
        "textures": textures,
        "deformers": deformers,
        "parts": entries,
        "expressions": expressions,
        "motions": motions,
        "motionBindings": {"deformers": {}},
        "timing": {
            "expressionFadeMs": 180,
            "blinkCloseMs": 130,
            "breathSeconds": 4.2,
            "motionTailMs": 140,
            "turnMs": 420,
        },
        "expressionAliases": sprite.get("expressionAliases", ALIASES),
        "fallback": {
            "figure": "sprite",
            "manifest": "assets/characters/zenbot/manifest.json",
        },
    }

    manifest_path = os.path.join(B.RIG, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    # Diagnostics: recompose every part in z order and compare against the sprite neutral frame.
    order = [entry["id"] for entry in entries]
    full_parts = {}
    for pid, im in parts.items():
        full_parts[pid] = im
    composed = B.composite(full_parts, order)
    composed_face = B.composite({**full_parts, "face_base": np.zeros_like(face_base)}, order)
    ref = master

    alpha = composed[:, :, 3]
    ref_alpha = ref[:, :, 3]
    union = (alpha > 0) | (ref_alpha > 0)
    diff = np.abs(composed.astype(np.int16) - ref.astype(np.int16))[:, :, :3]
    diff_mag = diff.max(axis=2)
    visible = union & (diff_mag > 12)
    report = {
        "parts": {entry["id"]: {"box": entry["box"], "parent": entry["parent"], "z": entry["z"]}
                  for entry in entries},
        "expressions": len(expressions),
        "motions": len(motions),
        "composite": {
            "alphaPixels": int((alpha > 0).sum()),
            "referenceAlphaPixels": int((ref_alpha > 0).sum()),
            "differingPixels": int(visible.sum()),
            "meanAbsDiff": float(diff[union].mean()) if union.any() else 0.0,
            "maxAbsDiff": int(diff_mag.max()) if diff_mag.size else 0,
        },
        "hashes": {**hashes, **expr_hashes, "manifest.json": hashlib.sha256(open(manifest_path, "rb").read()).hexdigest()},
    }
    B.save_png(composed, os.path.join(B.BUILD, "compose-check.png"))
    B.save_png(composed_face, os.path.join(B.BUILD, "compose-noface-check.png"))
    os.makedirs(B.ART, exist_ok=True)
    with open(os.path.join(B.ART, "compose-report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(json.dumps({
        "parts": len(entries),
        "expressions": len(expressions),
        "motions": len(motions),
        "manifest": manifest_path,
        "differingPixels": report["composite"]["differingPixels"],
    }, indent=2))


if __name__ == "__main__":
    main()
