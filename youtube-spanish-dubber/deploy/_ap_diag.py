"""TEMP: reproduce the ACTUAL product path -- fetch JVN fresh + fresh detect +
render_translations (what 'Another video link' does), not the saved edit. Print
region 0's box/ink/text-band/extent and where the dots land, and emit a high-res
crop with those boxes drawn. Removed after the dots are actually gone.
"""
from __future__ import annotations

import base64
import io
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from youtube_dubber.pipeline import image_text, downloader

CACHE = Path("data/diagnostics")
VID = "JVN7NXqwjro"


def _fetch():
    # Fetch fresh, like the product (don't reuse a possibly-different cache).
    with tempfile.TemporaryDirectory() as d:
        src = downloader.fetch_thumbnail(f"https://www.youtube.com/watch?v={VID}", Path(d))
        return Image.open(src.thumbnail_path).convert("RGB")


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
    A = _fetch()
    print("  fresh size:", A.size)
    pairs = image_text.detect_and_translate(A, "en", "es")
    arr = np.asarray(A.convert("RGB"))
    region = pairs[0][0]
    style = image_text._analyze_region(arr, region.bbox)
    print(f"  r0 box={region.bbox} ink={image_text._ink_bbox(style)} "
          f"textband={image_text._text_band_bbox(style)} extent={image_text._banner_extent_bbox(arr, style)}")
    B, _ = image_text.render_translations(A, pairs, preserve_overlays=True)
    draw = ImageDraw.Draw(B)
    draw.rectangle(list(region.bbox), outline=(255, 0, 0), width=3)        # OCR box (red)
    ib = image_text._ink_bbox(style)
    if ib:
        draw.rectangle(list(ib), outline=(0, 120, 255), width=2)           # ink box (blue)
    crop = B.crop((70, 150, A.width - 50, 430))
    w = 500
    _emit(crop.resize((w, int(crop.height * w / crop.width))), "fresh")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback
        print("==AP== ERROR:", exc); traceback.print_exc()
