"""TEMP generality check for the ink-keyed off-banner cleanup: render banner
thumbnails (#0,#2,#4,#8) with preserve ON and confirm no new inpaint smudges and
graphics still transfer. Removed after.
"""
from __future__ import annotations

import base64
import io
import tempfile
from pathlib import Path

from PIL import Image

from youtube_dubber.pipeline import image_text, downloader

CACHE = Path("data/diagnostics")
VIDS = ["LJ54oRIM-ZI", "5wVonZ1S2Ss", "iKFJ5BMF8a4", "-hjuxRDqBmc"]


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


def _emit(img, name, budget=4700):
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
    rs = []
    for vid in VIDS:
        A = _load(vid)
        pairs = image_text.detect_and_translate(A, "en", "es")
        B, _ = image_text.render_translations(A, pairs, preserve_overlays=True)
        rs.append(B.resize((260, int(B.height * 260 / B.width))))
    sheet = Image.new("RGB", (260, sum(r.height for r in rs) + 6), (255, 0, 255))
    y = 0
    for r in rs:
        sheet.paste(r, (0, y)); y += r.height + 2
    _emit(sheet, "reg")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback
        print("==AP== ERROR:", exc); traceback.print_exc()
