"""Localise the text baked *into* an image: detect it, translate it, paint out
the original and re-render the translation in place.

This is the OCR-agnostic half of in-image localisation -- it consumes the
`TextRegion`s produced by `ocr_onnx.py` and is where the reusable image work
lives (colour estimation, background removal, font fitting, drawing). The
thumbnail is the first consumer (`thumbnail.py` calls `localize_image_file`,
then overlays its banner on top -- "keep both"); a future in-video text pass is
meant to be the second, calling `localize_image` on sampled frames once its
own tracker has decided *which* regions to replace.

Everything here is best-effort: if the OCR stack, opencv, Pillow or a font is
missing, or translation yields nothing new, the image is returned unchanged and
the caller carries on. It never raises on a bad image.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from . import ocr_onnx, translator
from .models import TextRegion

log = logging.getLogger(__name__)


def localize_image_file(
    src: Path,
    out: Path,
    from_code: str,
    to_code: str,
    *,
    min_confidence: float = 0.5,
) -> Optional[Path]:
    """Read `src`, localise its text to `to_code`, and write the result to `out`
    (JPEG). Returns `out` if at least one text region was actually replaced, or
    None if nothing changed (no OCR stack, no text found, or every line
    translated to itself) -- so the caller can fall back to the original image.
    Never raises."""
    try:
        from PIL import Image

        with Image.open(src) as opened:
            base = opened.convert("RGB")
        localized, replaced = localize_image(
            base, from_code, to_code, min_confidence=min_confidence
        )
        if replaced == 0:
            return None
        localized.save(out, "JPEG", quality=90)
    except Exception as exc:  # noqa: BLE001 -- best effort; never fail the dub
        log.warning("Thumbnail text localisation failed (%s); keeping original text.", exc)
        return None
    return out if out.exists() else None


def localize_image(
    image,
    from_code: str,
    to_code: str,
    *,
    min_confidence: float = 0.5,
):
    """Return `(localized_image, replaced_count)` for a PIL image: a copy with
    every confidently-detected text region translated to `to_code` and
    re-rendered in place, and the number of regions actually replaced.

    The original image is returned untouched (replaced=0) when there is nothing
    to do. This is the reusable core both the thumbnail and a future video frame
    pass call -- it is just `detect_and_translate` followed by
    `render_translations`, split out so the interactive thumbnail preview can
    sit between the two (show the auto-translations, let them be edited, then
    render the approved text)."""
    pairs = detect_and_translate(image, from_code, to_code, min_confidence=min_confidence)
    if not pairs:
        return image, 0
    return render_translations(image, pairs)


def detect_and_translate(
    image,
    from_code: str,
    to_code: str,
    *,
    min_confidence: float = 0.5,
) -> list[tuple[TextRegion, str]]:
    """Detect text in `image` and translate each confidently-recognised region
    to `to_code`, returning `(region, translated_text)` pairs.

    Only regions whose translation is genuinely new are kept: a name, a number
    or an already-Spanish word often translates to itself, and re-rendering
    those just risks degrading a region for no gain. Never raises -- an
    untranslatable region is skipped."""
    pairs: list[tuple[TextRegion, str]] = []
    for region in ocr_onnx.detect_text_regions(image, min_confidence=min_confidence):
        try:
            translated = translator.translate_text(region.text, from_code, to_code)
        except Exception as exc:  # noqa: BLE001 -- e.g. no language package
            log.warning("Skipping a thumbnail text region (%s)", exc)
            continue
        if translated and translated.strip() and translated.strip() != region.text.strip():
            pairs.append((region, translated.strip()))
    return pairs


def render_translations(image, pairs: list[tuple[TextRegion, str]]):
    """Return `(rendered_image, replaced_count)`: a copy of `image` with each
    `(region, text)` pair's original text painted out and `text` drawn in its
    place. `pairs` carries whatever translations the caller settled on -- the
    automatic ones from `detect_and_translate`, or ones a user edited in the
    preview UI. Returns the original image unchanged when nothing renders."""
    if not pairs:
        return image, 0

    from PIL import ImageDraw

    canvas = image.convert("RGB").copy()

    # Estimate appearance from the *original* pixels before we paint anything
    # out, then remove the originals in one pass (so inpainting fills from clean
    # neighbours, not from text we are about to overwrite).
    import numpy as np

    arr = np.asarray(canvas)
    for region, _translated in pairs:
        fill, stroke = _estimate_colors(arr, region.bbox)
        region.fill_color, region.stroke_color = fill, stroke

    canvas = _remove_regions(canvas, [r for r, _ in pairs])

    draw = ImageDraw.Draw(canvas)
    replaced = 0
    for region, translated in pairs:
        if _render_region(draw, region, translated):
            replaced += 1

    if replaced == 0:
        return image, 0
    return canvas, replaced


# --- appearance estimation -------------------------------------------------

def _estimate_colors(arr, bbox):
    """Estimate (text_color, stroke_color) for a region from its pixels.

    Heuristic: text is usually the minority of pixels in its box, so the box's
    median colour approximates the background; the pixels farthest from that
    median approximate the text. The stroke is then chosen black or white --
    whichever contrasts the text -- so the re-rendered Spanish stays legible
    even if the inpainted background isn't a perfect match."""
    import numpy as np

    x0, y0, x1, y1 = bbox
    h, w = arr.shape[:2]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    crop = arr[y0:y1, x0:x1].reshape(-1, 3) if x1 > x0 and y1 > y0 else None
    if crop is None or crop.size == 0:
        return (255, 255, 255), (0, 0, 0)

    background = np.median(crop, axis=0)
    distance = np.linalg.norm(crop.astype(np.float32) - background, axis=1)
    # Top quartile of "distance from background" ~= the text strokes.
    cutoff = np.percentile(distance, 75)
    foreground_pixels = crop[distance >= cutoff]
    if foreground_pixels.size:
        text_color = np.median(foreground_pixels, axis=0)
    else:  # near-uniform box: fall back to the inverse of the background
        text_color = 255 - background

    fill = tuple(int(c) for c in text_color)
    luminance = 0.299 * fill[0] + 0.587 * fill[1] + 0.114 * fill[2]
    stroke = (0, 0, 0) if luminance > 140 else (255, 255, 255)
    return fill, stroke


