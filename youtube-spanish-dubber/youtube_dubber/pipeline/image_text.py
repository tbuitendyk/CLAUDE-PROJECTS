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

import functools
import logging
from pathlib import Path
from typing import Optional

from . import ocr_onnx, translator
from .models import TextRegion

log = logging.getLogger(__name__)

# Re-render thumbnail text in a face that matches the *source* one. The titles
# vary -- some are a serif/"Roman" display face, many are a heavy sans/grotesque
# -- so rather than pin one font (and mis-match the other half), we detect serif
# vs sans from the source glyphs (_estimate_font_family) and pick from these.
# Bold throughout: thumbnail titles essentially always are. DejaVu ships with
# fonts-dejavu-core (installed by deploy); DUBBER_THUMBNAIL_TEXT_FONT overrides.
_SERIF_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSerif-Bold.ttf",
)
_SANS_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
)

# Cap how much the rendered title is vertically stretched to fill its box -- the
# original's letters are tall/condensed, so some stretch matches the look, but
# too much turns it into taffy.
_MAX_VERTICAL_STRETCH = 1.7

# Short Spanish function words kept lowercase inside a Title-Cased line (unless
# they're the first word) so re-cased titles read naturally ("Salvación por la
# Sola Fe", not "Salvación Por La Sola Fe").
_ES_LOWERCASE_WORDS = frozenset(
    "de del la el los las un una unos unas y o u e a en con sin por para que su al lo".split()
)


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
            translated = _translate_preserving_case(region.text, from_code, to_code)
        except Exception as exc:  # noqa: BLE001 -- e.g. no language package
            log.warning("Skipping a thumbnail text region (%s)", exc)
            continue
        if translated and translated.strip() and translated.strip() != region.text.strip():
            pairs.append((region, translated.strip()))
    return pairs


def _translate_preserving_case(text: str, from_code: str, to_code: str) -> str:
    """Translate `text`, but feed the translator a lowercased copy and re-apply
    the original's casing style afterwards.

    Machine-translation models handle ordinary lowercase far better than the
    Title-Case / ALL-CAPS that thumbnail titles use -- given "Salvation by Faith
    Alone?" Argos leaves words half-translated, but "salvation by faith alone?"
    comes out clean. We then restore the look: ALL CAPS -> ALL CAPS, Title Case
    -> Title Case (Spanish function words kept lowercase), else sentence case."""
    translated = translator.translate_text(text.lower(), from_code, to_code)
    recased = _apply_case_style(translated, text)
    if to_code.split("-")[0] == "es":
        recased = _add_spanish_opening_marks(recased)
    return recased


def _add_spanish_opening_marks(text: str) -> str:
    """Spanish opens questions/exclamations with ¿/¡, but the English source
    only has the closing ?/! and Argos doesn't add the opener. For a thumbnail
    title (a single phrase) add the opening mark when it's missing."""
    stripped = text.strip()
    if stripped.endswith("?") and "¿" not in stripped:
        return "¿" + stripped
    if stripped.endswith("!") and "¡" not in stripped:
        return "¡" + stripped
    return text


def _apply_case_style(translated: str, original: str) -> str:
    letters = [c for c in original if c.isalpha()]
    if not letters:
        return translated
    if all(c.isupper() for c in letters):
        return translated.upper()

    words = [w for w in original.split() if any(c.isalpha() for c in w)]

    def _starts_upper(word: str) -> bool:
        return next((c.isupper() for c in word if c.isalpha()), False)

    # Title Case if (nearly) every word starts uppercase ("by"/"the" may not).
    if words and sum(_starts_upper(w) for w in words) >= max(2, len(words) - 1):
        return _title_case_es(translated)
    return _sentence_case(translated)


def _title_case_es(text: str) -> str:
    """Title-case `text`, keeping short Spanish function words lowercase (except
    the first word) and leaving any leading ¿/¡/quote punctuation in place."""
    out = []
    for index, word in enumerate(text.split(" ")):
        lead = ""
        rest = word
        while rest and not rest[0].isalnum():  # ¿ ¡ " ( ...
            lead += rest[0]
            rest = rest[1:]
        if not rest:
            out.append(word)
            continue
        if index > 0 and rest.lower() in _ES_LOWERCASE_WORDS:
            out.append(lead + rest.lower())
        else:
            out.append(lead + rest[:1].upper() + rest[1:].lower())
    return " ".join(out)


def _sentence_case(text: str) -> str:
    for index, char in enumerate(text):
        if char.isalpha():
            return text[:index] + char.upper() + text[index + 1:]
    return text


