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
from typing import NamedTuple, Optional

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

# Background-colour spread (mean per-channel std, behind the letters) below which
# a text region is treated as sitting on a flat *banner* -- rebuilt as a solid
# rectangle of that colour -- rather than a varied *scene*, whose strokes we
# inpaint away instead so the picture shows through. Solid banners measure ~10,
# busy scenes ~50.
_BANNER_STD_MAX = 30.0


class _RegionStyle(NamedTuple):
    """How one source text region should be reproduced, read from the letters
    themselves (not from any assumed background box)."""
    fill: tuple                 # the text colour
    outline: Optional[tuple]    # outline colour, or None for no outline
    has_banner: bool            # text sits on a ~uniform banner (vs a scene)
    banner_color: tuple         # that banner's colour (meaningful iff has_banner)
    ink: object                 # 0/1 glyph mask over `box` (for scene inpaint), or None
    box: tuple                  # clamped (x0, y0, x1, y1) matching `ink`

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

    # Read each region's style (colours + banner-or-scene) from the *original*
    # pixels, before we touch the canvas.
    import numpy as np

    arr = np.asarray(canvas)
    styles = []
    for region, _translated in pairs:
        style = _analyze_region(arr, region.bbox)
        region.fill_color = style.fill
        region.stroke_color = style.outline
        region.font_family = _estimate_font_family(arr, region.bbox)
        styles.append(style)

    # Rebuild the background where the old text was: scene regions get just their
    # strokes inpainted (the picture shows through); banner regions get repainted
    # as a flat rectangle of the banner colour (covering the old text cleanly).
    canvas = _erase_scene_text(canvas, [(s.box, s.ink) for s in styles if not s.has_banner])
    for style in styles:
        if style.has_banner:
            _paint_banner(canvas, style.box, style.banner_color)

    replaced = 0
    for region, translated in pairs:
        if _render_region(canvas, region, translated):
            replaced += 1

    if replaced == 0:
        return image, 0
    return canvas, replaced


# --- region analysis -------------------------------------------------------

def _analyze_region(arr, bbox) -> "_RegionStyle":
    """Work out how to reproduce a source text region, reading everything from
    the *letters* (found by local contrast) rather than assuming a background
    box -- so it holds whether or not there's a banner, and at any colours.

    Returns text fill/outline colours, whether the text sits on a near-uniform
    banner (and that banner's colour), and the glyph mask (for inpainting when
    it doesn't)."""
    import numpy as np

    x0, y0, x1, y1 = bbox
    h, w = arr.shape[:2]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    box = (x0, y0, x1, y1)
    if x1 - x0 < 6 or y1 - y0 < 6:
        return _RegionStyle((255, 255, 255), (0, 0, 0), False, (0, 0, 0), None, box)
    crop = arr[y0:y1, x0:x1]

    try:
        import cv2
    except Exception:  # noqa: BLE001 -- no opencv: light fallback, treat as scene
        fill = tuple(int(c) for c in np.median(crop.reshape(-1, 3), axis=0))
        return _RegionStyle(fill, _contrasting(fill), False, (0, 0, 0), None, box)

    ch, cw = crop.shape[:2]
    # Local-contrast text detection: a median blur wide enough to swallow the
    # strokes approximates the local background (banner OR smoothed scene); the
    # pixels far from it are the ink (the letters' fill + outline). The kernel
    # scales with the text height (strokes are ~h/6, and the kernel must exceed
    # twice that or thick strokes survive as holes).
    kernel = min(51, max(5, int(round(ch * 0.45)) | 1))
    background = cv2.medianBlur(crop, kernel)
    diff = np.linalg.norm(crop.astype(np.float32) - background.astype(np.float32), axis=2)
    _t, ink_u8 = cv2.threshold(
        np.clip(diff, 0, 255).astype(np.uint8), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
    )
    ink = ink_u8 > 0
    if int(ink.sum()) < 12:  # nothing that reads as text
        fill = tuple(int(c) for c in np.median(crop.reshape(-1, 3), axis=0))
        return _RegionStyle(fill, _contrasting(fill), False, (0, 0, 0), None, box)

    # Fill = stroke interior, outline = the thin edge ring (kept only if it's a
    # genuinely different colour from the fill).
    depth = cv2.distanceTransform(ink_u8, cv2.DIST_L2, 3)
    max_depth = float(depth.max())
    core = ink & (depth >= max(2.0, 0.5 * max_depth))
    interior = core if int(core.sum()) >= 8 else ink
    fill = tuple(int(c) for c in np.median(crop[interior], axis=0))
    outline = None
    edge = ink & (depth <= 1.5)
    if int(edge.sum()) >= 8:
        candidate = tuple(int(c) for c in np.median(crop[edge], axis=0))
        if _colour_distance(fill, candidate) >= 45:
            outline = candidate

    # Banner vs scene: how uniform is the background *behind* the letters? Sample
    # outside the ink, its anti-aliased halo, AND any pixel close to the text
    # colour -- high-contrast text (white on black) spreads a bright halo wider
    # than a few px, and those leaked pixels would otherwise inflate a clean
    # banner's spread and make it read as a scene.
    halo = cv2.dilate(ink_u8, np.ones((5, 5), np.uint8), iterations=2) > 0
    near_text = np.linalg.norm(crop.astype(np.float32) - np.array(fill, np.float32), axis=2) < 60
    bg_pixels = crop[~(halo | near_text)].reshape(-1, 3)
    if bg_pixels.shape[0] >= 20:
        banner_std = float(bg_pixels.std(axis=0).mean())
        banner_color = tuple(int(c) for c in np.median(bg_pixels, axis=0))
    else:
        banner_std, banner_color = 999.0, (0, 0, 0)
    has_banner = banner_std < _BANNER_STD_MAX

    # On a scene the new text needs a contrasting outline to stay legible even if
    # the source had none; on a banner the banner itself supplies the contrast.
    if outline is None and not has_banner:
        outline = _contrasting(fill)
    return _RegionStyle(fill, outline, has_banner, banner_color, ink, box)


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


