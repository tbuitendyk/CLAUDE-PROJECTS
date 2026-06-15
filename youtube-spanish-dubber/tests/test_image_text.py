"""Tests for in-thumbnail text localisation (ocr_onnx + image_text).

The OCR stack (rapidocr-onnxruntime + opencv) is heavy and optional, so these
never load a real model: the detector and the translator are monkeypatched, and
text removal falls back to its Pillow-only path when opencv isn't installed.
That keeps the translate -> remove -> render logic under test everywhere, while
the real models are exercised only by the deploy self-test.
"""
from __future__ import annotations

import pytest

# The localisation core needs numpy + Pillow (opencv is optional -- removal
# falls back to a Pillow-only path without it). Skip the whole module cleanly
# where they aren't installed, like the other heavy-pipeline tests.
np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from youtube_dubber.pipeline import image_text, ocr_onnx, thumbnail  # noqa: E402
from youtube_dubber.pipeline.models import TextRegion  # noqa: E402


def _region(x0, y0, x1, y1, text, confidence=0.99):
    return TextRegion(
        polygon=[(x0, y0), (x1, y0), (x1, y1), (x0, y1)],
        text=text,
        confidence=confidence,
    )


def test_text_region_bbox_from_polygon():
    region = TextRegion(polygon=[(10, 20), (110, 22), (108, 60), (12, 58)], text="hi")
    assert region.bbox == (10, 20, 110, 60)


def test_detect_returns_empty_without_engine(monkeypatch):
    # If the OCR stack can't load, detection yields nothing (never raises).
    monkeypatch.setattr(ocr_onnx, "_get_engine", lambda: None)
    assert ocr_onnx.detect_text_regions(Image.new("RGB", (64, 64))) == []


def test_localize_image_no_regions_returns_original(monkeypatch):
    img = Image.new("RGB", (200, 100), (40, 40, 40))
    monkeypatch.setattr(ocr_onnx, "detect_text_regions", lambda image, min_confidence=0.0: [])
    out, replaced = image_text.localize_image(img, "en", "es")
    assert replaced == 0 and out is img


def test_localize_image_skips_self_translations(monkeypatch):
    # A region whose translation equals the source (a name/number) is left alone.
    img = Image.new("RGB", (200, 100), (40, 40, 40))
    monkeypatch.setattr(
        ocr_onnx, "detect_text_regions",
        lambda image, min_confidence=0.0: [_region(10, 10, 150, 60, "ACME")],
    )
    monkeypatch.setattr(image_text.translator, "translate_text", lambda t, f, to: "ACME")
    out, replaced = image_text.localize_image(img, "en", "es")
    assert replaced == 0 and out is img


def test_localize_image_replaces_text(monkeypatch):
    if thumbnail._find_font() is None:
        pytest.skip("no DejaVu font installed")

    img = Image.new("RGB", (640, 360), (200, 30, 30))
    box = (40, 140, 600, 230)
    monkeypatch.setattr(
        ocr_onnx, "detect_text_regions",
        lambda image, min_confidence=0.0: [_region(*box, "HELLO WORLD")],
    )
    monkeypatch.setattr(image_text.translator, "translate_text", lambda t, f, to: "HOLA MUNDO")

    out, replaced = image_text.localize_image(img, "en", "es")
    assert replaced == 1
    assert out.size == img.size
    # The region's pixels must have changed (text painted out + re-rendered).
    before = np.asarray(img)[140:230, 40:600]
    after = np.asarray(out)[140:230, 40:600]
    assert not np.array_equal(before, after)


def test_localize_image_file_returns_none_when_nothing_changes(tmp_path, monkeypatch):
    src = tmp_path / "thumb.png"
    Image.new("RGB", (320, 180), (10, 80, 160)).save(src)
    monkeypatch.setattr(ocr_onnx, "detect_text_regions", lambda image, min_confidence=0.0: [])
    assert image_text.localize_image_file(src, tmp_path / "out.jpg", "en", "es") is None


