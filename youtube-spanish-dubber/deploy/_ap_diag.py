"""TEMP: reproduce + diagnose the auto-preserve (overlay-restore) pass on the
real 'Once Saved Always Saved?' thumbnail. Renders A -> Spanish with and without
preserve_overlays and emits a stacked comparison (A / B-clean / B-preserve) so
the missing red slash and any junk are visible. Run by install.sh; removed once
the pass is fixed.
"""
from __future__ import annotations

import base64
import io
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from youtube_dubber.pipeline import image_text, downloader

VID = "JzqDV91AFPo"   # #3 painting/scene -- check no resurrection/junk with preserve
CACHE = Path("data/diagnostics")


def _load():
    cf = CACHE / f"orig_{VID}.jpg"
    if cf.exists():
        return Image.open(cf).convert("RGB")
    with tempfile.TemporaryDirectory() as d:
        src = downloader.fetch_thumbnail(f"https://www.youtube.com/watch?v={VID}", Path(d))
        img = Image.open(src.thumbnail_path).convert("RGB")
    CACHE.mkdir(parents=True, exist_ok=True)
    img.save(cf, "JPEG", quality=92)
    return img


def _emit(img, name, budget=4200):
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
    A = _load()
    pairs = image_text.detect_and_translate(A, "en", "es")
    print("  regions:", [r.text for r, _ in pairs])
    Bc, _ = image_text.render_translations(A, pairs, preserve_overlays=False)
    Bp, _ = image_text.render_translations(A, pairs, preserve_overlays=True)
    # B-preserve full (scene case): verify the painting text isn't resurrected
    # and no scene junk is pasted.
    w = 380
    crop = Bp.resize((w, int(Bp.height * w / Bp.width)))
    _emit(crop, "bp", budget=4800)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback
        print("==AP== ERROR:", exc); traceback.print_exc()
