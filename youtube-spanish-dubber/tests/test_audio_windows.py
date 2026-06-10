"""Tests for the audio window plan that bounds Whisper's memory by transcribing
long audio one time-window at a time."""
from __future__ import annotations

from youtube_dubber.pipeline.ffmpeg_utils import audio_window_plan


def test_short_audio_is_a_single_full_window():
    # Shorter than (or equal to) one window -> single-pass, no splitting.
    assert audio_window_plan(300, 600) == [(0.0, 300)]
    assert audio_window_plan(600, 600) == [(0.0, 600)]


def test_long_audio_tiles_with_a_remainder():
    plan = audio_window_plan(1500, 600)  # 25 min in 10-min windows
    assert plan == [(0.0, 600), (600, 600), (1200, 300)]
    # Windows tile the whole timeline with no gaps or overlaps.
    assert plan[0][0] == 0.0
    assert sum(dur for _, dur in plan) == 1500
    for (s0, d0), (s1, _d1) in zip(plan, plan[1:]):
        assert abs((s0 + d0) - s1) < 1e-6


def test_exact_multiple_has_no_trailing_empty_window():
    plan = audio_window_plan(1200, 600)
    assert plan == [(0.0, 600), (600, 600)]


def test_windowing_disabled_returns_one_window():
    assert audio_window_plan(5000, 0) == [(0.0, 5000)]


def test_non_positive_total_is_empty():
    assert audio_window_plan(0, 600) == []
    assert audio_window_plan(-10, 600) == []
