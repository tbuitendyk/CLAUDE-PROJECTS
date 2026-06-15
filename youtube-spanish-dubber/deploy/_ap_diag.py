"""TEMP: verify the banner-extent repaint + slash blend. (1) Your saved edit for
JVN7NXqwjro with preserve ON -- the yellow banner should be clean (no speckle
band), both filigree scrolls preserved, slash blended. (2) The other banner
thumbnails (#2, #4) to confirm no regression. Emits two crops. Removed after.
"""
from __future__ import annotations

import base64
import io
import tempfile
from pathlib import Path

from PIL import Image

from youtube_dubber import db
from youtube_dubber.pipeline import image_text, downloader, thumbnail_preview as tp

CACHE = Path("data/diagnostics")


def _load(vid):
    cf = CACHE / f"orig_{vid}.jpg"
    if cf.exists():
        return Image.open(cf).convert("RGB")
    with tempfile.TemporaryDirectory() as d:
        src = downloader.fetch_thumbnail(f"https://www.youtube.com/watch?v={vid}", Path(d))
        img = Image.open(src.thumbnail_path).convert("RGB")
    CACHE.mkdir(parents=True, exist_ok=True)
    img.save(cf, "JPEG", quality=92)
    return img


def _emit(img, name, budget=4400):
    cur = img.convert("RGB")
    for scale in (1.0, 0.85, 0.72, 0.6, 0.5, 0.4):
        im = cur if scale == 1.0 else cur.resize(
            (max(1, int(cur.width * scale)), max(1, int(cur.height * scale))))
        for q in (60, 45, 35, 25, 18, 12, 9):
            buf = io.BytesIO(); im.save(buf, "JPEG", quality=q)
            if buf.tell() < budget:
                print(f"  {name} bytes={buf.tell()} q={q} scale={scale}")
                print(f"==AP_B64 {name}==", base64.b64encode(buf.getvalue()).decode("ascii"))
                return


def main():
    # (1) Your saved edit for the test thumbnail, preserve ON, full title area.
    p = next((x for x in db.list_projects()
              if x.source_video_id == "JVN7NXqwjro" and x.target_language == "es"), None)
    edit = (p.full() or {}).get("thumbnail_edit") if p else None
    if edit and edit.get("regions"):
        image = tp.data_uri_to_image(edit["original"]) if edit.get("original") else _load("JVN7NXqwjro")
        rendered = tp.render_edited(image, edit["regions"],
                                    banner_text=edit.get("banner_text") or "", preserve_overlays=True)
        crop = rendered.crop((40, 95, image.width - 20, 705))
        w = 320
        _emit(crop.resize((w, int(crop.height * w / crop.width))), "main")

    # (2) Other banner thumbnails (#2 Apostasy, #4 Pastor Reacts) -- regression.
    montage = []
    for vid in ("5wVonZ1S2Ss", "iKFJ5BMF8a4"):
        A = _load(vid)
        pairs = image_text.detect_and_translate(A, "en", "es")
        B, _ = image_text.render_translations(A, pairs, preserve_overlays=True)
        montage.append(B)
    w = 300
    rs = [b.resize((w, int(b.height * w / b.width))) for b in montage]
    sheet = Image.new("RGB", (w, sum(r.height for r in rs) + 4), (255, 0, 255))
    y = 0
    for r in rs:
        sheet.paste(r, (0, y)); y += r.height + 3
    _emit(sheet, "reg")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback
        print("==AP== ERROR:", exc); traceback.print_exc()
