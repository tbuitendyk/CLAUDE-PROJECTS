"""TEMP diagnostic: inspect how a project's thumbnail title regions are
classified (banner vs scene) and what the current renderer produces, using the
LIVE service DB + the saved source thumbnail. Run on the server by install.sh;
its stdout comes back in the deploy endpoint's reply (the only channel a cloud
session has to see the real image). Prints structured lines + base64 previews
LAST so they survive reply truncation. Deleted once the banner fix is verified.

Usage: PYTHONPATH=/opt/youtube-dubber python deploy/_thumb_diag.py [SOURCE_VIDEO_ID]
"""
from __future__ import annotations

import base64
import io
import sys

import numpy as np

from youtube_dubber import db
from youtube_dubber.pipeline import image_text, thumbnail_preview as tp
from youtube_dubber.pipeline.models import TextRegion

TARGET = sys.argv[1] if len(sys.argv) > 1 else "JVN7NXqwjro"


def _b64_preview(image, max_w: int, quality: int) -> str:
    img = image.convert("RGB")
    if img.width > max_w:
        h = int(round(img.height * max_w / img.width))
        img = img.resize((max_w, h))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _analyze_verbose(arr, bbox):
    """Mirror image_text._analyze_region's banner decision but print the
    intermediates (std AND a robust dominant-colour coverage fraction)."""
    import cv2

    x0, y0, x1, y1 = bbox
    h, w = arr.shape[:2]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    if x1 - x0 < 6 or y1 - y0 < 6:
        return None
    crop = arr[y0:y1, x0:x1]
    ch, cw = crop.shape[:2]
    band = max(2, int(round(min(ch, cw) * 0.12)))
    ring = np.concatenate([
        crop[:band].reshape(-1, 3), crop[-band:].reshape(-1, 3),
        crop[:, :band].reshape(-1, 3), crop[:, -band:].reshape(-1, 3),
    ])
    border_bg = np.median(ring.astype(np.float32), axis=0)
    dist = np.linalg.norm(crop.astype(np.float32) - border_bg, axis=2)
    _t, ink_u8 = cv2.threshold(
        np.clip(dist, 0, 255).astype(np.uint8), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
    )
    ink = ink_u8 > 0
    depth = cv2.distanceTransform(ink_u8, cv2.DIST_L2, 3)
    core = ink & (depth >= max(1.5, 0.5 * float(depth.max())))
    interior = core if int(core.sum()) >= 8 else ink
    fill = tuple(int(c) for c in np.median(crop[interior], axis=0)) if int(ink.sum()) else (0, 0, 0)
    # Tight ink box (absolute) -- where the source glyphs actually are, vs the
    # looser OCR bbox (which here also caught the decorative filigree).
    ys, xs = np.where(ink)
    if ys.size:
        info_ink = (x0 + int(xs.min()), y0 + int(ys.min()),
                    x0 + int(xs.max()) + 1, y0 + int(ys.max()) + 1)
    else:
        info_ink = None
    halo = cv2.dilate(ink_u8, np.ones((5, 5), np.uint8), iterations=2) > 0
    near_text = np.linalg.norm(crop.astype(np.float32) - np.array(fill, np.float32), axis=2) < 60
    bg_pixels = crop[~(halo | near_text)].reshape(-1, 3)
    info = {"fill": fill, "n_bg": int(bg_pixels.shape[0]), "ink_box": info_ink}
    if bg_pixels.shape[0] >= 20:
        bgf = bg_pixels.astype(np.float32)
        median = np.median(bgf, axis=0)
        info["banner_std"] = round(float(bg_pixels.std(axis=0).mean()), 1)
        info["banner_color"] = tuple(int(c) for c in median)
        d = np.linalg.norm(bgf - median, axis=1)
        info["cover@40"] = round(float((d < 40).mean()), 3)
        info["cover@55"] = round(float((d < 55).mean()), 3)
    else:
        info["banner_std"] = None
    return info


