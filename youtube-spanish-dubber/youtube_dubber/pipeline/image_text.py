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

# A second, more robust banner signal: the fraction of the behind-the-letters
# background that clusters tightly (within this RGB distance) around its dominant
# colour. A solid highlight band scores very high here even when a few foreign
# pixels -- a decorative flourish, a sliver of scene at the OCR box's edge --
# inflate the plain std just past _BANNER_STD_MAX. (Measured 0.75 on the real
# "Once Saved" yellow highlight that std alone, at 31.7, wrongly called a scene.)
_BANNER_COVER_DIST = 40.0
_BANNER_COVER_MIN = 0.6


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
    preserve_overlays: bool = False,
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
            base, from_code, to_code, min_confidence=min_confidence,
            preserve_overlays=preserve_overlays,
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
    preserve_overlays: bool = False,
):
    """Return `(localized_image, replaced_count)` for a PIL image: a copy with
    every confidently-detected text region translated to `to_code` and
    re-rendered in place, and the number of regions actually replaced.

    The original image is returned untouched (replaced=0) when there is nothing
    to do. This is the reusable core both the thumbnail and a future video frame
    pass call -- it is just `detect_and_translate` followed by
    `render_translations`, split out so the interactive thumbnail preview can
    sit between the two (show the auto-translations, let them be edited, then
    render the approved text).

    `preserve_overlays`: see render_translations -- restore non-text, non-
    background graphics (a strikethrough, a sticker) that the text wipe removed."""
    pairs = detect_and_translate(image, from_code, to_code, min_confidence=min_confidence)
    if not pairs:
        return image, 0
    return render_translations(image, pairs, preserve_overlays=preserve_overlays)


def detect_and_translate(
    image,
    from_code: str,
    to_code: str,
    *,
    min_confidence: float = 0.5,
) -> list[tuple[TextRegion, str]]:
    """Detect text in `image`, group the detected fragments into reading-order
    lines, and translate each *line* (not each fragment) to `to_code`, returning
    `(merged_region, translated_text)` pairs.

    Grouping first is what makes the translation read correctly: thumbnail OCR
    often returns a title as several boxes ("THIS" "GUY" "RIGHT" "HERE"), and
    translating those in isolation mangles the meaning ("RIGHT" -> "DERECHO"
    instead of "justo"). Merged and translated as a phrase, the line comes out
    natural and is re-rendered centred in the line's combined space.

    Only lines whose translation is genuinely new are kept: a name, a number or
    an already-Spanish word often translates to itself, and re-rendering those
    just risks degrading a region for no gain. Never raises -- an untranslatable
    line is skipped."""
    regions = ocr_onnx.detect_text_regions(image, min_confidence=min_confidence)
    lines = [_merge_line_regions(line) for line in _group_text_lines(regions)]
    pairs: list[tuple[TextRegion, str]] = []
    for block in _group_line_blocks(lines):
        # A multi-line block is a word-stacked phrase ("THIS"/"GUY"/"RIGHT"/
        # "HERE"): translate it whole for the right meaning, then hand each line
        # back its share of the translation so the stacked layout is preserved.
        full = " ".join(r.text.strip() for r in block if r.text.strip())
        if not full:
            continue
        try:
            translated = _translate_preserving_case(full, from_code, to_code)
        except Exception as exc:  # noqa: BLE001 -- e.g. no language package
            log.warning("Skipping a thumbnail text line (%s)", exc)
            continue
        if not (translated and translated.strip()) or translated.strip() == full:
            continue
        if len(block) == 1:
            pairs.append((block[0], translated.strip()))
        else:
            for region, part in _redistribute_phrase(block, translated.strip()):
                if part.strip():
                    pairs.append((region, part.strip()))
    return pairs


