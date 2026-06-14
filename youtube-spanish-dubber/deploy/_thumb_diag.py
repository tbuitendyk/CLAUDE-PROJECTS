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

    if os.environ.get("DIAG_IMG", "0") == "1":
        rendered, _ = image_text.render_translations(image, pairs, preserve_overlays=False)
        rendered = tp._brand(rendered, "Versión Español", "")
        crop = rendered.crop((0, 120, image.width, 610))
        w = 300
        crop = crop.resize((w, int(crop.height * w / crop.width)))
        buf = io.BytesIO(); crop.save(buf, "JPEG", quality=30)
        print("==DIAG_B64 render==", base64.b64encode(buf.getvalue()).decode("ascii"))

    # Per-region detail LAST so it survives the reply tail. For each region also
    # break down WHY the fill came out as it did: the raw ink fraction, and the
    # fill computed from thin (letter-like) ink vs the thick-core ink the current
    # code uses -- the "Always Saved?" box overlaps the yellow "Once Saved" band
    # above it, so its thick core is that band blob, not the black letters.
    import cv2
    for i, (region, translated) in enumerate(pairs):
        style = image_text._analyze_region(arr, region.bbox)
        flag = "B" if style.has_banner else "S"
        x0, y0, x1, y1 = region.bbox
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(arr.shape[1], x1), min(arr.shape[0], y1)
        crop = arr[y0:y1, x0:x1]
        ch, cw = crop.shape[:2]
        bandw = max(2, int(round(min(ch, cw) * 0.12)))
        ring = np.concatenate([crop[:bandw].reshape(-1, 3), crop[-bandw:].reshape(-1, 3),
                               crop[:, :bandw].reshape(-1, 3), crop[:, -bandw:].reshape(-1, 3)])
        border = np.median(ring.astype(np.float32), axis=0)
        dist = np.linalg.norm(crop.astype(np.float32) - border, axis=2)
        _t, ink_u8 = cv2.threshold(np.clip(dist, 0, 255).astype(np.uint8), 0, 255,
                                   cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        ink = ink_u8 > 0
        depth = cv2.distanceTransform(ink_u8, cv2.DIST_L2, 3)
        thin = ink & (depth >= 1.0) & (depth <= 3.0)
        thin_fill = tuple(int(c) for c in np.median(crop[thin], axis=0)) if int(thin.sum()) >= 8 else None
        print(f"  [{i}]{flag} bbox={region.bbox} {region.text!r}->{translated!r}")
        print(f"      auto_fill={style.fill} banner={style.banner_color} "
              f"border={tuple(int(c) for c in border)} maxdepth={float(depth.max()):.1f} "
              f"thin_fill={thin_fill}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback
        print("==DIAG== ERROR:", exc)
        traceback.print_exc()