def render_translations(image, pairs: list[tuple[TextRegion, str]]):
    """Return `(rendered_image, replaced_count)`: a copy of `image` with each
    `(region, text)` pair's original text painted out and `text` drawn in its
    place. `pairs` carries whatever translations the caller settled on -- the
    automatic ones from `detect_and_translate`, or ones a user edited in the
    preview UI. Returns the original image unchanged when nothing renders."""
    if not pairs:
        return image, 0

    canvas = image.convert("RGB").copy()

    # Estimate appearance from the *original* pixels before we paint anything
    # out, then remove the originals in one pass (so inpainting fills from clean
    # neighbours, not from text we are about to overwrite).
    import numpy as np

    arr = np.asarray(canvas)
    for region, _translated in pairs:
        fill, stroke = _estimate_colors(arr, region.bbox)
        region.fill_color, region.stroke_color = fill, stroke
        region.font_family = _estimate_font_family(arr, region.bbox)

    canvas = _remove_regions(canvas, [r for r, _ in pairs])

    replaced = 0
    for region, translated in pairs:
        if _render_region(canvas, region, translated):
            replaced += 1

    if replaced == 0:
        return image, 0
    return canvas, replaced


# --- appearance estimation -------------------------------------------------

def _estimate_colors(arr, bbox):
    """Estimate the original text's (fill_colour, outline_colour) from its box.

    Thumbnail titles are usually a coloured glyph with a contrasting outline
    (here: white letters with a red outline). The fill is the *interior* of the
    strokes and the outline is the thin *edge ring* around them -- a distinction
    of geometry, not pixel count (a thick outline on thin serif strokes has more
    pixels than the core). A distance transform of the text mask separates them:
    pixels deep inside the strokes are the fill, pixels at the edge are the
    outline. If there's really only one text colour, the outline falls back to
    plain black/white contrast so the Spanish stays legible against the
    (imperfect) inpainted background."""
    import numpy as np

    x0, y0, x1, y1 = bbox
    h, w = arr.shape[:2]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    if x1 <= x0 or y1 <= y0:
        return (255, 255, 255), (0, 0, 0)
    crop = arr[y0:y1, x0:x1]

    background = np.median(crop.reshape(-1, 3), axis=0)
    distance = np.linalg.norm(crop.astype(np.float32) - background, axis=2)  # H x W
    text_mask = _foreground_mask(distance)
    if int(text_mask.sum()) < 8:  # near-uniform box: inverse of the background
        fill = tuple(int(c) for c in (255 - background))
        return fill, _contrasting(fill)

    return _fill_and_outline(crop, text_mask)


