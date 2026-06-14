"""TEMP diagnostic (fresh-render path) -- verify the auto detect->translate->
render output on the real server thumbnail. Prints per-region fill + a small
full render (image LAST so it survives the deploy reply's ~8000-char tail).
Removed after verification.
Usage: PYTHONPATH=/opt/youtube-dubber python deploy/_thumb_diag.py [VIDEO_ID]
"""
from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

import numpy as np

from youtube_dubber.pipeline import image_text, thumbnail_preview as tp

VIDEO_ID = sys.argv[1] if len(sys.argv) > 1 else "JVN7NXqwjro"
CACHE = Path("data/diagnostics") / f"src_{VIDEO_ID}.jpg"


def main() -> None:
    from PIL import Image
    image = Image.open(CACHE).convert("RGB") if CACHE.exists() else None
    if image is None:
        import tempfile
        from youtube_dubber.pipeline import downloader
        with tempfile.TemporaryDirectory() as d:
            src = downloader.fetch_thumbnail(f"https://www.youtube.com/watch?v={VIDEO_ID}", Path(d))
            image = Image.open(src.thumbnail_path).convert("RGB")
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        image.save(CACHE, "JPEG", quality=92)

    pairs = image_text.detect_and_translate(image, "en", "es")
    arr = np.asarray(image.convert("RGB"))
    for i, (region, translated) in enumerate(pairs):
        style = image_text._analyze_region(arr, region.bbox)
        flag = "B" if style.has_banner else "S"
        print(f"  [{i}]{flag} {region.text!r}->{translated!r} fill={style.fill} banner={style.banner_color}")

    rendered, _ = image_text.render_translations(image, pairs, preserve_overlays=False)
    rendered = tp._brand(rendered, "Versión Español", "")
    crop = rendered.resize((240, int(rendered.height * 240 / rendered.width)))
    buf = io.BytesIO(); crop.save(buf, "JPEG", quality=26)
    print("==DIAG_B64 full==", base64.b64encode(buf.getvalue()).decode("ascii"))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback
        print("==DIAG== ERROR:", exc); traceback.print_exc()
