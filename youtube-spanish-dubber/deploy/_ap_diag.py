"""TEMP: verify the ink-keyed cleanup removes the old-letter dots below the banner
(without touching the slash). Renders the saved edit for JVN7NXqwjro with preserve
ON; tight crop of the banner + the cream below it. Removed after.
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
    for scale in (1.0, 0.85, 0.72, 0.6, 0.5, 0.4):
        im = cur if scale == 1.0 else cur.resize(
            (max(1, int(cur.width * scale)), max(1, int(cur.height * scale))))
        for q in (70, 55, 45, 35, 27, 20, 14, 10):
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
    pres = tp.render_edited(image, edit["regions"],
                           banner_text=edit.get("banner_text") or "", preserve_overlays=True)
    crop = pres.crop((70, 150, image.width - 50, 420))   # banner + cream below + slash top
    w = 500
    _emit(crop.resize((w, int(crop.height * w / crop.width))), "dots")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback
        print("==AP== ERROR:", exc); traceback.print_exc()