def _group_text_lines(regions: list[TextRegion]) -> list[list[TextRegion]]:
    """Group detector regions into reading-order lines. Two fragments are on the
    same line when their vertical spans overlap by more than half the shorter
    one's height; within a line they're ordered left-to-right, and lines run
    top-to-bottom. So a phrase split across several boxes on one line is handled
    as a unit, while genuinely separate lines stay separate."""
    items = [(r, *r.bbox) for r in regions]            # (region, x0, y0, x1, y1)
    items.sort(key=lambda t: (t[2], t[1]))             # top-to-bottom, then left
    lines: list[list[tuple]] = []
    for it in items:
        _, x0, y0, x1, y1 = it
        h = max(1, y1 - y0)
        for line in lines:
            ly0 = min(t[2] for t in line)
            ly1 = max(t[4] for t in line)
            overlap = min(y1, ly1) - max(y0, ly0)
            if overlap > 0.5 * min(h, ly1 - ly0):
                line.append(it)
                break
        else:
            lines.append([it])
    grouped = [[t[0] for t in sorted(line, key=lambda t: t[1])] for line in lines]
    grouped.sort(key=lambda line: min(r.bbox[1] for r in line))
    return grouped


def _merge_line_regions(line: list[TextRegion]) -> TextRegion:
    """Combine a line's fragments into one `TextRegion`: text joined left-to-
    right, geometry the union bounding rectangle. Appearance overrides (font,
    colour) are carried only when every fragment agrees, else left None so the
    renderer auto-detects from the (now line-wide) pixels."""
    if len(line) == 1:
        return line[0]
    x0 = min(r.bbox[0] for r in line)
    y0 = min(r.bbox[1] for r in line)
    x1 = max(r.bbox[2] for r in line)
    y1 = max(r.bbox[3] for r in line)
    text = " ".join(r.text.strip() for r in line if r.text.strip())

    def agreed(attr):
        vals = {getattr(r, attr) for r in line}
        return next(iter(vals)) if len(vals) == 1 else None

    return TextRegion(
        polygon=[(x0, y0), (x1, y0), (x1, y1), (x0, y1)],
        text=text,
        confidence=min((r.confidence for r in line), default=1.0),
        font_family=agreed("font_family"),
        fill_color=agreed("fill_color"),
        stroke_color=agreed("stroke_color"),
    )


def _group_line_blocks(lines: list[TextRegion]) -> list[list[TextRegion]]:
    """Group line-regions into blocks. Consecutive lines that are tightly stacked
    and horizontally aligned form a candidate block; a block is kept whole (to be
    translated as one phrase) only when it's clearly a *word-stacked* title --
    several lines, few words each ("THIS"/"GUY"/"RIGHT"/"HERE"). Ordinary
    multi-word stacked titles (two lines of real text) are left as independent
    lines, since translating those line-by-line already reads fine."""
    runs: list[list[TextRegion]] = []
    for r in lines:
        if not runs:
            runs.append([r])
            continue
        prev = runs[-1][-1]
        px0, py0, px1, py1 = prev.bbox
        x0, y0, x1, y1 = r.bbox
        gap = y0 - py1
        overlap = min(px1, x1) - max(px0, x0)
        aligned = overlap > 0.3 * max(1, min(px1 - px0, x1 - x0))
        close = gap < 0.8 * max(1, py1 - py0)
        if aligned and close:
            runs[-1].append(r)
        else:
            runs.append([r])
    blocks: list[list[TextRegion]] = []
    for run in runs:
        words = sum(len(r.text.split()) for r in run)
        if len(run) >= 3 and words / len(run) <= 1.6:
            blocks.append(run)                    # a word-stacked phrase
        else:
            blocks.extend([r] for r in run)       # keep lines independent
    return blocks


