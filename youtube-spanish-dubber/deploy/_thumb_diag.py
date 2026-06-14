"""TEMP diagnostic (fresh-render path): reproduce exactly what the "Preview new
thumbnail" button does from a SOURCE video -- download the real thumbnail, run
the auto detect -> translate -> render pipeline (auto-detected colours, no saved
edit state) -- and report per-region fill/banner classification plus a small
rendered crop. Runs on the server via install.sh; stdout returns in the deploy
reply (only the last ~8000 chars survive, so text first, one small image LAST).
Caches the source image so re-runs skip the download. Deleted once the fresh
render looks right.

Usage: PYTHONPATH=/opt/youtube-dubber python deploy/_thumb_diag.py [VIDEO_ID]
"""
from __future__ import annotations

import base64
import io
import os
import sys
from pathlib import Path

import numpy as np

from youtube_dubber.pipeline import image_text, thumbnail_preview as tp

VIDEO_ID = sys.argv[1] if len(sys.argv) > 1 else "JVN7NXqwjro"
CACHE = Path("data/diagnostics") / f"src_{VIDEO_ID}.jpg"


def _load_source():
    from PIL import Image
    if CACHE.exists():
        return Image.open(CACHE).convert("RGB")
    import tempfile
    from youtube_dubber.pipeline import downloader
    with tempfile.TemporaryDirectory() as d:
        src = downloader.fetch_thumbnail(
            f"https://www.youtube.com/watch?v={VIDEO_ID}", Path(d))
        img = Image.open(src.thumbnail_path).convert("RGB")
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    img.save(CACHE, "JPEG", quality=92)
    return img


def main() -> None:
    print("==DIAG== fresh-render path for", VIDEO_ID)
    image = _load_source()
    print("==DIAG== source size:", image.size, "cached:", CACHE.exists())

    pairs = image_text.detect_and_translate(image, "en", "es")
    arr = np.asarray(image.convert("RGB"))

    image_text._RENDER_DEBUG = []
    rendered, _ = image_text.render_translations(image, pairs, preserve_overlays=False)
    rendered = tp._brand(rendered, "Versión Español", "")

    if os.environ.get("DIAG_IMG", "1") == "1":
        # Both top lines, so the overlap (region 1 clobbering region 0) and the
        # region-1 text colour are both visible. Image FIRST, geometry LAST.
        crop = rendered.crop((40, 110, 1240, 560))
        w = 320
        crop = crop.resize((w, int(crop.height * w / crop.width)))
        buf = io.BytesIO(); crop.save(buf, "JPEG", quality=30)
        print("==DIAG_B64 lines==", base64.b64encode(buf.getvalue()).decode("ascii"))

    for i, (region, translated) in enumerate(pairs):
        style = image_text._analyze_region(arr, region.bbox)
        dbg = image_text._RENDER_DEBUG[i] if i < len(image_text._RENDER_DEBUG) else {}
        print(f"  [{i}] {region.text!r}->{translated!r} fill={style.fill} font={region.font_family}")
        print(f"      box={dbg.get('box')} pos={dbg.get('pos')} tile={dbg.get('tile')} band={dbg.get('band')}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback
        print("==DIAG== ERROR:", exc)
        traceback.print_exc()
