"""TEMP: final generality re-check after banner-extent + banner-colour exclusion.
Render #0 (strikethrough + arrow) and #8 (arrows) with preserve ON; confirm the
red graphics still transfer. Removed after.
"""
from __future__ import annotations

import base64
import io
import tempfile
from pathlib import Path

from PIL import Image

from youtube_dubber.pipeline import image_text, downloader

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


def _emit(img, name, budget=4600):
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
    renders = []
    for vid in ("LJ54oRIM-ZI", "-hjuxRDqBmc"):
        A = _load(vid)
        pairs = image_text.detect_and_translate(A, "en", "es")
        B, _ = image_text.render_translations(A, pairs, preserve_overlays=True)
        renders.append(B)
    w = 300
    rs = [b.resize((w, int(b.height * w / b.width))) for b in renders]
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