def _redistribute_phrase(block: list[TextRegion], translated: str) -> list[tuple[TextRegion, str]]:
    """Hand the words of a translated phrase back to the block's stacked lines so
    the layout is preserved. With at least one translated word per line it's a
    near 1:1 hand-back (in reading order); when the translation has fewer words
    than lines, the trailing lines are merged into the last filled one so no
    original (untranslated) line is left showing."""
    words = translated.split()
    n, m = len(words), len(block)
    if n == 0:
        return []
    if n < m:
        out = [(block[k], words[k]) for k in range(n - 1)]
        rest = _merge_line_regions(block[n - 1:])
        out.append((rest, " ".join(words[n - 1:])))
        return out
    src = [max(1, len(r.text.split())) for r in block]
    total = sum(src)
    out, idx = [], 0
    for k, region in enumerate(block):
        if k == m - 1:
            cnt = n - idx
        else:
            cnt = max(1, round(n * src[k] / total))
            cnt = min(cnt, n - idx - (m - 1 - k))   # leave >=1 word per remaining line
        out.append((region, " ".join(words[idx:idx + cnt])))
        idx += cnt
    return out


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


def render_translations(image, pairs: list[tuple[TextRegion, str]], *, preserve_overlays: bool = False):
    """Return `(rendered_image, replaced_count)`: a copy of `image` with each
    `(region, text)` pair's original text painted out and `text` drawn in its
    place. `pairs` carries whatever translations the caller settled on -- the
    automatic ones from `detect_and_translate`, or ones a user edited in the
    preview UI. Returns the original image unchanged when nothing renders.

    `preserve_overlays`: after rendering, restore graphics that overlaid the
    original text but are neither text nor background -- a strikethrough, a red
    slash, a sticker -- which the text wipe otherwise removes. General by design
    (it keys on colour, not on any specific decoration); see _restore_overlays."""
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
        # Respect caller-supplied overrides (the preview UI's font/colour pickers);
        # auto-detect only what wasn't chosen. Background reconstruction below
        # always uses the analysed style, independent of these.
        if region.font_family is None:
            region.font_family = _estimate_font_family(arr, region.bbox)
        if region.fill_color is None:
            region.fill_color = style.fill
        # No auto outline. Thumbnail titles are solid-colour text; drawing a
        # contrasting halo (white around solid-black letters) just looks bad.
        # A stroke is used only if a caller explicitly set region.stroke_color.
        styles.append(style)

    # Rebuild the background where the old text was: scene regions get just their
    # strokes inpainted (the picture shows through); banner regions get repainted
    # as a flat rectangle of the banner colour (covering the old text cleanly).
    canvas = _erase_scene_text(canvas, [(s.box, s.ink) for s in styles if not s.has_banner])
    for style in styles:
        if style.has_banner:
            text_box = _text_band_bbox(style) or _ink_bbox(style) or style.box
            pad = max(2, int(round((text_box[3] - text_box[1]) * 0.12)))
            _paint_banner(canvas, text_box, style.banner_color, pad=pad)

    # The reconstructed background (old text removed, no new text yet) -- the
    # reference _restore_overlays uses to tell "overlay graphic" from "background".
    background = canvas.copy()

    replaced = 0
    for (region, translated), style in zip(pairs, styles):
        if _render_region(canvas, region, translated, style):
            replaced += 1

    if replaced == 0:
        return image, 0

    if preserve_overlays:
        boxes_fills = [(region.bbox, tuple(region.fill_color or (255, 255, 255))) for region, _ in pairs]
        canvas = _restore_overlays(image, canvas, background, boxes_fills)
    return canvas, replaced