def _foreground_mask(distance):
    """0/1 H×W mask of text pixels (far from the box's background colour). An
    Otsu threshold on the distance adapts to however much of the box the text
    fills -- a flat percentile would swallow background when the text is sparse."""
    import numpy as np

    try:
        import cv2

        dist_u8 = np.clip(distance, 0, 255).astype(np.uint8)
        threshold, _mask = cv2.threshold(dist_u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return distance >= max(threshold, 1.0)
    except Exception:  # noqa: BLE001 -- no opencv: high-percentile fallback
        return distance >= np.percentile(distance, 80)


def _fill_and_outline(crop, text_mask):
    """Split the text pixels into the stroke interior (fill) and the edge ring
    (outline) via a distance transform, and return their median colours. Falls
    back to a single colour + contrasting outline when opencv is unavailable or
    the text has no distinct outline."""
    import numpy as np

    try:
        import cv2

        depth = cv2.distanceTransform((text_mask.astype(np.uint8)) * 255, cv2.DIST_L2, 3)
        max_depth = float(depth.max())
        if max_depth >= 2.0:
            core = text_mask & (depth >= max(2.0, 0.5 * max_depth))   # interior -> fill
            edge = text_mask & (depth <= 1.5)                          # ring -> outline
            if int(core.sum()) >= 8 and int(edge.sum()) >= 8:
                fill = tuple(int(c) for c in np.median(crop[core], axis=0))
                outline = tuple(int(c) for c in np.median(crop[edge], axis=0))
                if _colour_distance(fill, outline) >= 45:
                    return fill, outline
                return fill, _contrasting(fill)
    except Exception:  # noqa: BLE001 -- no opencv / degenerate: single colour
        pass

    fill = tuple(int(c) for c in np.median(crop[text_mask], axis=0))
    return fill, _contrasting(fill)


def _contrasting(colour):
    luminance = 0.299 * colour[0] + 0.587 * colour[1] + 0.114 * colour[2]
    return (0, 0, 0) if luminance > 140 else (255, 255, 255)


def _colour_distance(a, b):
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


# --- font matching ---------------------------------------------------------

def _region_glyph_mask(arr, bbox):
    """0/1 mask of the source text's strokes within `bbox` -- the same
    background-distance + Otsu approach the colour estimators use, reused here
    to judge the typeface. None if the box is too small."""
    import numpy as np

    x0, y0, x1, y1 = bbox
    h, w = arr.shape[:2]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    if x1 - x0 < 6 or y1 - y0 < 6:
        return None
    crop = arr[y0:y1, x0:x1]
    background = np.median(crop.reshape(-1, 3), axis=0)
    distance = np.linalg.norm(crop.astype(np.float32) - background, axis=2)
    return _foreground_mask(distance)


def _stroke_width_modulation(mask) -> Optional[float]:
    """Coefficient of variation of stroke widths in a 0/1 glyph mask.

    Serif/"Roman" display faces modulate thick stems against thin serifs and
    hairlines (high CoV, ~0.5 for DejaVu Serif); heavy sans/grotesques hold a
    near-uniform stroke (low CoV, ~0.15). Stroke widths are read off the
    distance transform's ridge (skeleton) pixels -- their value is the stroke
    half-width there. Returns None when the mask is too sparse to judge."""
    import numpy as np

    try:
        import cv2
    except Exception:  # noqa: BLE001 -- no opencv: can't measure, caller defaults
        return None
    m = (np.asarray(mask).astype(np.uint8)) * 255
    if int((m > 0).sum()) < 40:
        return None
    dist = cv2.distanceTransform(m, cv2.DIST_L2, 3)
    ridge = (dist >= cv2.dilate(dist, np.ones((3, 3), np.float32)) - 1e-3) & (dist >= 1.0)
    widths = dist[ridge]
    if widths.size < 12:
        return None
    mean = float(widths.mean())
    return float(widths.std() / mean) if mean > 0 else None


@functools.lru_cache(maxsize=8)
def _font_reference_modulation(font_path: str) -> Optional[float]:
    """Stroke modulation of a sample rendered in `font_path` -- the reference a
    source region is matched against, so the serif/sans call needs no hand-tuned
    threshold (pick whichever reference the source sits nearer). Cached per
    font."""
    if not font_path:
        return None
    import numpy as np

    try:
        from PIL import Image, ImageDraw, ImageFont

        fnt = ImageFont.truetype(font_path, 96)
    except Exception:  # noqa: BLE001 -- missing font: no reference
        return None
    img = Image.new("L", (1100, 200), 0)
    ImageDraw.Draw(img).text((12, 10), "Salvation Es Tu Secure", font=fnt, fill=255)
    return _stroke_width_modulation(np.asarray(img) > 64)


def _estimate_font_family(arr, bbox) -> str:
    """Classify the source text as "serif" or "sans" from its glyph strokes, so
    the translation is re-rendered in a matching face rather than a fixed one.

    Falls back to "serif" when it can't tell (the stylised 'Roman' titles this
    started with), or to a coarse absolute cut when no reference font is on the
    box to compare against."""
    mask = _region_glyph_mask(arr, bbox)
    if mask is None:
        return "serif"
    source = _stroke_width_modulation(mask)
    if source is None:
        return "serif"
    serif_ref = _font_reference_modulation(_find_text_font("serif") or "")
    sans_ref = _font_reference_modulation(_find_text_font("sans") or "")
    if serif_ref is None or sans_ref is None:
        return "sans" if source < 0.32 else "serif"
    return "serif" if abs(source - serif_ref) <= abs(source - sans_ref) else "sans"


# --- removal ---------------------------------------------------------------

def _remove_regions(image, regions: list[TextRegion]):
    """Paint the original text out of `image` with opencv inpainting.

    Crucially we mask only the *glyph strokes*, not each text's whole bounding
    box: inpainting a big rectangle of mostly-background reconstructs a visible
    smear, whereas inpainting just the thin letters lets opencv fill them from
    the real surrounding pixels, leaving the background between/around the
    letters untouched. Falls back to flat-filling the boxes when opencv/numpy
    aren't available."""
    try:
        import cv2
        import numpy as np

        rgb = np.asarray(image)
        h, w = rgb.shape[:2]
        mask = np.zeros((h, w), dtype=np.uint8)
        for region in regions:
            x0, y0, x1, y1 = region.bbox
            x0, y0 = max(0, x0), max(0, y0)
            x1, y1 = min(w, x1), min(h, y1)
            if x1 <= x0 or y1 <= y0:
                continue
            sub = mask[y0:y1, x0:x1]
            np.maximum(sub, _stroke_mask(rgb[y0:y1, x0:x1]), out=sub)
        # Grow the strokes a little so anti-aliased glyph edges are covered too.
        mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=2)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        inpainted = cv2.inpaint(bgr, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
        from PIL import Image

        return Image.fromarray(cv2.cvtColor(inpainted, cv2.COLOR_BGR2RGB))
    except Exception as exc:  # noqa: BLE001 -- no opencv / numpy: flat-fill fallback
        log.debug("Inpainting unavailable (%s); flat-filling text boxes instead.", exc)
        return _flat_fill_regions(image, regions)


def _stroke_mask(crop):
    """Return a 0/255 mask of the glyph strokes within a text box `crop`
    (H x W x 3 RGB). Text is the minority of pixels that stand out from the
    box's median (background) colour; an Otsu threshold on each pixel's distance
    from that median separates strokes from background adaptively per box.

    Guards the degenerate case (a very busy box where Otsu would flag most of
    it) by masking the whole box -- better to inpaint it than to leave the old
    text ghosting through the new one."""
    import cv2
    import numpy as np

    flat = crop.reshape(-1, 3).astype(np.float32)
    background = np.median(flat, axis=0)
    distance = np.linalg.norm(crop.astype(np.float32) - background, axis=2)
    dist_u8 = np.clip(distance, 0, 255).astype(np.uint8)
    _thresh, stroke = cv2.threshold(dist_u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if stroke.mean() > 0.6 * 255:  # Otsu split most of the box -> cover it all
        stroke[:] = 255
    return stroke


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

def _find_text_font(family: str = "serif") -> Optional[str]:
    """A bold face in `family` ("serif" or "sans") to re-render thumbnail text
    in -- matched to the source by `_estimate_font_family`. An explicit
    DUBBER_THUMBNAIL_TEXT_FONT overrides detection entirely (forces that one
    font); otherwise we use the known serif/sans paths, then fall back to the
    banner's sans lookup."""
    preferred = ""
    try:
        from ..config import settings
        preferred = settings.thumbnail_text_font
    except Exception:  # noqa: BLE001 -- config import shouldn't fail callers
        pass
    candidates = _SANS_FONT_CANDIDATES if family == "sans" else _SERIF_FONT_CANDIDATES
    for path in ([preferred] if preferred else []) + list(candidates):
        if path and Path(path).exists():
            return path
    from . import thumbnail
    return thumbnail._find_font()


def _render_region(canvas, region: TextRegion, text: str) -> bool:
    """Draw `text` into `region`'s box: sized to fit, in a face matching the
    source's serif/sans family, with the detected fill + outline colours, and
    vertically stretched to fill the box (matching the original's tall letters).
    Returns False if no font was found."""
    font_path = _find_text_font(region.font_family or "serif")
    if not font_path:
        return False

    from PIL import Image, ImageDraw, ImageFont

    x0, y0, x1, y1 = region.bbox
    box_w, box_h = max(1, x1 - x0), max(1, y1 - y0)
    fill = tuple(region.fill_color or (255, 255, 255))
    stroke = tuple(region.stroke_color or (0, 0, 0))
    measure = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    # Largest font size whose text fits within the box (both axes). Coarse-to-
    # fine; the vertical stretch below then fills whatever height is left over.
    size = max(8, box_h)
    while size > 8:
        fnt = ImageFont.truetype(font_path, size)
        stroke_w = max(1, size // 16)
        left, top, right, bottom = measure.textbbox((0, 0), text, font=fnt, stroke_width=stroke_w)
        if (right - left) <= box_w * 0.97 and (bottom - top) <= box_h * 0.98:
            break
        size -= 2
    fnt = ImageFont.truetype(font_path, size)
    stroke_w = max(1, size // 16)
    left, top, right, bottom = measure.textbbox((0, 0), text, font=fnt, stroke_width=stroke_w)
    text_w, text_h = right - left, bottom - top
    if text_w <= 0 or text_h <= 0:
        return False

    # Render the title to its own transparent tile so it can be stretched/placed
    # as a unit (rather than drawn straight onto the canvas).
    tile = Image.new("RGBA", (text_w + 2 * stroke_w, text_h + 2 * stroke_w), (0, 0, 0, 0))
    ImageDraw.Draw(tile).text(
        (stroke_w - left, stroke_w - top), text, font=fnt,
        fill=fill + (255,), stroke_width=stroke_w, stroke_fill=stroke + (255,),
    )
    tile = tile.crop(tile.getbbox() or (0, 0, tile.width, tile.height))

    # Vertical stretch: when width was the binding constraint the glyphs are
    # shorter than the box, so stretch them up toward the box height (capped) to
    # match the original's tall lettering.
    tile_w, tile_h = tile.size
    target_h = int(min(box_h * 0.98, tile_h * _MAX_VERTICAL_STRETCH))
    if target_h > tile_h:
        tile = tile.resize((tile_w, target_h), Image.LANCZOS)

    tile_w, tile_h = tile.size
    px = x0 + (box_w - tile_w) // 2
    py = y0 + (box_h - tile_h) // 2
    canvas.paste(tile, (px, py), tile)
    return True