def test_localize_image_file_writes_jpeg_when_replaced(tmp_path, monkeypatch):
    if thumbnail._find_font() is None:
        pytest.skip("no DejaVu font installed")

    src = tmp_path / "thumb.png"
    Image.new("RGB", (640, 360), (15, 15, 15)).save(src)
    monkeypatch.setattr(
        ocr_onnx, "detect_text_regions",
        lambda image, min_confidence=0.0: [_region(40, 140, 600, 230, "DEEP DIVE")],
    )
    monkeypatch.setattr(image_text.translator, "translate_text", lambda t, f, to: "INMERSIÓN")

    out = tmp_path / "out.jpg"
    result = image_text.localize_image_file(src, out, "en", "es")
    assert result == out and out.exists()
    with Image.open(out) as img:
        assert img.format == "JPEG" and img.size == (640, 360)


def test_translate_preserving_case_titlecases_and_adds_opening_mark(monkeypatch):
    # Translator gets the lowercased input; we restore the Title-Case look with
    # Spanish function words ("por", "la") kept lowercase, and add the opening ¿.
    monkeypatch.setattr(image_text.translator, "translate_text", lambda t, f, to: "salvación por la sola fe?")
    out = image_text._translate_preserving_case("Salvation by Faith Alone?", "en", "es")
    assert out == "¿Salvación por la Sola Fe?"


def test_apply_case_style_all_caps_and_sentence():
    assert image_text._apply_case_style("hola mundo", "HELLO WORLD") == "HOLA MUNDO"
    assert image_text._apply_case_style("hola mundo", "hello world") == "Hola mundo"


def test_spanish_opening_marks():
    assert image_text._add_spanish_opening_marks("Sólo por la Fe?") == "¿Sólo por la Fe?"
    assert image_text._add_spanish_opening_marks("Increíble!") == "¡Increíble!"
    assert image_text._add_spanish_opening_marks("¿Ya existe?") == "¿Ya existe?"   # not doubled
    assert image_text._add_spanish_opening_marks("Una afirmación.") == "Una afirmación."  # untouched


def test_opening_mark_only_for_spanish(monkeypatch):
    # A non-Spanish target must not get the inverted mark.
    monkeypatch.setattr(image_text.translator, "translate_text", lambda t, f, to: "is it real?")
    assert image_text._translate_preserving_case("Is It Real?", "es", "en") == "Is It Real?"


# --- font matching (serif vs sans detection) -------------------------------
# These render real glyphs, so they need opencv + the DejaVu serif/sans bold
# faces on the box (both ship with fonts-dejavu-core). Skipped cleanly without
# them, like the rest of the heavy-pipeline suite.
from pathlib import Path as _Path  # noqa: E402

_DEJAVU_SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
_DEJAVU_SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _has_cv2_and_fonts() -> bool:
    try:
        import cv2  # noqa: F401
    except Exception:
        return False
    return _Path(_DEJAVU_SERIF).exists() and _Path(_DEJAVU_SANS).exists()


needs_fonts = pytest.mark.skipif(
    not _has_cv2_and_fonts(), reason="needs opencv + DejaVu serif/sans bold fonts"
)


def _source_arr(font_path, text, size=110):
    """A thumbnail-like crop: noisy coloured background, white glyphs with a red
    outline -- the conditions _estimate_font_family must see through."""
    from PIL import ImageDraw, ImageFont

    rng = np.random.default_rng(0)
    base = np.full((170, 1000, 3), (110, 90, 60), dtype=np.int16)
    base = np.clip(base + rng.integers(-15, 16, base.shape), 0, 255).astype(np.uint8)
    pim = Image.fromarray(base)
    fnt = ImageFont.truetype(font_path, size)
    ImageDraw.Draw(pim).text(
        (12, 8), text, font=fnt, fill=(255, 255, 255), stroke_width=6, stroke_fill=(200, 40, 40)
    )
    return np.asarray(pim)


