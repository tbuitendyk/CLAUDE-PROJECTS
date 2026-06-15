"""TEMP corpus driver for thumbnail localisation. Renders the 10 source
thumbnails' Spanish versions on the server (general pipeline, graphics-preserve
ON), caches originals + renders, and emits a size-capped contact sheet through
the deploy reply (stdout tail). Drives the iterate loop. Removed when done.

Modes (no env can be passed through the deploy action, so a counter file picks):
  counter 0      -> overview contact sheet of all 10 RENDERS
  counter 1..10  -> high-res original|render PAIR for index (counter-1)
The counter advances each run and wraps at 11. Delete the counter file to reset.
"""
from __future__ import annotations

import base64
import io
import tempfile
import traceback
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from youtube_dubber.pipeline import image_text, downloader

IDS = [
    "LJ54oRIM-ZI", "Qsjv4lx991s", "5wVonZ1S2Ss", "JzqDV91AFPo", "iKFJ5BMF8a4",
    "WO84pEY6Kgw", "z84QJzWlRJc", "9QajY-g8q8g", "-hjuxRDqBmc", "wcV-lZHPFTE",
]
# "report" -> cheap text report on all 10 (translations, fills, banner flags).
# "pairs"  -> emit one high-res original|render pair per deploy, rotating through
#             FOCUS via the counter file.
MODE = "pairs"
FOCUS = [0, 4]
CACHE = Path("data/diagnostics")
COUNTER = CACHE / "_counter"
FONT = image_text._find_text_font("sans")


def _font(sz):
    return ImageFont.truetype(FONT, sz) if FONT else ImageFont.load_default()


def _original(i, vid):
    cf = CACHE / f"orig_{vid}.jpg"
    if cf.exists():
        return Image.open(cf).convert("RGB")
    with tempfile.TemporaryDirectory() as d:
        src = downloader.fetch_thumbnail(f"https://www.youtube.com/watch?v={vid}", Path(d))
        img = Image.open(src.thumbnail_path).convert("RGB")
    img.save(cf, "JPEG", quality=92)
    return img


def _render(i, vid, original):
    """Translate the baked-in text to Spanish, preserve all other graphics."""
    pairs = image_text.detect_and_translate(original, "en", "es")
    out, _ = image_text.render_translations(original, pairs, preserve_overlays=True)
    rf = CACHE / f"render_{i}_{vid}.jpg"
    out.convert("RGB").save(rf, "JPEG", quality=92)
    return out, len(pairs)


def _emit(img, budget=5200):
    """Encode to base64 guaranteed under `budget` bytes -- drop quality first,
    then downscale, so a detailed image still fits the deploy reply tail."""
    cur = img.convert("RGB")
    for scale in (1.0, 0.85, 0.72, 0.6, 0.5, 0.4):
        im = cur if scale == 1.0 else cur.resize(
            (max(1, int(cur.width * scale)), max(1, int(cur.height * scale))))
        for q in (60, 48, 38, 30, 23, 17, 12, 9):
            buf = io.BytesIO(); im.save(buf, "JPEG", quality=q)
            if buf.tell() < budget:
                return buf.tell(), q, round(scale, 2), base64.b64encode(buf.getvalue()).decode("ascii")
    return buf.tell(), q, 0.4, base64.b64encode(buf.getvalue()).decode("ascii")


def _dist(a, b):
    return int(sum((int(x) - int(y)) ** 2 for x, y in zip(a, b)) ** 0.5)


def main() -> None:
    import numpy as np
    CACHE.mkdir(parents=True, exist_ok=True)
    renders, origs, info, status = {}, {}, {}, []
    for i, vid in enumerate(IDS):
        try:
            orig = _original(i, vid)
            origs[i] = orig
            out, n = _render(i, vid, orig)
            renders[i] = out
            # per-region analysis for the text report
            arr = np.asarray(orig.convert("RGB"))
            pairs = image_text.detect_and_translate(orig, "en", "es")
            rows = []
            for region, tr in pairs:
                st = image_text._analyze_region(arr, region.bbox)
                rows.append((region.text, tr, st.fill, st.has_banner, st.banner_color))
            info[i] = rows
            status.append(f"{i}:{n}r")
        except Exception:  # noqa: BLE001
            status.append(f"{i}:ERR")
            print(f"  [{i}] {vid} ERROR\n{traceback.format_exc()}")
    print("  render:", " ".join(status))

    if MODE == "report":
        # Text report across all 10 -- cheap, spots most defects (fill≈banner
        # inversions, missing/odd regions, translation misses).
        for i, vid in enumerate(IDS):
            rows = info.get(i)
            if rows is None:
                print(f"[{i}] {vid}: (no render)")
                continue
            print(f"[{i}] {vid}: {len(rows)} region(s)")
            for text, tr, fill, banner, bcol in rows:
                flag = " <!fill~banner>" if banner and _dist(fill, bcol) < 70 else ""
                print(f"   {text!r}->{tr!r} fill={fill} {'B' if banner else 'S'} bcol={bcol}{flag}")
    else:
        counter = 0
        if COUNTER.exists():
            try:
                counter = int(COUNTER.read_text().strip())
            except Exception:  # noqa: BLE001
                counter = 0
        COUNTER.write_text(str((counter + 1) % len(FOCUS)))
        idx = FOCUS[counter % len(FOCUS)]
        im, orig, vid = renders.get(idx), origs.get(idx), IDS[idx]
        if im is None or orig is None:
            print(f"  pair[{idx}] unavailable"); return
        w = 384
        a = orig.resize((w, int(orig.height * w / orig.width)))
        b = im.resize((w, int(im.height * w / im.width)))
        pair = Image.new("RGB", (2 * w + 6, a.height + 2), (0, 0, 0))
        pair.paste(a, (0, 1)); pair.paste(b, (w + 6, 1))
        n, q, sc, b64 = _emit(pair)
        print(f"  pair[{idx}] {vid} bytes={n} q={q} scale={sc}")
        print(f"==BATCH_B64 pair{idx}==", b64)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print("==BATCH== ERROR:", exc); traceback.print_exc()
