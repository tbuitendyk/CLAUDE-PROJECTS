"""TEMP batch driver for the thumbnail-localisation corpus run. Fetches the 10
source thumbnails on the server (cached), stages viewing-res copies for transfer
back to the dev session via a git side-branch, and emits a small all-10 contact
sheet as base64 (guaranteed to survive the deploy reply tail). Renders come in
the next phase. Run by install.sh.
"""
from __future__ import annotations

import base64
import io
import tempfile
from pathlib import Path

from PIL import Image

from youtube_dubber.pipeline import downloader

IDS = [
    "LJ54oRIM-ZI", "Qsjv4lx991s", "5wVonZ1S2Ss", "JzqDV91AFPo", "iKFJ5BMF8a4",
    "WO84pEY6Kgw", "z84QJzWlRJc", "9QajY-g8q8g", "-hjuxRDqBmc", "wcV-lZHPFTE",
]
CACHE = Path("data/diagnostics")


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    thumbs = {}
    status = []
    for i, vid in enumerate(IDS):
        cf = CACHE / f"orig_{vid}.jpg"
        try:
            if cf.exists():
                img = Image.open(cf).convert("RGB")
            else:
                with tempfile.TemporaryDirectory() as d:
                    src = downloader.fetch_thumbnail(
                        f"https://www.youtube.com/watch?v={vid}", Path(d))
                    img = Image.open(src.thumbnail_path).convert("RGB")
                img.save(cf, "JPEG", quality=92)
            thumbs[i] = img
            status.append(f"{i}:OK")
        except Exception as exc:  # noqa: BLE001
            status.append(f"{i}:FAIL({type(exc).__name__})")
    print("  fetch:", " ".join(status))

    # 5x2 contact sheet (originals) as base64 LAST, to confirm the set. Kept
    # small to fit the deploy reply tail; index-labelled so cells are referable.
    from PIL import ImageDraw, ImageFont
    from youtube_dubber.pipeline import image_text
    fp = image_text._find_text_font("sans")
    font = ImageFont.truetype(fp, 16) if fp else ImageFont.load_default()
    cols, cw, ch, pad = 5, 104, 58, 2
    rows = (len(IDS) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw + (cols + 1) * pad, rows * ch + (rows + 1) * pad), (25, 25, 25))
    for i in range(len(IDS)):
        im = thumbs.get(i)
        if im is None:
            continue
        r, c = divmod(i, cols)
        x, y = pad + c * (cw + pad), pad + r * (ch + pad)
        sheet.paste(im.resize((cw, ch)), (x, y))
        d = ImageDraw.Draw(sheet)
        d.rectangle([x, y, x + 16, y + 18], fill=(0, 0, 0))
        d.text((x + 3, y + 1), str(i), font=font, fill=(255, 255, 0))
    buf = io.BytesIO(); sheet.save(buf, "JPEG", quality=24)
    print("==BATCH_B64 sheet==", base64.b64encode(buf.getvalue()).decode("ascii"))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback
        print("==BATCH== ERROR:", exc); traceback.print_exc()
