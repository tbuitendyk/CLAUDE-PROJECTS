"""TEMP diagnostic: locate the BOTTOM filigree (the scroll ornament above "A
Documentary Film") and find which region's band/pre-fill erases it in the
Spanish render. Prints region boxes + tight ink boxes, then a bottom-area crop
(source over render) LAST so it survives the deploy reply tail.
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
    if CACHE.exists():
        image = Image.open(CACHE).convert("RGB")
    else:
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
        ink_box = image_text._ink_bbox(style)
        print(f"  [{i}] {region.text!r}->{translated!r} box={region.bbox} ink_box={ink_box}")
        # Row-bands of the ink: contiguous runs of rows that carry ink, with the
        # ink mass of each -- so the text row(s) vs a separate filigree row-band
        # (above/below) are visible in absolute y.
        ink = getattr(style, "ink", None)
        if ink is not None:
            m = np.asarray(ink)
            rows = m.sum(axis=1)
            thr = max(1.0, 0.03 * rows.max())
            active = rows >= thr
            by0 = style.box[1]
            bands, start = [], None
            for y, a in enumerate(list(active) + [False]):
                if a and start is None:
                    start = y
                elif not a and start is not None:
                    bands.append((by0 + start, by0 + y, int(rows[start:y].sum())))
                    start = None
            print(f"      row-bands(y0,y1,mass)={bands}")

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
