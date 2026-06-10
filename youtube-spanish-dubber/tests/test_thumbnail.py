"""Tests for the thumbnail branding helpers.

The font-lookup / guard logic runs anywhere; the actual render is exercised
with Pillow (a hard dependency) against a generated source image, asserting a
valid JPEG comes out -- including with accented banner text."""
from __future__ import annotations

import pytest

from youtube_dubber.pipeline import thumbnail


def test_find_font_prefers_existing_explicit_font(tmp_path):
    font = tmp_path / "MyFont.ttf"
    font.write_bytes(b"not really a font, just needs to exist")
    assert thumbnail._find_font(str(font)) == str(font)


def test_find_font_returns_none_when_nothing_exists(monkeypatch):
    monkeypatch.setattr(thumbnail, "_FONT_CANDIDATES", ("/nope/DoesNotExist.ttf",))
    assert thumbnail._find_font("") is None


def test_brand_thumbnail_returns_none_for_missing_source(tmp_path):
    assert thumbnail.brand_thumbnail(tmp_path / "nope.jpg", tmp_path / "out.jpg", text="x") is None


def test_brand_thumbnail_returns_none_for_empty_text(tmp_path):
    src = tmp_path / "src.jpg"
    src.write_bytes(b"fake")
    assert thumbnail.brand_thumbnail(src, tmp_path / "out.jpg", text="   ") is None


def test_brand_thumbnail_returns_none_without_font(tmp_path, monkeypatch):
    src = tmp_path / "src.jpg"
    src.write_bytes(b"fake image bytes")
    monkeypatch.setattr(thumbnail, "_FONT_CANDIDATES", ("/nope/DoesNotExist.ttf",))
    assert thumbnail.brand_thumbnail(src, tmp_path / "out.jpg", text="x", font="") is None


def test_brand_thumbnail_renders_a_valid_jpeg(tmp_path):
    PIL_Image = pytest.importorskip("PIL.Image")
    # A font is required; skip cleanly on a box without DejaVu installed.
    if thumbnail._find_font("") is None:
        pytest.skip("no DejaVu font installed")

    src = tmp_path / "src.png"
    PIL_Image.new("RGB", (1280, 720), (51, 102, 170)).save(src)

    out = tmp_path / "thumbnail_es.jpg"
    result = thumbnail.brand_thumbnail(src, out, text="Versión Español")

    assert result == out and out.exists()
    with PIL_Image.open(out) as img:
        assert img.format == "JPEG"
        assert img.size == (1280, 720)  # branding preserves the source dimensions