# --- removal ---------------------------------------------------------------

def _remove_regions(image, regions: list[TextRegion]):
    """Paint the original text out of `image`. Prefers opencv's inpainting (it
    reconstructs the background from surrounding pixels, so gradients/photos stay
    intact); falls back to flat-filling each box with its estimated background
    colour when opencv isn't available."""
    try:
        import cv2
        import numpy as np

        rgb = np.asarray(image)
        mask = np.zeros(rgb.shape[:2], dtype=np.uint8)
        for region in regions:
            pts = np.array([[int(x), int(y)] for x, y in region.polygon], dtype=np.int32)
            cv2.fillPoly(mask, [pts], 255)
        # Dilate so anti-aliased edges of the old glyphs are covered too.
        mask = cv2.dilate(mask, np.ones((5, 5), np.uint8), iterations=2)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        inpainted = cv2.inpaint(bgr, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
        from PIL import Image

        return Image.fromarray(cv2.cvtColor(inpainted, cv2.COLOR_BGR2RGB))
    except Exception as exc:  # noqa: BLE001 -- no opencv / numpy: flat-fill fallback
        log.debug("Inpainting unavailable (%s); flat-filling text boxes instead.", exc)
        return _flat_fill_regions(image, regions)


def _flat_fill_regions(image, regions: list[TextRegion]):
    """Pillow-only fallback: cover each region's box with the median colour of a
    thin frame just outside it (a rough background sample)."""
    import numpy as np
    from PIL import ImageDraw

    arr = np.asarray(image)
    h, w = arr.shape[:2]
    draw = ImageDraw.Draw(image)
    for region in regions:
        x0, y0, x1, y1 = region.bbox
        pad = 4
        fx0, fy0 = max(0, x0 - pad), max(0, y0 - pad)
        fx1, fy1 = min(w, x1 + pad), min(h, y1 + pad)
        frame = arr[fy0:fy1, fx0:fx1].reshape(-1, 3)
        bg = tuple(int(c) for c in np.median(frame, axis=0)) if frame.size else (0, 0, 0)
        draw.rectangle([x0, y0, x1, y1], fill=bg)
    return image


# --- rendering -------------------------------------------------------------

def _render_region(draw, region: TextRegion, text: str) -> bool:
    """Draw `text` into `region`'s box, sized to fit, with a contrasting outline.
    Returns False (rendering skipped) if no usable font was found."""
    from . import thumbnail  # reuse the same DejaVu lookup the banner uses

    font_path = thumbnail._find_font()
    if not font_path:
        return False

    from PIL import ImageFont

    x0, y0, x1, y1 = region.bbox
    box_w, box_h = max(1, x1 - x0), max(1, y1 - y0)

    # Largest font size whose rendered text fits ~95% of the box, bounded by the
    # box height. Coarse-to-fine search keeps it cheap for a handful of regions.
    size = max(8, box_h)
    fnt = ImageFont.truetype(font_path, size)
    while size > 8:
        left, top, right, bottom = draw.textbbox((0, 0), text, font=fnt)
        if (right - left) <= box_w * 0.95 and (bottom - top) <= box_h * 0.98:
            break
        size -= 2
        fnt = ImageFont.truetype(font_path, size)

    left, top, right, bottom = draw.textbbox((0, 0), text, font=fnt)
    text_w, text_h = right - left, bottom - top
    # Centre the text in the original box; offset by the bbox origin so the
    # glyphs sit where we measured them.
    x = x0 + (box_w - text_w) / 2 - left
    y = y0 + (box_h - text_h) / 2 - top

    fill = region.fill_color or (255, 255, 255)
    stroke = region.stroke_color or (0, 0, 0)
    stroke_width = max(1, size // 16)
    draw.text((x, y), text, font=fnt, fill=fill, stroke_width=stroke_width, stroke_fill=stroke)
    return True
