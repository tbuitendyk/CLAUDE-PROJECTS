"""Build a thumbnail preview the user can approve or edit before a dub starts.

This is the orchestration the `/thumbnail/preview` and `/thumbnail/render`
endpoints sit on. It is deliberately thin glue over the reusable pieces:
`image_text` (detect -> translate -> render) and `thumbnail.brand_image` (the
corner banner -- "keep both"). It works on in-memory PIL images and base64
data-URIs so the API never has to juggle temp files for the back-and-forth of
an edit loop.

Kept separate from `downloader` (which needs yt-dlp) on purpose: fetching the
source thumbnail is the endpoint's job, but generating/rendering the preview
from an image must stay importable and unit-testable without the download
stack.
"""
from __future__ import annotations

import base64
import io
import logging
from typing import Optional

from . import image_text, thumbnail
from .models import TextRegion

log = logging.getLogger(__name__)


def _rgb_to_hex(rgb) -> Optional[str]:
    """(r, g, b) -> "#rrggbb" for an <input type=color>; None if unusable."""
    if not rgb:
        return None
    try:
        r, g, b = (max(0, min(255, int(c))) for c in tuple(rgb)[:3])
    except Exception:  # noqa: BLE001 -- a malformed colour just means "no default"
        return None
    return f"#{r:02x}{g:02x}{b:02x}"


def _hex_to_rgb(value) -> Optional[tuple]:
    """"#rrggbb" (from the colour picker) -> (r, g, b); None if absent/invalid,
    so the caller falls back to auto-detecting the source colour."""
    if not isinstance(value, str):
        return None
    s = value.strip().lstrip("#")
    if len(s) != 6:
        return None
    try:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except ValueError:
        return None


def _normalize_font_family(value) -> Optional[str]:
    """Accept only the families the renderer knows ("serif"/"sans"); anything
    else ("auto", "", None) means auto-detect."""
    if isinstance(value, str) and value.strip().lower() in ("serif", "sans"):
        return value.strip().lower()
    return None


def generate_preview(
    image,
    from_code: str,
    to_code: str,
    *,
    min_confidence: float = 0.5,
    banner_text: str = "",
    font: str = "",
    preserve_overlays: bool = False,
):
    """Localise `image` and brand it, returning `(generated_image, regions)`.

    `regions` is one dict per replaced run of text -- its polygon, box, the
    original `text` and the automatic `translation` -- which the UI shows as
    editable fields and echoes back (possibly edited) to `render_edited`.
    `preserve_overlays` restores graphics (strikethroughs etc.) the text wipe
    removed."""
    pairs = image_text.detect_and_translate(image, from_code, to_code, min_confidence=min_confidence)
    localized, _replaced = image_text.render_translations(image, pairs, preserve_overlays=preserve_overlays)
    generated = _brand(localized, banner_text, font)

    # `render_translations` tagged each region with the serif/sans family it
    # detected from the source glyphs; echo that (and the raw modulation score)
    # back so the UI can show what was matched -- and so a mismatch is diagnosable
    # rather than invisible.
    import numpy as np

    source = np.asarray(image.convert("RGB"))
    regions = []
    for region, translated in pairs:
        modulation = image_text._stroke_width_modulation(image_text._region_glyph_mask(source, region.bbox))
        regions.append(
            {
                "polygon": [[float(x), float(y)] for x, y in region.polygon],
                "box": list(region.bbox),
                "text": region.text,
                "translation": translated,
                # What the auto-detector chose, so the preview UI's pickers can
                # pre-fill (and a user can correct what it got wrong).
                "font_family": region.font_family,
                "fill_color": _rgb_to_hex(region.fill_color),
                "modulation": round(modulation, 3) if modulation is not None else None,
            }
        )
    return generated, regions


def render_edited(image, regions: list[dict], *, banner_text: str = "", font: str = "",
                  preserve_overlays: bool = False):
    """Re-render `image` from edited regions and brand it. Each region dict
    carries the `polygon` (echoed back from `generate_preview`) and the user's
    `translation`; this re-runs the remove + draw + banner so the preview
    reflects their edits without re-detecting (which could drift).
    `preserve_overlays` restores graphics (strikethroughs etc.) the wipe removed."""
    pairs: list[tuple[TextRegion, str]] = []
    for region in regions:
        translation = str(region.get("translation") or "").strip()
        polygon = region.get("polygon") or []
        if not translation or len(polygon) < 3:
            continue
        pairs.append(
            (
                TextRegion(
                    polygon=[(float(x), float(y)) for x, y in polygon],
                    text=str(region.get("text") or ""),
                    # Per-region overrides from the UI pickers; None -> auto-detect.
                    font_family=_normalize_font_family(region.get("font_family")),
                    fill_color=_hex_to_rgb(region.get("fill_color")),
                ),
                translation,
            )
        )
    rendered, _replaced = image_text.render_translations(image, pairs, preserve_overlays=preserve_overlays)
    return _brand(rendered, banner_text, font)


def _brand(image, banner_text: str, font: str):
    """Overlay the banner if we can; otherwise return the (localised) image as-is
    so a missing font costs only the banner, not the whole localisation."""
    if not banner_text:
        return image
    return thumbnail.brand_image(image, banner_text, font=font) or image


# --- image <-> data-URI ----------------------------------------------------

def image_to_data_uri(image, fmt: str = "JPEG") -> str:
    """Encode a PIL image as a `data:` URI for embedding straight in JSON."""
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, fmt, quality=90)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    mime = "jpeg" if fmt.upper() == "JPEG" else fmt.lower()
    return f"data:image/{mime};base64,{encoded}"


def data_uri_to_image(uri: str):
    """Decode a `data:` URI (or a bare base64 string) back into a PIL image."""
    from PIL import Image

    payload = uri.split(",", 1)[1] if uri.startswith("data:") else uri
    return Image.open(io.BytesIO(base64.b64decode(payload))).convert("RGB")
