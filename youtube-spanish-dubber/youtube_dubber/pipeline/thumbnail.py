"""Brand the source video's thumbnail for the Spanish re-upload.

We keep the *original* thumbnail (so the dub is visually recognisable as the
same video) and overlay a small, consistent banner -- "Versión Español" by
default -- pinned to the bottom-left corner. The branded image is then set on
the uploaded video via the YouTube API (see uploader.set_thumbnail).

Rendering uses Pillow rather than ffmpeg's `drawtext`: drawtext is only present
when ffmpeg was built with libfreetype, which isn't guaranteed across builds,
whereas Pillow renders text reliably everywhere and reads YouTube's usual webp
thumbnails natively. It's intentionally best-effort -- if the font, Pillow, or
the image can't be handled, the caller simply skips the custom thumbnail and
lets YouTube auto-generate one; it never fails the dub.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

# Where DejaVu ships on Debian/Ubuntu once `fonts-dejavu-core` is installed
# (deploy/install.sh adds it). Bold reads clearly at thumbnail sizes.
_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
)


def _find_font(preferred: str = "") -> Optional[str]:
    for path in ([preferred] if preferred else []) + list(_FONT_CANDIDATES):
        if path and Path(path).exists():
            return path
    return None


def brand_thumbnail(src: Path, out: Path, text: str, font: str = "") -> Optional[Path]:
    """Render `src` to `out` (JPEG) with `text` in a discreet, semi-transparent
    banner at the bottom-left. Sizes scale with the image height so the banner
    looks consistent at any source resolution. Returns `out` on success, or None
    if branding wasn't possible (missing source/font/Pillow, unreadable image)."""
    if not src.exists():
        log.warning("Thumbnail source %s missing; skipping branding.", src)
        return None
    if not text.strip():
        return None
    font_path = _find_font(font)
    if not font_path:
        log.warning("No usable font for the thumbnail banner; skipping branding.")
        return None

    try:
        from PIL import Image, ImageDraw, ImageFont

        base = Image.open(src).convert("RGBA")
        width, height = base.size

        font_size = max(14, height // 18)
        fnt = ImageFont.truetype(font_path, font_size)

        overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        # Measure the text, then size a padded banner around it.
        left, top, right, bottom = draw.textbbox((0, 0), text, font=fnt)
        text_w, text_h = right - left, bottom - top
        pad = max(6, height // 60)
        margin = max(8, height // 36)

        x0 = margin
        y1 = height - margin
        x1 = min(width - margin, x0 + text_w + 2 * pad)
        y0 = y1 - (text_h + 2 * pad)
        radius = max(4, pad)

        draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=(0, 0, 0, 150))
        # Offset by the bbox origin so the glyphs sit squarely inside the pad.
        draw.text((x0 + pad - left, y0 + pad - top), text, font=fnt, fill=(255, 255, 255, 245))

        Image.alpha_composite(base, overlay).convert("RGB").save(out, "JPEG", quality=90)
    except Exception as exc:  # noqa: BLE001 -- best effort; never fail the dub
        log.warning("Thumbnail branding failed (%s); skipping custom thumbnail.", exc)
        return None
    return out if out.exists() else None