def _restore_overlays(
    original, final_canvas, background, boxes_fills,
    *, text_dist: float = 90.0, bg_dist: float = 70.0, min_area_frac: float = 0.002,
):
    """Composite back the graphics that overlaid the original text -- a
    strikethrough, a red slash, a sticker -- which the text wipe removed.

    General, not decoration-specific: within each replaced region, an "overlay"
    pixel is one in the ORIGINAL that is far in colour from BOTH the text fill
    (so the old letters themselves are excluded) AND the reconstructed background
    (so the banner/scene is excluded) -- which leaves exactly the foreign-coloured
    graphics. Those original pixels are pasted onto the final image, on top of the
    new translated text, so e.g. the red slash crosses "Siempre Salvo" the way it
    crossed "Always Saved". A connected-components area filter drops speckle so
    JPEG/halo noise isn't resurrected. Best-effort: any failure returns the
    rendered image unchanged."""
    try:
        import numpy as np
        from PIL import Image

        orig_u8 = np.asarray(original.convert("RGB"))
        orig = orig_u8.astype(np.float32)
        bg = np.asarray(background.convert("RGB")).astype(np.float32)
        out = np.asarray(final_canvas.convert("RGB")).copy()
        height, width = out.shape[:2]
        try:
            import cv2
        except Exception:  # noqa: BLE001 -- without opencv we keep the raw mask
            cv2 = None

        restored = False
        for (x0, y0, x1, y1), fill in boxes_fills:
            x0, y0 = max(0, int(x0)), max(0, int(y0))
            x1, y1 = min(width, int(x1)), min(height, int(y1))
            if x1 - x0 < 4 or y1 - y0 < 4:
                continue
            o = orig[y0:y1, x0:x1]
            b = bg[y0:y1, x0:x1]
            fillv = np.array(tuple(fill)[:3], np.float32)
            far_text = np.linalg.norm(o - fillv, axis=2) > text_dist     # not the old letters
            far_bg = np.linalg.norm(o - b, axis=2) > bg_dist             # not the background
            mask = far_text & far_bg
            if not mask.any():
                continue
            if cv2 is not None:
                m = mask.astype(np.uint8)
                m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
                count, labels, stats, _ = cv2.connectedComponentsWithStats(m, 8)
                min_area = max(16, int(min_area_frac * (x1 - x0) * (y1 - y0)))
                keep = [i for i in range(1, count) if stats[i, cv2.CC_STAT_AREA] >= min_area]
                if not keep:
                    continue
                mask = np.isin(labels, keep)
            out[y0:y1, x0:x1][mask] = orig_u8[y0:y1, x0:x1][mask]
            restored = True
        return Image.fromarray(out) if restored else final_canvas
    except Exception as exc:  # noqa: BLE001 -- overlay restore is a nice-to-have
        log.warning("Overlay restore skipped (%s)", exc)
        return final_canvas


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
    # Background = the box's border ring (the letters' immediate surround). The
    # letters are simply what differs from it -- which excludes the banner AND
    # the same-coloured counters inside letters (the holes in A/R/O), leaving the
    # strokes. The border is reliably background even when a bold title fills the
    # box (the text is interior, not at the edge), and it makes no assumption
    # about colours or polarity -- which is what kept flipping white<->black.
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
    if int(ink.sum()) < 12:  # nothing that reads as text
        fill = tuple(int(c) for c in np.median(crop.reshape(-1, 3), axis=0))
        return _RegionStyle(fill, _contrasting(fill), False, (0, 0, 0), None, box)

    # Fill colour = the median of the letters' stroke interiors. Two hazards to
    # avoid: (1) a fat solid blob the OCR box overran onto -- a neighbouring
    # highlight band whose box overlapped this one -- which reads as one huge,
    # far-deeper-than-a-letter component and would hijack the fill (a title over
    # the yellow band above it came out yellow); (2) an outlined glyph, whose
    # thin outline must NOT be mistaken for the body colour. So: drop blob-like
    # components (depth far above the typical letter), then read the THICK core
    # of what remains (the letter body, not its outline).
    depth = cv2.distanceTransform(ink_u8, cv2.DIST_L2, 3)
    fill_ink = ink_u8
    n_comp, labels, _stats, _c = cv2.connectedComponentsWithStats(ink_u8, 8)
    if n_comp > 2:
        comp_depth = [float(depth[labels == i].max()) for i in range(1, n_comp)]
        med = float(np.median(comp_depth))
        drop = [i for i in range(1, n_comp) if comp_depth[i - 1] > max(10.0, 2.5 * med)]
        if drop:
            kept = (ink_u8 * ~np.isin(labels, drop)).astype(np.uint8)
            if int((kept > 0).sum()) >= 12:
                fill_ink = kept
    fdepth = cv2.distanceTransform(fill_ink, cv2.DIST_L2, 3)
    fink = fill_ink > 0
    core = fink & (fdepth >= max(1.5, 0.5 * float(fdepth.max())))
    interior = core if int(core.sum()) >= 8 else fink
    fill = tuple(int(c) for c in np.median(crop[interior], axis=0))

    # Banner vs scene: how uniform is the background *behind* the letters? Sample
    # outside the strokes, their halo, and any near-fill pixels (a high-contrast
    # halo would otherwise inflate a clean banner's spread).
    halo = cv2.dilate(ink_u8, np.ones((5, 5), np.uint8), iterations=2) > 0
    near_text = np.linalg.norm(crop.astype(np.float32) - np.array(fill, np.float32), axis=2) < 60
    bg_pixels = crop[~(halo | near_text)].reshape(-1, 3)
    has_banner, banner_color = _bg_is_banner(bg_pixels)

    # The banner supplies contrast; on a scene the new text needs an outline.
    outline = None if has_banner else _contrasting(fill)
    return _RegionStyle(fill, outline, has_banner, banner_color, ink, box)


