"""TEMP: high-res look at JUST the strip below the banner (where the dots are),
rendered from the USER's edit, preserve OFF (top) vs ON (bottom), to isolate
base-render vs auto-preserve. Small crop -> high quality fits. Removed after.
"""
from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image

from youtube_dubber import db
from youtube_dubber.pipeline import thumbnail_preview as tp

CACHE = Path("data/diagnostics")


def _emit(img, name, budget=5000):
    cur = img.convert("RGB")
    for scale in (1.0, 0.85, 0.72, 0.6, 0.5):
        im = cur if scale == 1.0 else cur.resize(
            (max(1, int(cur.width * scale)), max(1, int(cur.height * scale))))
        for q in (80, 65, 50, 40, 30, 22, 15):
            buf = io.BytesIO(); im.save(buf, "JPEG", quality=q)
            if buf.tell() < budget:
                print(f"  {name} bytes={buf.tell()} q={q} scale={scale}")
                print(f"==AP_B64 {name}==", base64.b64encode(buf.getvalue()).decode("ascii"))
                return


def main():
    p = next((x for x in db.list_projects()
              if x.source_video_id == "JVN7NXqwjro" and x.target_language == "es"), None)
    edit = (p.full() or {}).get("thumbnail_edit") if p else None
    if not edit or not edit.get("regions"):
        print("  no saved edit"); return
    image = tp.data_uri_to_image(edit["original"]) if edit.get("original") \
        else Image.open(CACHE / "orig_JVN7NXqwjro.jpg").convert("RGB")
    bt = edit.get("banner_text") or ""
    clean = tp.render_edited(image, edit["regions"], banner_text=bt, preserve_overlays=False)
    pres = tp.render_edited(image, edit["regions"], banner_text=bt, preserve_overlays=True)
    box = (110, 300, image.width - 90, 372)        # the strip just below the banner
    w = 540
    cc = clean.crop(box).resize((w, int((box[3] - box[1]) * w / (box[2] - box[0]))))
    cp = pres.crop(box).resize((w, int((box[3] - box[1]) * w / (box[2] - box[0]))))
    sheet = Image.new("RGB", (w, cc.height + cp.height + 4), (255, 0, 255))
    sheet.paste(cc, (0, 0)); sheet.paste(cp, (0, cc.height + 4))
    _emit(sheet, "strip")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback
        print("==AP== ERROR:", exc); traceback.print_exc()