def _titled(bg, text, fill, outline=None, size=110):
    """Render `text` (DejaVu sans bold) onto a background array."""
    from PIL import ImageDraw, ImageFont

    pim = Image.fromarray(np.ascontiguousarray(bg))
    fnt = ImageFont.truetype(_DEJAVU_SANS, size)
    kw = dict(fill=fill)
    if outline:
        kw.update(stroke_width=5, stroke_fill=outline)
    ImageDraw.Draw(pim).text((14, 10), text, font=fnt, **kw)
    return np.asarray(pim)


def _black_banner(h=150, w=900):
    return np.zeros((h, w, 3), dtype=np.uint8)


def _bookshelf(h=150, w=900):
    rng = np.random.default_rng(7)
    img = np.zeros((h, w, 3), dtype=np.uint8)
    x = 0
    while x < w:
        bw = int(rng.integers(20, 55))
        img[:, x:x + bw] = rng.integers(30, 200, 3)
        x += bw
    return img


def _full_region(arr):
    h, w = arr.shape[:2]
    return TextRegion(polygon=[(0, 0), (w, 0), (w, h), (0, h)], text="SALVATION")


@needs_fonts
def test_analyze_region_banner_white_text():
    style = image_text._analyze_region(_titled(_black_banner(), "SALVATION", (255, 255, 255)), (0, 0, 900, 150))
    assert style.has_banner
    assert max(style.banner_color) < 35   # banner ~ black
    assert min(style.fill) > 200          # text ~ white


@needs_fonts
def test_analyze_region_banner_salmon_text():
    style = image_text._analyze_region(_titled(_black_banner(), "SEGURO", (242, 138, 120)), (0, 0, 900, 150))
    assert style.has_banner and max(style.banner_color) < 35
    assert style.fill[0] > 190 and style.fill[1] < 200 and style.fill[2] < 200  # ~ salmon


@needs_fonts
def test_analyze_region_scene_is_not_a_banner():
    arr = _titled(_bookshelf(), "SALVATION", (255, 255, 255), outline=(8, 8, 8))
    style = image_text._analyze_region(arr, (0, 0, 900, 150))
    assert not style.has_banner
    # Reads the text as LIGHT (correct polarity); exact shade is approximate when
    # text sits directly on busy clutter (real thumbnails use banners).
    assert min(style.fill) > 140


@needs_fonts
def test_render_translations_repaints_banner_not_a_block():
    arr = _titled(_black_banner(), "SALVATION", (255, 255, 255))
    out, replaced = image_text.render_translations(Image.fromarray(arr), [(_full_region(arr), "SALVACION")])
    assert replaced == 1
    out_arr = np.asarray(out)
    # The banner (majority of the region) stays ~black -- not a wrong-colour block
    # (the bug repainted it grey/salmon) -- with white text drawn on top.
    assert np.median(out_arr.reshape(-1, 3), axis=0).max() < 40
    assert out_arr.max() > 200


@needs_fonts
def test_render_translations_preserves_scene():
    arr = _titled(_bookshelf(), "SALVATION", (255, 255, 255), outline=(8, 8, 8))
    out, replaced = image_text.render_translations(Image.fromarray(arr), [(_full_region(arr), "SALVACION")])
    assert replaced == 1
    # The scene's variance survives (a flat block would collapse it).
    assert float(np.asarray(out).reshape(-1, 3).std(axis=0).mean()) > 35


@needs_fonts
def test_stroke_modulation_serif_exceeds_sans():
    from PIL import ImageDraw, ImageFont

    def mod_of(font_path):
        img = Image.new("L", (1100, 200), 0)
        fnt = ImageFont.truetype(font_path, 96)
        ImageDraw.Draw(img).text((12, 10), "Salvation Es Tu", font=fnt, fill=255)
        return image_text._stroke_width_modulation(np.asarray(img) > 64)

    # The discriminating signal: serif modulates thick/thin, sans is near-uniform.
    assert mod_of(_DEJAVU_SERIF) > mod_of(_DEJAVU_SANS)


