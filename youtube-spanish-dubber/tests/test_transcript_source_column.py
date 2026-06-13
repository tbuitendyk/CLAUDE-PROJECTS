"""Tests for the source-language ('original') column filled onto a Spanish-
captions dub (transcript.py): which non-Spanish track is chosen, and the
time-overlap projection of its cues onto the rechunked Spanish segments."""
from __future__ import annotations

from youtube_dubber.pipeline import transcript
from youtube_dubber.pipeline.models import Segment

ES_CODES = ("es", "es-ES", "es-419", "es-US", "es-MX")


def test_source_caption_code_prefers_declared_original_language():
    info = {"language": "en", "subtitles": {"en": [{}], "es": [{}]}}
    assert transcript._source_caption_code(info, ES_CODES) == ("en", False)


def test_source_caption_code_skips_spanish_even_if_declared():
    # A Spanish-original video with only Spanish + French tracks -> French.
    info = {"language": "es", "subtitles": {"es-419": [{}], "fr": [{}]}}
    assert transcript._source_caption_code(info, ES_CODES) == ("fr", False)


def test_source_caption_code_falls_back_to_auto_then_none():
    info = {"language": "en", "automatic_captions": {"en": [{}]}}
    assert transcript._source_caption_code(info, ES_CODES) == ("en", True)
    assert transcript._source_caption_code({"subtitles": {"es": [{}]}}, ES_CODES) is None


def test_align_originals_projects_cues_by_time_overlap():
    spanish = [Segment(0.0, 5.0, "Hola mundo"), Segment(5.0, 10.0, "Adiós")]
    english = [
        Segment(0.2, 2.0, "Hello"), Segment(2.0, 4.5, "world"),
        Segment(5.5, 9.0, "Goodbye"),
    ]
    out = transcript._align_originals(spanish, english)
    assert [s.text for s in out] == ["Hello world", "Goodbye"]
    # Times come from the Spanish (target) segments, untouched.
    assert [(s.start, s.end) for s in out] == [(0.0, 5.0), (5.0, 10.0)]


def test_align_originals_none_when_no_overlap_or_empty():
    spanish = [Segment(0.0, 5.0, "Hola")]
    # No overlap at all (cue is way past the segment) -> all-empty -> None.
    assert transcript._align_originals(spanish, [Segment(20.0, 25.0, "late")]) is None
    assert transcript._align_originals(spanish, []) is None
    assert transcript._align_originals([], [Segment(0, 1, "x")]) is None