def _bg_is_banner(bg_pixels) -> tuple[bool, tuple]:
    """Decide, from the pixels sampled *behind the letters*, whether a text
    region sits on a flat banner (rebuild it as a solid rectangle) or a busy
    scene (inpaint the strokes and let the picture through). Returns
    `(has_banner, banner_color)`.

    A banner qualifies two ways: the spread is low overall (a clean flat band),
    OR one dominant colour still covers most of the background even though the
    plain std is higher -- a real highlight band with a minority of foreign
    pixels (a decorative flourish, a sliver of scene the OCR box caught) that
    inflates the std just past the flat cutoff. The coverage test is what keeps
    a clear highlight from being misread as a scene and left un-repainted."""
    import numpy as np

    if bg_pixels.shape[0] < 20:
        return False, (0, 0, 0)
    bgf = bg_pixels.astype(np.float32)
    median = np.median(bgf, axis=0)
    std = float(bg_pixels.std(axis=0).mean())
    coverage = float((np.linalg.norm(bgf - median, axis=1) < _BANNER_COVER_DIST).mean())
    has_banner = std < _BANNER_STD_MAX or coverage >= _BANNER_COVER_MIN
    return has_banner, tuple(int(c) for c in median)


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


def _paint_banner(image, box, color, pad=0):
    """Repaint the banner a text line sits on as a flat rectangle of `color`,
    covering the old text so the new text draws straight onto a clean banner.
    `box` should be tight to the old text (not the loose OCR box) so we don't
    flatten a swathe of background -- `pad` adds a small margin around it."""
    from PIL import ImageDraw

    w, h = image.size
    x0, y0, x1, y1 = box
    rect = [max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)]
    ImageDraw.Draw(image).rectangle(rect, fill=tuple(int(c) for c in color))
    return image


