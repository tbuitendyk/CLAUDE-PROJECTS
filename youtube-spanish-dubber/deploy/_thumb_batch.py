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


def _emit(img, budget=4400):
    for q in (60, 50, 42, 34, 28, 22, 17, 13, 10, 8):
        buf = io.BytesIO(); img.convert("RGB").save(buf, "JPEG", quality=q)
        if buf.tell() < budget:
            break
    return buf.tell(), q, base64.b64encode(buf.getvalue()).decode("ascii")


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    renders, status = {}, []
    for i, vid in enumerate(IDS):
        try:
            orig = _original(i, vid)
            out, n = _render(i, vid, orig)
            renders[i] = out
            status.append(f"{i}:{n}r")
        except Exception:  # noqa: BLE001
            status.append(f"{i}:ERR")
            print(f"  [{i}] {vid} ERROR\n{traceback.format_exc()}")
    print("  render:", " ".join(status))

    counter = 0
    if COUNTER.exists():
        try:
            counter = int(COUNTER.read_text().strip())
        except Exception:  # noqa: BLE001
            counter = 0
    COUNTER.write_text(str((counter + 1) % 11))

    if counter == 0:
        # Overview: 5x2 contact sheet of the 10 renders, labelled.
        cols, cw, ch, pad = 5, 150, 84, 2
        rows = (len(IDS) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cw + (cols + 1) * pad, rows * ch + (rows + 1) * pad), (25, 25, 25))
        for i in range(len(IDS)):
            im = renders.get(i)
            if im is None:
                continue
            r, c = divmod(i, cols)
            x, y = pad + c * (cw + pad), pad + r * (ch + pad)
            sheet.paste(im.resize((cw, ch)), (x, y))
            d = ImageDraw.Draw(sheet)
            d.rectangle([x, y, x + 15, y + 17], fill=(0, 0, 0))
            d.text((x + 3, y + 1), str(i), font=_font(15), fill=(255, 255, 0))
        n, q, b64 = _emit(sheet)
        print(f"  overview bytes={n} q={q}")
        print("==BATCH_B64 overview==", b64)
    else:
        idx = counter - 1
        im = renders.get(idx)
        vid = IDS[idx]
        if im is None:
            print(f"  pair[{idx}] unavailable")
            return
        orig = _original(idx, vid)
        w = 384
        a = orig.resize((w, int(orig.height * w / orig.width)))
        b = im.resize((w, int(im.height * w / im.width)))
        pair = Image.new("RGB", (2 * w + 6, a.height + 2), (0, 0, 0))
        pair.paste(a, (0, 1)); pair.paste(b, (w + 6, 1))
        n, q, b64 = _emit(pair, budget=5200)
        print(f"  pair[{idx}] {vid} bytes={n} q={q}")
        print(f"==BATCH_B64 pair{idx}==", b64)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print("==BATCH== ERROR:", exc); traceback.print_exc()
