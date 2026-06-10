"""Tests for the stage->overall-percent mapping that drives the progress bar."""
from __future__ import annotations

from youtube_dubber import progress


def test_known_stage_without_fraction_parks_at_band_start():
    assert progress.overall_percent("downloading") == 3.0
    assert progress.overall_percent("synthesizing") == 45.0


def test_fraction_interpolates_within_band():
    # downloading band is 3..15
    assert progress.overall_percent("downloading", 0.0) == 3.0
    assert progress.overall_percent("downloading", 0.5) == 9.0
    assert progress.overall_percent("downloading", 1.0) == 15.0


def test_fraction_is_clamped():
    assert progress.overall_percent("synthesizing", -2) == 45.0   # clamped to 0
    assert progress.overall_percent("synthesizing", 5) == 82.0    # clamped to 1


def test_done_is_100_and_bands_are_monotonic():
    assert progress.overall_percent("done") == 100.0
    # Each band starts where the previous ends -> the bar never jumps backward.
    order = ["probing", "downloading", "transcript", "synthesizing", "muxing", "uploading", "done"]
    ends = [progress.STAGE_BANDS[s][1] for s in order]
    assert ends == sorted(ends)
    for s in order:
        start, end = progress.STAGE_BANDS[s]
        assert start <= end


def test_unknown_stage_returns_none_so_percent_is_left_untouched():
    # 'starting', 'failed', 'cancelled', 'interrupted' shouldn't reset the bar.
    for stage in ("starting", "failed", "cancelled", "interrupted", "???"):
        assert progress.overall_percent(stage) is None
        assert progress.overall_percent(stage, 0.5) is None
