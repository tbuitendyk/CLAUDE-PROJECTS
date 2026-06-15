"""TEMP: run the auto-preserve against the user's OWN saved thumbnail edit (their
exact translations/font/colour choices) for project (JVN7NXqwjro, es), not the
auto-detected text. Loads the saved edit_state from the live DB, renders with
preserve_overlays, and emits the title-area result. Removed once verified.
"""
from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image

from youtube_dubber import db
from youtube_dubber.pipeline import thumbnail_preview as tp, image_text

CACHE = Path("data/diagnostics")


def _emit(img, name, budget=4600):
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
    p = next((x for x in db.list_projects()
              if x.source_video_id == "JVN7NXqwjro" and x.target_language == "es"), None)
    if p is None:
        print("  no project"); return
    edit = (p.full() or {}).get("thumbnail_edit")
    print("  has thumbnail_edit:", bool(edit))
    if not edit or not edit.get("regions"):
        print("  (no saved regions -- Apply may not have persisted)"); return
    print("  banner_text:", edit.get("banner_text"), "preserve:", edit.get("preserve_overlays"))
    for r in edit.get("regions", []):
        print(f"    {r.get('text')!r} -> {r.get('translation')!r} font={r.get('font_family')} fill={r.get('fill_color')}")

    src = edit.get("original")
    image = tp.data_uri_to_image(src) if src else Image.open(CACHE / "orig_JVN7NXqwjro.jpg").convert("RGB")
    bt = edit.get("banner_text") or ""
    clean = tp.render_edited(image, edit["regions"], banner_text=bt, preserve_overlays=False)
    pres = tp.render_edited(image, edit["regions"], banner_text=bt, preserve_overlays=True)
    box = (80, 150, image.width - 60, 345)                    # the "Una Vez Salvo" banner
    w = 380
    cc = clean.crop(box); cp = pres.crop(box)
    cc = cc.resize((w, int(cc.height * w / cc.width)))
    cp = cp.resize((w, int(cp.height * w / cp.width)))
    sheet = Image.new("RGB", (w, cc.height + cp.height + 4), (255, 0, 255))
    sheet.paste(cc, (0, 0)); sheet.paste(cp, (0, cc.height + 4))
    _emit(sheet, "user")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback
        print("==AP== ERROR:", exc); traceback.print_exc()