def main() -> None:
    print("==THUMBDIAG== target source_video_id:", TARGET)
    project = next((p for p in db.list_projects() if p.source_video_id == TARGET), None)
    if project is None:
        print("==THUMBDIAG== project not found. Available projects:")
        for p in db.list_projects():
            print(f"    {p.source_video_id}  state={p.state}  title={p.source_title!r}")
        return
    full = project.full()
    edit = full.get("thumbnail_edit") or {}
    print("==THUMBDIAG== state:", project.state, "| has thumbnail_edit:", bool(edit),
          "| saved regions:", len((edit or {}).get("regions") or []),
          "| preserve_overlays:", (edit or {}).get("preserve_overlays"),
          "| banner_text:", (edit or {}).get("banner_text"))

    original_uri = (edit or {}).get("original")
    if not original_uri:
        print("==THUMBDIAG== no saved source image; fetching live thumbnail")
        from pathlib import Path
        import tempfile
        from youtube_dubber.pipeline import downloader
        with tempfile.TemporaryDirectory() as d:
            src = downloader.fetch_thumbnail(
                f"https://www.youtube.com/watch?v={TARGET}", Path(d))
            from PIL import Image
            image = Image.open(src.thumbnail_path).convert("RGB")
    else:
        image = tp.data_uri_to_image(original_uri)
    print("==THUMBDIAG== source image size:", image.size)

    # Build the (region, translation) pairs the same way render_edited would,
    # from the saved edit_state if present, else auto-detect.
    saved_regions = (edit or {}).get("regions") or []
    pairs = []
    if saved_regions:
        for r in saved_regions:
            poly = r.get("polygon") or []
            tr = str(r.get("translation") or "").strip()
            if len(poly) < 3 or not tr:
                continue
            pairs.append((TextRegion(
                polygon=[(float(x), float(y)) for x, y in poly],
                text=str(r.get("text") or ""),
                font_family=tp._normalize_font_family(r.get("font_family")),
                fill_color=tp._hex_to_rgb(r.get("fill_color")),
            ), tr))
        src_code, dst_code = "en", project.target_language
    else:
        src_code, dst_code = "en", project.target_language
        pairs = image_text.detect_and_translate(image, src_code, dst_code)

    arr = np.asarray(image.convert("RGB"))
    banner_text = (edit or {}).get("banner_text") or ""
    preserve = bool((edit or {}).get("preserve_overlays"))
    rendered = tp.render_edited(image, [
        {"polygon": [[x, y] for x, y in r.polygon], "text": r.text,
         "translation": t, "font_family": r.font_family,
         "fill_color": tp._rgb_to_hex(r.fill_color)} for r, t in pairs
    ], banner_text=banner_text, preserve_overlays=preserve)

    # The deploy reply keeps only the LAST ~8000 chars of stdout, so print the
    # (optional, budget-permitting) base64 image FIRST and the compact text
    # classification LAST -- the text is what diagnoses banner-vs-scene and is
    # guaranteed to survive; one small stacked image (source title band over the
    # rendered band) rides along if it fits.
    if str(__import__("os").environ.get("THUMB_DIAG_IMG", "1")) == "1":
        from PIL import Image as _Im
        # The whole title area (where all 3 lines live), source over render.
        band = (0, 95, image.width, 705)
        top = image.crop(band)
        rtop = rendered.crop(band)
        w = 300
        a = top.resize((w, int(top.height * w / top.width)))
        b = rtop.resize((w, int(rtop.height * w / rtop.width)))
        stacked = _Im.new("RGB", (w, a.height + b.height + 4), (255, 0, 255))
        stacked.paste(a, (0, 0)); stacked.paste(b, (0, a.height + 4))
        buf = io.BytesIO(); stacked.save(buf, "JPEG", quality=33)
        print("==THUMBDIAG_B64 stacked==", base64.b64encode(buf.getvalue()).decode("ascii"))

    print("==THUMBDIAG== rendered size:", rendered.size)
    print(f"==THUMBDIAG== {len(pairs)} region(s) [banner=B scene=S]:")
    for i, (region, translated) in enumerate(pairs):
        style = image_text._analyze_region(arr, region.bbox)
        info = _analyze_verbose(arr, region.bbox) or {}
        flag = "B" if style.has_banner else "S"
        print(f"  [{i}]{flag} bbox={region.bbox} {region.text!r}->{translated!r}")
        print(f"      banner_color={style.banner_color} fill={style.fill} "
              f"font={region.font_family} std={info.get('banner_std')} "
              f"cov40={info.get('cover@40')} ink_box={info.get('ink_box')}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        import traceback
        print("==THUMBDIAG== ERROR:", exc)
        traceback.print_exc()
