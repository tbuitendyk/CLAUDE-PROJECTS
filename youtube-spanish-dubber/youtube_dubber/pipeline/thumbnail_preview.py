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

from . import image_text, thumbnail
from .models import TextRegion

log = logging.getLogger(__name__)


def generate_preview(
    image,
    from_code: str,
    to_code: str,
    *,
    min_confidence: float = 0.5,
    banner_text: str = "",
    font: str = "",
):
    """Localise `image` and brand it, returning `(generated_image, regions)`.

    `regions` is one dict per replaced run of text -- its polygon, box, the
    original `text` and the automatic `translation` -- which the UI shows as
    editable fields and echoes back (possibly edited) to `render_edited`."""
    pairs = image_text.detect_and_translate(image, from_code, to_code, min_confidence=min_confidence)
    localized, _replaced = image_text.render_translations(image, pairs)
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
                "font_family": region.font_family,
                "modulation": round(modulation, 3) if modulation is not None else None,
            }
        )
    return generated, regions


def render_edited(image, regions: list[dict], *, banner_text: str = "", font: str = ""):
    """Re-render `image` from edited regions and brand it. Each region dict
    carries the `polygon` (echoed back from `generate_preview`) and the user's
    `translation`; this re-runs the remove + draw + banner so the preview
    reflects their edits without re-detecting (which could drift)."""
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
                ),
                translation,
            )
        )
    rendered, _replaced = image_text.render_translations(image, pairs)
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