def _contrasting(colour):
    luminance = 0.299 * colour[0] + 0.587 * colour[1] + 0.114 * colour[2]
    return (0, 0, 0) if luminance > 140 else (255, 255, 255)


def _colour_distance(a, b):
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


# --- font matching ---------------------------------------------------------

def _region_glyph_mask(arr, bbox):
    """0/1 mask of the source text's strokes within `bbox`, cleaned of the
    background texture / JPEG speckle that would otherwise inflate the stroke-
    width measurement: a light (resolution-scaled) median blur, an opening, then
    keep only the large connected components (the letters), dropping specks.
    None if the box is too small."""
    import numpy as np

    x0, y0, x1, y1 = bbox
    h, w = arr.shape[:2]
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    if x1 - x0 < 6 or y1 - y0 < 6:
        return None
    crop = arr[y0:y1, x0:x1]
    try:
        import cv2

        kernel = min(9, max(3, (min(crop.shape[:2]) // 40) | 1))  # odd, ~2.5% of height
        smoothed = cv2.medianBlur(crop, kernel)
    except Exception:  # noqa: BLE001 -- no opencv: judge the crop as-is
        cv2 = None
        smoothed = crop
    background = np.median(smoothed.reshape(-1, 3), axis=0)
    distance = np.linalg.norm(smoothed.astype(np.float32) - background, axis=2)
    mask = _foreground_mask(distance)
    if cv2 is None:
        return mask
    m = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if count > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        keep = np.where(areas >= 0.05 * areas.max())[0] + 1
        m = np.isin(labels, keep).astype(np.uint8)
    return m > 0


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


def _estimate_font_family(arr, bbox) -> str:
    """Classify the source text as "serif" or "sans" from its glyph strokes, so
    the translation is re-rendered in a matching face.

    Stroke-width modulation separates the two on clean renders (serif tapers
    thick stems into thin serifs ~0.5; heavy sans hold a uniform stroke ~0.15),
    but real thumbnail text -- scene background, outlines, JPEG -- inflates the
    measured value well above a clean render's, overlapping serif's range. So we
    cut at an absolute threshold tuned to real thumbnails
    (settings.thumbnail_serif_threshold, default 0.62), biased toward sans (the
    common thumbnail face): only clearly-modulated text reads serif.
    Undetectable -> sans, the safer common case."""
    mask = _region_glyph_mask(arr, bbox)
    if mask is None:
        return "sans"
    source = _stroke_width_modulation(mask)
    if source is None:
        return "sans"
    threshold = 0.62
    try:
        from ..config import settings
        threshold = settings.thumbnail_serif_threshold
    except Exception:  # noqa: BLE001 -- config import shouldn't fail callers
        pass
    return "serif" if source >= threshold else "sans"


# --- background reconstruction ---------------------------------------------

def _erase_scene_text(image, items):
    """Inpaint just the glyph strokes of the *scene* regions, so the real
    picture shows through where the old text was (rather than smearing a whole
    rectangle). `items` is a list of `(box, ink_mask)`; a None mask is skipped.
    Returns the image unchanged when there's nothing to erase or opencv is
    missing."""
    items = [(box, ink) for box, ink in items if ink is not None]
    if not items:
        return image
    try:
        import cv2
        import numpy as np

        rgb = np.asarray(image)
        mask = np.zeros(rgb.shape[:2], dtype=np.uint8)
        for (x0, y0, x1, y1), ink in items:
            sub = mask[y0:y1, x0:x1]
            np.maximum(sub, (np.asarray(ink).astype(np.uint8)) * 255, out=sub)
        # Grow the strokes a little so anti-aliased glyph edges are covered too.
        mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=2)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        inpainted = cv2.inpaint(bgr, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
        from PIL import Image

        return Image.fromarray(cv2.cvtColor(inpainted, cv2.COLOR_BGR2RGB))
    except Exception as exc:  # noqa: BLE001 -- no opencv: leave the background as-is
        log.debug("Scene-text inpainting unavailable (%s); leaving background.", exc)
        return image


def _paint_banner(image, box, color):
    """Repaint the banner a text line sits on as a flat rectangle of `color`,
    covering the old text so the new text draws straight onto a clean banner."""
    from PIL import ImageDraw

    ImageDraw.Draw(image).rectangle(list(box), fill=tuple(int(c) for c in color))
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
    source's serif/sans family, with the detected fill colour and (when the
    source had one) outline, vertically stretched to fill the box. Returns False
    if no font was found."""
    font_path = _find_text_font(region.font_family or "serif")
    if not font_path:
        return False

    from PIL import Image, ImageDraw, ImageFont

    x0, y0, x1, y1 = region.bbox
    box_w, box_h = max(1, x1 - x0), max(1, y1 - y0)
    fill = tuple(region.fill_color or (255, 255, 255))
    stroke = tuple(region.stroke_color) if region.stroke_color is not None else None
    measure = ImageDraw.Draw(Image.new("RGB", (1, 1)))

    def stroke_width(size: int) -> int:
        return max(1, size // 16) if stroke is not None else 0

    # Largest font size whose text fits within the box (both axes). Coarse-to-
    # fine; the vertical stretch below then fills whatever height is left over.
    size = max(8, box_h)
    while size > 8:
        fnt = ImageFont.truetype(font_path, size)
        left, top, right, bottom = measure.textbbox((0, 0), text, font=fnt, stroke_width=stroke_width(size))
        if (right - left) <= box_w * 0.97 and (bottom - top) <= box_h * 0.98:
            break
        size -= 2
    fnt = ImageFont.truetype(font_path, size)
    stroke_w = stroke_width(size)
    left, top, right, bottom = measure.textbbox((0, 0), text, font=fnt, stroke_width=stroke_w)
    text_w, text_h = right - left, bottom - top
    if text_w <= 0 or text_h <= 0:
        return False

    # Render the title to its own transparent tile so it can be stretched/placed
    # as a unit (rather than drawn straight onto the canvas).
    tile = Image.new("RGBA", (text_w + 2 * stroke_w, text_h + 2 * stroke_w), (0, 0, 0, 0))
    ImageDraw.Draw(tile).text(
        (stroke_w - left, stroke_w - top), text, font=fnt,
        fill=fill + (255,), stroke_width=stroke_w,
        stroke_fill=(stroke + (255,)) if stroke is not None else None,
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
