"""Tests for the link/title helpers: clean video-ID extraction and the
idempotent title composer (the "[Versión Español] [Versión Español]" guard)."""
from __future__ import annotations

import pytest

from youtube_dubber import naming


@pytest.mark.parametrize("url,expected", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ?si=AbCdEfGh123", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx&index=4&t=33s", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),  # a bare ID passes through
    ("https://example.com/nope", None),
    ("", None),
])
def test_extract_video_id_drops_extraneous_url_data(url, expected):
    assert naming.extract_video_id(url) == expected


@pytest.mark.parametrize("target,label", [
    ("es", "Vídeo original"),
    ("es-MX", "Vídeo original"),   # regional variants resolve to the base code
    ("es-419", "Vídeo original"),
    ("fr", "Vidéo originale"),
    ("de", "Originalvideo"),
    ("jp", "Original video"),      # unlisted language falls back to English
    ("", "Original video"),
])
def test_original_video_label_is_localised(target, label):
    assert naming.original_video_label(target) == label


def test_original_video_credit_is_label_plus_link():
    assert naming.original_video_credit("es", "dQw4w9WgXcQ") == \
        "Vídeo original: https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def test_watch_url_is_canonical():
    assert naming.watch_url("dQw4w9WgXcQ") == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def test_compose_title_basic():
    title = naming.compose_title("Hola Mundo", "Hello World", "[Versión Español] ")
    assert title == "[Versión Español] Hola Mundo (Hello World)"


def test_compose_title_never_doubles_the_tag():
    # A redub that read its own published title back must not stack tags.
    tagged = "[Versión Español] Martin Luther estaba equivocado"
    title = naming.compose_title(tagged, tagged, "[Versión Español] ")
    assert title.count("[Versión Español]") == 1


def test_compose_title_strips_stacked_legacy_tags():
    stacked = "[Versión Español] [Versión Español] Martin Luther estaba equivocado"
    title = naming.compose_title(stacked, "Martin Luther was wrong", "[Versión Español] ")
    assert title.startswith("[Versión Español] Martin Luther estaba equivocado")
    assert title.count("[Versión Español]") == 1


def test_compose_title_skips_parens_when_titles_match():
    # An already-Spanish source: no point echoing the same text in parens.
    title = naming.compose_title("Hola Mundo", "Hola Mundo", "[ES] ")
    assert title == "[ES] Hola Mundo"


def test_compose_title_caps_length():
    long = "x" * 300
    assert len(naming.compose_title(long, "orig", "[ES] ")) <= 100
