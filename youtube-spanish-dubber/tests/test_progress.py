"""Tests for the stage->overall-percent mapping that drives the progress bar."""
from __future__ import annotations

from youtube_dubber import progress


def test_known_stage_without_fraction_parks_at_band_start():
    assert progress.overall_percent("downloading") == 3.0
    assert progress.overall_percent("synthesizing") == 42.0


def test_fraction_interpolates_within_band():
    # downloading band is 3..15
    assert progress.overall_percent("downloading", 0.0) == 3.0
    assert progress.overall_percent("downloading", 0.5) == 9.0
    assert progress.overall_percent("downloading", 1.0) == 15.0


def test_fraction_is_clamped():
    assert progress.overall_percent("synthesizing", -2) == 42.0   # clamped to 0
    assert progress.overall_percent("synthesizing", 5) == 66.0    # clamped to 1


def test_separating_band_interpolates():
    # "music" mode's heavy separation stage gets a real, readable band.
    assert progress.overall_percent("separating", 0.0) == 66.0
    assert progress.overall_percent("separating", 0.5) == 77.0
    assert progress.overall_percent("separating", 1.0) == 88.0


def test_done_is_100_and_bands_are_monotonic():
    assert progress.overall_percent("done") == 100.0
    # Each band starts where the previous ends -> the bar never jumps backward.
    order = ["probing", "downloading", "transcript", "synthesizing", "separating", "muxing", "uploading", "done"]
    ends = [progress.STAGE_BANDS[s][1] for s in order]
    assert ends == sorted(ends)
    for s in order:
        start, end = progress.STAGE_BANDS[s]
        assert start <= end


def test_intro_bands_start_near_zero_and_track_mux_then_upload():
    bands = progress.INTRO_STAGE_BANDS
    # The mux step (often a multi-minute re-encode) owns the first 70% -- so the
    # bar starts near 0 and creeps, instead of parking at a dub's 88% "muxing".
    assert progress.overall_percent("muxing", 0.0, bands=bands) == 0.0
    assert progress.overall_percent("muxing", 0.5, bands=bands) == 35.0
    assert progress.overall_percent("muxing", 1.0, bands=bands) == 70.0
    # Upload owns the rest.
    assert progress.overall_percent("uploading", 0.0, bands=bands) == 70.0
    assert progress.overall_percent("uploading", 1.0, bands=bands) == 99.0
    assert progress.overall_percent("done", bands=bands) == 100.0


def test_unknown_stage_returns_none_so_percent_is_left_untouched():
    # 'starting', 'failed', 'cancelled', 'interrupted' shouldn't reset the bar.
    for stage in ("starting", "failed", "cancelled", "interrupted", "???"):
        assert progress.overall_percent(stage) is None
        assert progress.overall_percent(stage, 0.5) is None


# --- time_fraction: the time-based creep used by the heartbeat ----------------

def test_time_fraction_halves_the_remaining_gap_each_halflife():
    assert progress.time_fraction(0, 100) == 0.0
    assert progress.time_fraction(100, 100) == 0.5
    assert progress.time_fraction(200, 100) == 0.75
    assert progress.time_fraction(300, 100) == 0.875


def test_time_fraction_is_bounded_and_defensive():
    # Approaches 1.0 from below as time grows; clock skew / bad halflife -> 0.
    assert 0.99 < progress.time_fraction(1000, 100) < 1.0  # ten halflives
    assert progress.time_fraction(-5, 100) == 0.0
    assert progress.time_fraction(100, 0) == 0.0
    assert progress.time_fraction(100, -1) == 0.0


# --- StageHeartbeat: keeps a silent stage's bar creeping forward --------------

class _FakeClock:
    """A manually-advanced clock so heartbeat timing is deterministic in tests
    (no real sleeps, no background thread)."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _heartbeat(clock):
    captured: list[tuple[str, float]] = []
    hb = progress.StageHeartbeat(
        lambda message, fraction: captured.append((message, fraction)),
        halflife=100.0, interval=2.0, clock=clock,
    )
    return hb, captured


def test_heartbeat_creeps_forward_with_no_real_signal():
    clock = _FakeClock()
    hb, captured = _heartbeat(clock)
    hb.report("Acquiring a transcript...", 0.0)  # seed
    clock.advance(100)
    hb._tick()  # one eased tick after a halflife
    assert captured[-1] == ("Acquiring a transcript...", 0.5)


def test_heartbeat_is_monotonic_and_ignores_a_lower_real_signal():
    clock = _FakeClock()
    hb, captured = _heartbeat(clock)
    hb.report("working", 0.0)
    clock.advance(100)
    hb._tick()  # eased to 0.5
    # A real signal that's *behind* the eased bar must not pull it backward.
    hb.report("real 30%", 0.3)
    fractions = [f for _, f in captured]
    assert fractions == sorted(fractions)
    assert fractions[-1] == 0.5


def test_heartbeat_jumps_forward_to_a_further_real_signal():
    clock = _FakeClock()
    hb, captured = _heartbeat(clock)
    hb.report("working", 0.0)
    hb.report("real 80%", 0.8)
    assert captured[-1] == ("real 80%", 0.8)


def test_heartbeat_caps_below_the_band_end():
    clock = _FakeClock()
    hb, captured = _heartbeat(clock)
    hb.report("working", 0.0)
    clock.advance(10_000)  # would ease to ~1.0
    hb._tick()
    assert captured[-1][1] == 0.99  # never fills the band itself


def test_heartbeat_context_manager_runs_and_stops_cleanly():
    # Real thread, but a long interval so it never actually ticks during the
    # test -- we're checking start/stop/join don't raise or hang.
    captured: list[tuple[str, float]] = []
    with progress.StageHeartbeat(
        lambda message, fraction: captured.append((message, fraction)), interval=60.0
    ) as hb:
        hb.report("seed", 0.0)
    assert captured == [("seed", 0.0)]
