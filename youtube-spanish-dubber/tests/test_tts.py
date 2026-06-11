"""Tests for the dub audio timeline (tts._fit_tempo / _plan_timeline).

These are the pure timing-layout helpers behind the "anchor each line to its
real start, catch up in the pauses" assembly -- no edge-tts or ffmpeg needed
(both are used only when actually synthesizing/rendering).
"""
from __future__ import annotations

import pytest

from youtube_dubber.pipeline import tts


def test_fit_tempo_only_speeds_up_overruns():
    assert tts._fit_tempo(1.0, 3.0, 1.25) == 1.0          # fits comfortably -> natural pace
    assert tts._fit_tempo(3.0, 4.0, 1.25) == 1.0          # fits -> natural pace
    assert tts._fit_tempo(4.0, 3.0, 1.25) == 1.25         # overruns -> capped at max
    assert tts._fit_tempo(3.3, 3.0, 1.5) == pytest.approx(1.1)  # overruns -> exact ratio
    assert tts._fit_tempo(2.0, 0.0, 1.25) == 1.0          # unknown/zero window -> natural


def test_plan_timeline_inserts_lead_in_and_pause_silence():
    placed = [(2.0, 1.0, "a"), (5.0, 1.0, "b")]
    plan = tts._plan_timeline(placed, total_duration=8.0)
    # lead-in 2.0s, clip a (ends 3.0), pause 2.0s to b's 5.0 start, clip b, tail 2.0s.
    assert plan == [(None, 2.0), ("a", 1.0), (None, 2.0), ("b", 1.0), (None, 2.0)]


def test_plan_timeline_catches_up_after_an_overrun():
    # 'a' is 3s long but 'b' is due at 2.0s -> b plays immediately, no silence,
    # and the slack is absorbed (no accumulation).
    placed = [(0.0, 3.0, "a"), (2.0, 1.0, "b")]
    plan = tts._plan_timeline(placed, total_duration=4.0)
    assert plan == [("a", 3.0), ("b", 1.0)]


def test_plan_timeline_tail_pads_to_total_duration():
    assert tts._plan_timeline([(0.0, 1.0, "a")], total_duration=5.0) == [("a", 1.0), (None, 4.0)]


def test_plan_timeline_sorts_by_start():
    placed = [(5.0, 1.0, "b"), (0.0, 1.0, "a")]
    plan = tts._plan_timeline(placed, total_duration=6.0)
    assert [p for p, _ in plan] == ["a", None, "b"]