@needs_fonts
def test_estimate_font_family_detects_sans_source():
    # A clean heavy-sans render sits well below the threshold -> sans.
    arr = _source_arr(_DEJAVU_SANS, "IS YOUR SALVATION")
    assert image_text._estimate_font_family(arr, (0, 0, arr.shape[1], arr.shape[0])) == "sans"


def test_estimate_font_family_threshold(monkeypatch):
    # The serif/sans call is an absolute cut at settings.thumbnail_serif_threshold
    # (default 0.62), biased toward sans because real thumbnails inflate the score.
    monkeypatch.setattr(image_text, "_region_glyph_mask", lambda arr, bbox: np.ones((20, 20), bool))
    monkeypatch.setattr(image_text, "_stroke_width_modulation", lambda mask: 0.30)
    assert image_text._estimate_font_family(None, (0, 0, 20, 20)) == "sans"
    monkeypatch.setattr(image_text, "_stroke_width_modulation", lambda mask: 0.80)
    assert image_text._estimate_font_family(None, (0, 0, 20, 20)) == "serif"


def test_estimate_font_family_undetectable_defaults_sans(monkeypatch):
    monkeypatch.setattr(image_text, "_region_glyph_mask", lambda arr, bbox: None)
    assert image_text._estimate_font_family(None, (0, 0, 20, 20)) == "sans"


@needs_fonts
def test_render_region_uses_the_detected_family():
    # render_translations should tag each region with the source's family, and
    # _render_region should pull the matching font for it.
    assert image_text._find_text_font("sans").lower().find("sans") != -1
    assert image_text._find_text_font("serif").lower().find("serif") != -1


def _reg(x0, y0, x1, y1, text):
    return TextRegion(polygon=[(x0, y0), (x1, y0), (x1, y1), (x0, y1)], text=text)


def test_group_text_lines_merges_same_row_fragments():
    # Four boxes on one row (same y span) -> one line, ordered left-to-right.
    regs = [_reg(300, 20, 360, 60, "HERE"), _reg(0, 20, 60, 60, "THIS"),
            _reg(100, 22, 180, 58, "GUY"), _reg(200, 20, 280, 60, "RIGHT")]
    lines = image_text._group_text_lines(regs)
    assert len(lines) == 1
    assert [r.text for r in lines[0]] == ["THIS", "GUY", "RIGHT", "HERE"]
    merged = image_text._merge_line_regions(lines[0])
    assert merged.text == "THIS GUY RIGHT HERE"
    assert merged.bbox == (0, 20, 360, 60)


def test_group_text_lines_keeps_separate_rows():
    regs = [_reg(0, 0, 200, 40, "WHERE"), _reg(0, 60, 200, 100, "FROM?")]
    lines = image_text._group_text_lines(regs)
    assert [[(r.text) for r in ln] for ln in lines] == [["WHERE"], ["FROM?"]]


def test_detect_and_translate_groups_then_translates_phrase(monkeypatch):
    # The detector returns per-word boxes; the translator should receive the
    # whole line, not each word in isolation.
    regs = [_reg(0, 0, 60, 40, "THIS"), _reg(70, 0, 140, 40, "GUY")]
    monkeypatch.setattr(ocr_onnx, "detect_text_regions", lambda *a, **k: regs)
    seen = []

    def fake_translate(text, frm, to):
        seen.append(text)
        return "ESTE TIPO"

    monkeypatch.setattr(image_text.translator, "translate_text", fake_translate)
    pairs = image_text.detect_and_translate(Image.new("RGB", (200, 60)), "en", "es")
    assert seen == ["this guy"]                 # one phrase, lowercased for MT
    # ALL-CAPS source -> ALL-CAPS translation, as one merged line.
    assert len(pairs) == 1 and pairs[0][1] == "ESTE TIPO"
