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
OUT = Path("/tmp/thumb_artifacts/thumbs")


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    thumbs = []
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
            # viewing-res copy for the git transfer
            w = 720
            v = img.resize((w, int(img.height * w / img.width))) if img.width > w else img
            v.save(OUT / f"{i:02d}_{vid}_orig.jpg", "JPEG", quality=82)
            thumbs.append((vid, img))
            print(f"  [{i}] {vid} OK {img.size}")
        except Exception as exc:  # noqa: BLE001
            print(f"  [{i}] {vid} FAIL {exc}")

    # Low-res 2x5 contact sheet as a base64 fallback so the set is confirmable
    # even if the git transfer doesn't work.
    cols, cw, ch, pad = 2, 150, 84, 3
    rows = (len(IDS) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw + (cols + 1) * pad, rows * ch + (rows + 1) * pad), (30, 30, 30))
    by_id = {v: im for v, im in thumbs}
    for i, vid in enumerate(IDS):
        im = by_id.get(vid)
        if im is None:
            continue
        cell = im.resize((cw, ch))
        r, c = divmod(i, cols)
        sheet.paste(cell, (pad + c * (cw + pad), pad + r * (ch + pad)))
    buf = io.BytesIO(); sheet.save(buf, "JPEG", quality=30)
    print("==BATCH_B64 sheet==", base64.b64encode(buf.getvalue()).decode("ascii"))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback
        print("==BATCH== ERROR:", exc); traceback.print_exc()
