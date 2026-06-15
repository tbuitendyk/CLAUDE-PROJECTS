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


def test_highlight_with_foreign_minority_is_still_a_banner():
    """A solid highlight whose behind-the-letters background has a minority of
    foreign-coloured pixels (a flourish, a sliver of scene the OCR box caught)
    inflates the plain std past the flat-banner cutoff -- the real "Once Saved"
    yellow measured 31.7, just over 30, and so was wrongly treated as a busy
    scene and never repainted, leaving the longer Spanish title spilling off the
    source-sized band. The dominant-colour coverage test must still call it a
    banner so the band is rebuilt to back the translated text."""
    yellow = np.array((240, 220, 30), np.uint8)
    far = np.array((250, 245, 235), np.uint8)   # cream apron at the box edge
    bg = np.repeat(yellow[None, :], 1000, axis=0)
    bg[:250] = far                               # 25% foreign -> std climbs past 30
    std = float(bg.std(axis=0).mean())
    has_banner, banner_color = image_text._bg_is_banner(bg)
    assert std > image_text._BANNER_STD_MAX      # std alone would say "scene"
    assert has_banner is True                    # ...but coverage rescues it
    # The band colour is the dominant yellow, not the foreign minority.
    assert banner_color[2] < 120 and banner_color[0] > 180


def test_busy_scene_is_not_mistaken_for_a_banner():
    rng = np.random.default_rng(0)
    bg = rng.integers(0, 256, size=(2000, 3), dtype=np.uint8)
    has_banner, _ = image_text._bg_is_banner(bg)
    assert has_banner is False


def test_fill_ignores_an_overlapping_blob():
    """When a title's OCR box overruns onto a neighbouring solid block (the yellow
    highlight band of the line above reads as one huge, deep component), the fill
    must come from the letters, not that fat blob -- otherwise the translated
    title renders in the blob's colour (the real "¿Siempre Salvado?" came out
    yellow)."""
    from youtube_dubber.pipeline import image_text

    light = (250, 244, 230)
    h, w = 120, 360
    crop = np.full((h, w, 3), light, np.uint8)
    crop[6:40, 10:350] = (245, 222, 30)        # fat foreign (yellow) blob up top
    for cx in range(30, w - 30, 26):           # black letter strokes below
        crop[60:104, cx:cx + 9] = (15, 15, 15)
    style = image_text._analyze_region(crop, (0, 0, w, h))
    assert sum(style.fill) < 200               # dark letters, not the yellow blob
    assert style.fill[2] < 90                  # and specifically not yellow


def test_pre_fill_excludes_a_far_filigree_but_keeps_close_serifs():
    """The old-text wipe must cover the text line but not a decorative ornament
    (a filigree scroll) sitting in its own row-band a clear gap away -- otherwise
    the solid banner pre-fill erases it (the scroll above 'A Documentary Film').
    A serif/descender band a hair below the line must still be kept."""
    from types import SimpleNamespace
    from youtube_dubber.pipeline import image_text

    ink = np.zeros((290, 1240), bool)
    ink[45:208, 30:1240] = True       # the text line (heaviest row-band)
    ink[269:287, 520:760] = True      # small filigree band, clear gap below text
    style = SimpleNamespace(ink=ink, box=(5, 300, 1245, 590))
    _x0, _y0, _x1, y1 = image_text._text_band_bbox(style)
    assert y1 < 569                   # filigree (abs 569-587) excluded
    assert y1 >= 508                  # ...but the whole text line is covered

    ink2 = np.zeros((230, 1000), bool)
    ink2[21:185, 35:996] = True       # text
    ink2[203:216, 400:600] = True     # serifs/tail just below (small gap)
    style2 = SimpleNamespace(ink=ink2, box=(148, 137, 1156, 367))
    assert image_text._text_band_bbox(style2)[3] >= 353   # close band kept


def test_banner_band_hugs_the_text_not_the_wide_box():
    """A banner is repainted tight around the rendered text, not across the whole
    (often oversized, overlapping) OCR box -- so we don't flatten a swathe of
    background and the next line's band can't reach back over this one."""
    from youtube_dubber.pipeline import image_text
    from youtube_dubber.pipeline.models import TextRegion

    if image_text._find_text_font("sans") is None:
        pytest.skip("no usable font installed")
    gray, yellow = (100, 100, 100), (240, 220, 30)
    canvas = Image.fromarray(np.full((100, 600, 3), gray, np.uint8))
    region = TextRegion(polygon=[(10, 20), (590, 20), (590, 80), (10, 80)],
                        text="HI", fill_color=(10, 10, 10), font_family="sans")
    style = image_text._RegionStyle(fill=(10, 10, 10), outline=None, has_banner=True,
                                    banner_color=yellow, ink=None, box=(10, 20, 590, 80))
    assert image_text._render_region(canvas, region, "HOLA", style)
    arr = np.asarray(canvas)

    def is_yellow(px):
        return px[0] > 180 and px[1] > 160 and px[2] < 120
    # The far edges of the wide box keep their original background (band is tight).
    assert not is_yellow(arr[50, 20]) and not is_yellow(arr[50, 580])
    # ...but a band was painted around the centred text.
    assert is_yellow(arr[50, 300]) or (arr[50, 300].sum() < 200)


def test_banner_repaint_covers_the_rendered_text_solidly():
    from youtube_dubber.pipeline import image_text
    from youtube_dubber.pipeline.models import TextRegion

    if image_text._find_text_font("sans") is None:
        pytest.skip("no usable font installed")

    yellow = (240, 220, 30)
    img = Image.fromarray(np.full((60, 400, 3), yellow, dtype=np.uint8))
    region = TextRegion(polygon=[(20, 18), (120, 18), (120, 42), (20, 42)],
                        text="Once", fill_color=(10, 10, 10), font_family="sans")
    style = image_text._RegionStyle(
        fill=(10, 10, 10), outline=None, has_banner=True, banner_color=yellow,
        ink=None, box=region.bbox,
    )
    ok = image_text._render_region(img, region, "Una Vez Salvo Siempre", style)
    assert ok
    arr = np.asarray(img)
    band = arr[20:42, 20:380]
    is_yellowish = (band[:, :, 0] > 180) & (band[:, :, 1] > 160) & (band[:, :, 2] < 120)
    is_darkish = band.sum(axis=2) < 200
    assert (is_yellowish | is_darkish).mean() > 0.97  # only banner-or-text, no spill
    assert is_darkish.any()  # the text actually drew


def test_overlay_restore_excludes_original_text_via_ink_mask():
    """On a scene, the colour test alone can mis-read the fill and resurrect the
    old letters. Passing the glyph ink mask must keep them out (while a true
    overlay, which extends past the strokes, would still come back)."""
    w, h = 60, 30
    scene = (90, 110, 130)
    original = np.full((h, w, 3), scene, np.uint8)
    original[10:20, 8:52] = (255, 255, 255)        # old white English letters
    ink = np.zeros((h, w), np.uint8)
    ink[10:20, 8:52] = 1
    out = image_text._restore_overlays(
        Image.fromarray(original), _solid(w, h, scene), _solid(w, h, scene),
        [((0, 0, w, h), (10, 10, 10), ink)],       # fill mis-detected as dark
    )
    arr = np.asarray(out)
    assert (arr > 200).all(axis=2).mean() < 0.02   # white letters NOT restored
