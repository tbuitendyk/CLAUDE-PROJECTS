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


def test_estimate_colors_picks_contrasting_stroke():
    # White text on a dark box -> light fill, so the stroke should be dark.
    arr = np.zeros((50, 200, 3), dtype=np.uint8)
    arr[:, :] = (20, 20, 20)
    arr[15:35, 20:180] = (250, 250, 250)  # the "text"
    fill, stroke = image_text._estimate_colors(arr, (0, 0, 200, 50))
    assert min(fill) > 150          # recovered a light text colour
    assert stroke == (0, 0, 0)      # dark outline for contrast
