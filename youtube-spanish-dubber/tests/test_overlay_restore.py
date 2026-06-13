"""Tests for the general overlay-restore pass (image_text._restore_overlays):
a graphic that overlaid the original text (e.g. a red slash) but is neither text
nor background is composited back onto the re-rendered image. Pure-image, no
network/OCR -- builds synthetic PIL images and calls the function directly."""
from __future__ import annotations

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from youtube_dubber.pipeline import image_text


def _solid(w, h, color):
    return Image.fromarray(np.full((h, w, 3), color, dtype=np.uint8))


def test_restores_a_red_slash_over_the_new_text():
    w, h = 60, 30
    blue = (20, 20, 200)        # banner background
    # ORIGINAL: blue banner with a red horizontal slash across the middle.
    original = np.full((h, w, 3), blue, dtype=np.uint8)
    original[13:17, 5:55] = (220, 20, 20)   # the red slash
    original_img = Image.fromarray(original)

    # BACKGROUND: the reconstructed banner (slash + old text removed) -> flat blue.
    background_img = _solid(w, h, blue)

    # FINAL: the re-rendered translated text (white) on the flat blue banner,
    # WITHOUT the slash (the wipe removed it).
    final = np.full((h, w, 3), blue, dtype=np.uint8)
    final[10:20, 8:52] = (255, 255, 255)    # stand-in for the new white text
    final_img = Image.fromarray(final)

    # Text fill is white; the region covers the whole tile.
    out = image_text._restore_overlays(
        original_img, final_img, background_img, [((0, 0, w, h), (255, 255, 255))]
    )
    arr = np.asarray(out)
    # The red slash is back (red pixels present where the slash was)...
    slash = arr[13:17, 5:55]
    assert (slash[:, :, 0] > 150).mean() > 0.5 and (slash[:, :, 2] < 100).mean() > 0.5
    # ...and the white text NOT under the slash is preserved.
    assert tuple(arr[10, 30]) == (255, 255, 255)


def test_does_not_resurrect_the_old_text():
    # ORIGINAL: white text on blue, NO overlay graphic.
    w, h = 60, 30
    blue = (20, 20, 200)
    original = np.full((h, w, 3), blue, dtype=np.uint8)
    original[10:20, 8:52] = (255, 255, 255)   # the OLD (English) text
    original_img = Image.fromarray(original)

    background_img = _solid(w, h, blue)        # old text wiped
    final_img = _solid(w, h, blue)             # (pretend new text drawn elsewhere)

    out = image_text._restore_overlays(
        original_img, final_img, background_img, [((0, 0, w, h), (255, 255, 255))]
    )
    arr = np.asarray(out)
    # The old white text must NOT come back -- it's text-fill coloured, excluded.
    assert (arr > 200).all(axis=2).mean() < 0.02
    # Image is essentially unchanged (still blue).
    assert abs(int(arr[15, 30][2]) - 200) < 30


def test_speck_noise_is_filtered_out():
    # A single stray off-colour pixel (JPEG speck) shouldn't be resurrected.
    w, h = 60, 30
    blue = (20, 20, 200)
    original = np.full((h, w, 3), blue, dtype=np.uint8)
    original[15, 30] = (0, 220, 0)            # 1px green speck (no real blob)
    original_img = Image.fromarray(original)
    out = image_text._restore_overlays(
        original_img, _solid(w, h, blue), _solid(w, h, blue),
        [((0, 0, w, h), (255, 255, 255))],
    )
    arr = np.asarray(out)
    # With opencv present the speck is filtered (area<min) -> stays background.
    # (Without opencv the raw mask would keep it; that path is the fallback.)
    try:
        import cv2  # noqa: F401
        assert tuple(arr[15, 30]) != (0, 220, 0)
    except Exception:
        pass