def _text_band_bbox(style):
    """Absolute (x0, y0, x1, y1) covering the source line's TEXT, excluding a
    decorative ornament (e.g. a filigree scroll) that sits in its own row-band
    above or below the letters. Used to wipe the old text without flattening
    those decorations -- a solid pre-fill of the whole (loose, tall) ink box
    erased the scroll above "A Documentary Film".

    The ink is split into contiguous row-bands; the heaviest is the text. Other
    bands are kept only if they're close to it OR carry substantial ink mass --
    so descenders/serifs a hair below the line stay, but a small ornament a clear
    gap away is dropped. None when there's no usable mask."""
    import numpy as np

    ink = getattr(style, "ink", None)
    if ink is None:
        return None
    m = np.asarray(ink)
    if m.ndim != 2 or not m.any():
        return None
    rows = m.sum(axis=1)
    active = rows >= max(1.0, 0.03 * float(rows.max()))
    bands, start = [], None
    for y, a in enumerate(list(active) + [False]):
        if a and start is None:
            start = y
        elif not a and start is not None:
            bands.append((start, y, float(rows[start:y].sum())))
            start = None
    if not bands:
        return None
    max_mass = max(b[2] for b in bands)
    main = max(bands, key=lambda b: b[2])
    lo, hi = main[0], main[1]
    gap_tol = max(8, int(0.25 * (hi - lo)))
    keep = [main]
    for b in bands:
        if b is main:
            continue
        gap = (lo - b[1]) if b[1] <= lo else (b[0] - hi if b[0] >= hi else 0)
        if gap <= gap_tol or b[2] >= 0.15 * max_mass:
            keep.append(b)
    r0, r1 = min(b[0] for b in keep), max(b[1] for b in keep)
    cols = m[r0:r1].sum(axis=0)
    xs = np.where(cols >= max(1.0, 0.03 * float(cols.max())))[0]
    if xs.size == 0:
        return None
    bx0, by0 = style.box[0], style.box[1]
    return (bx0 + int(xs.min()), by0 + r0, bx0 + int(xs.max()) + 1, by0 + r1)


def _ink_bbox(style):
    """Tight (x0, y0, x1, y1) bounding box, in image coordinates, of a region's
    source glyph ink (`style.ink` laid over `style.box`), or None when there's no
    usable mask. Much tighter than the loose OCR box -- which for these thumbnails
    overruns onto neighbouring lines -- so banners are rebuilt only where text
    actually was, not across the whole (overlapping) box."""
    import numpy as np

    ink = getattr(style, "ink", None)
    if ink is None:
        return None
    mask = np.asarray(ink)
    if mask.ndim != 2 or not mask.any():
        return None
    ys, xs = np.where(mask)
    bx0, by0 = style.box[0], style.box[1]
    return (bx0 + int(xs.min()), by0 + int(ys.min()),
            bx0 + int(xs.max()) + 1, by0 + int(ys.max()) + 1)


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


def _render_region(canvas, region: TextRegion, text: str, style=None) -> bool:
    """Draw `text` into `region`'s box: sized to fit, in a face matching the
    source's serif/sans family, with the detected fill colour and (when the
    source had one) outline, vertically stretched to fill the box. Returns False
    if no font was found.

    For a banner region, repaint the banner SOLID and sized to the actual
    rendered text (which is taller/longer than the source's, especially in
    Spanish) before drawing -- the original tight-to-source banner left the new
    text spilling onto the surrounding colour; this keeps it fully on a clean
    banner (and gives the overlay-restore pass a clean base)."""
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

    # For a banner region, repaint it SOLID tight around the RENDERED text plus a
    # little padding -- NOT around the loose OCR box. The boxes on these
    # thumbnails overrun onto the neighbouring line, so sizing the band to the box
    # both flattens a swathe of background and (because lines are drawn in order)
    # lets the next line's band clobber this one's text. A band that hugs the
    # actual letters backs them cleanly and stays clear of its neighbours.
    if style is not None and getattr(style, "has_banner", False):
        from PIL import ImageDraw

        width, height = canvas.size
        pad_x = max(3, int(round(tile_h * 0.18)))
        pad_y = max(2, int(round(tile_h * 0.12)))
        bx0 = max(0, px - pad_x)
        by0 = max(0, py - pad_y)
        bx1 = min(width, px + tile_w + pad_x)
        by1 = min(height, py + tile_h + pad_y)
        ImageDraw.Draw(canvas).rectangle(
            [bx0, by0, bx1, by1], fill=tuple(int(c) for c in style.banner_color)
        )

    canvas.paste(tile, (px, py), tile)
    return True
