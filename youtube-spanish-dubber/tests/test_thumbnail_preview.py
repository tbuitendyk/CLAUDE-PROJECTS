"""Tests for the thumbnail-preview orchestration (generate/edit/encode).

Like test_image_text, these stub the detector + translator so no OCR/MT model
or network is needed; the render + banner + base64 plumbing is exercised for
real against a generated image.
"""
from __future__ import annotations

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from youtube_dubber.pipeline import image_text, ocr_onnx, thumbnail, thumbnail_preview  # noqa: E402
from youtube_dubber.pipeline.models import TextRegion  # noqa: E402

_BOX = (40, 140, 600, 230)


def _region(text, box=_BOX, confidence=0.99):
    x0, y0, x1, y1 = box
    return TextRegion(polygon=[(x0, y0), (x1, y0), (x1, y1), (x0, y1)], text=text, confidence=confidence)


@pytest.fixture
def _font_or_skip():
    if thumbnail._find_font() is None:
        pytest.skip("no DejaVu font installed")


def test_data_uri_round_trips():
    img = Image.new("RGB", (200, 100), (12, 34, 56))
    uri = thumbnail_preview.image_to_data_uri(img)
    assert uri.startswith("data:image/jpeg;base64,")
    decoded = thumbnail_preview.data_uri_to_image(uri)
    assert decoded.size == (200, 100)


def test_data_uri_accepts_bare_base64():
    img = Image.new("RGB", (64, 64), (0, 0, 0))
    uri = thumbnail_preview.image_to_data_uri(img)
    bare = uri.split(",", 1)[1]
    assert thumbnail_preview.data_uri_to_image(bare).size == (64, 64)


def test_generate_preview_returns_image_and_editable_regions(_font_or_skip, monkeypatch):
    monkeypatch.setattr(
        ocr_onnx, "detect_text_regions",
        lambda image, min_confidence=0.0: [_region("HELLO WORLD")],
    )
    monkeypatch.setattr(image_text.translator, "translate_text", lambda t, f, to: "HOLA MUNDO")

    src = Image.new("RGB", (640, 360), (180, 30, 30))
    generated, regions = thumbnail_preview.generate_preview(
        src, "en", "es", banner_text="Versión Español",
    )

    assert generated.size == (640, 360)
    assert len(regions) == 1
    region = regions[0]
    assert region["text"] == "HELLO WORLD"
    assert region["translation"] == "HOLA MUNDO"
    assert region["box"] == list(_BOX)
    assert len(region["polygon"]) == 4
    # The text area changed (painted out + re-rendered).
    assert not np.array_equal(np.asarray(src)[140:230, 40:600], np.asarray(generated)[140:230, 40:600])


def test_generate_preview_no_text_returns_unbranded_original(monkeypatch):
    monkeypatch.setattr(ocr_onnx, "detect_text_regions", lambda image, min_confidence=0.0: [])
    src = Image.new("RGB", (320, 180), (10, 80, 160))
    # banner_text empty -> _brand is a no-op, so we get the source straight back.
    generated, regions = thumbnail_preview.generate_preview(src, "en", "es", banner_text="")
    assert regions == []
    assert generated is src


def test_render_edited_applies_user_translation(_font_or_skip):
    src = Image.new("RGB", (640, 360), (15, 15, 15))
    edited = [{"polygon": [[40, 140], [600, 140], [600, 230], [40, 230]], "translation": "TEXTO EDITADO"}]
    out = thumbnail_preview.render_edited(src, edited, banner_text="Versión Español")
    assert out.size == (640, 360)
    assert not np.array_equal(np.asarray(src), np.asarray(out))


def test_render_edited_skips_blank_translations(_font_or_skip):
    src = Image.new("RGB", (320, 180), (15, 15, 15))
    # No usable translations -> nothing rendered, banner-only over the original.
    out = thumbnail_preview.render_edited(
        src, [{"polygon": [[10, 10], [100, 10], [100, 40], [10, 40]], "translation": "  "}],
        banner_text="",
    )
    assert out is src
