"""Maps pipeline stages (and within-stage fractions) to an overall 0-100%
completion figure for the job progress bar.

Each stage owns a contiguous band of the overall bar. A stage that can report
how far along it is (download bytes, Whisper audio position, synthesized line
count, upload bytes) interpolates within its band, so the bar keeps moving
through the long stages instead of jumping only at stage boundaries.

The transcript stage is the awkward one: it's the longest by far, yet several
of its internal paths (audio extraction, (re)loading the Whisper model, VAD,
and line-by-line caption translation) run for minutes without a single
sub-progress signal -- which would leave the bar frozen at the band start. The
`StageHeartbeat` below covers that gap: it eases the in-stage fraction forward
on a timer so the bar always creeps as a sign of life, while real signals (when
they arrive) re-anchor it to the true position.

Bands are deliberately weighted toward the slow stages (transcript + synthesis)
so the bar's pace roughly tracks real elapsed time rather than stage count.
"""
from __future__ import annotations

import threading
import time
from typing import Callable, Optional

# stage -> (start%, end%). Order/contiguity is intentional; gaps would make the
# bar jump backward when a stage with no sub-progress hands off to the next.
STAGE_BANDS: dict[str, tuple[float, float]] = {
    "queued": (0.0, 0.0),
    "probing": (1.0, 3.0),
    "downloading": (3.0, 15.0),
    "transcript": (15.0, 42.0),
    "synthesizing": (42.0, 66.0),
    # "separating" only runs in "music" mode (remove the source speech) -- a heavy
    # ML step, so it gets a real band. In other modes it's skipped and the bar
    # steps from synthesizing straight to muxing (a small forward hop, fine since
    # those modes' muxing is quick).
    "separating": (66.0, 88.0),
    "muxing": (88.0, 90.0),
    "uploading": (90.0, 99.0),
    "done": (100.0, 100.0),
}

# Intro-republish jobs (mode="intro") have a different work profile than a full
# dub: just the (optionally long, re-encoding) intro mux, then the upload. They
# get their own bands so the bar starts near 0 and tracks those two phases --
# instead of inheriting a dub's tiny "muxing" band (88-90%) and looking frozen
# near "done" for the minutes a master re-encode can take.
INTRO_STAGE_BANDS: dict[str, tuple[float, float]] = {
    "starting": (0.0, 0.0),
    "muxing": (0.0, 70.0),
    "uploading": (70.0, 99.0),
    "done": (100.0, 100.0),
}


def overall_percent(stage: str, fraction: Optional[float] = None,
                    bands: Optional[dict[str, tuple[float, float]]] = None) -> Optional[float]:
    """Overall completion (0-100) for `stage`, optionally interpolated by an
    in-stage `fraction` (0..1). `bands` selects the stage->band map (defaults to
    the full-dub `STAGE_BANDS`; pass `INTRO_STAGE_BANDS` for intro jobs). Returns
    None for stages not on the bar (e.g. 'failed', 'cancelled', 'interrupted') so
    the caller can leave the last known percent untouched rather than resetting."""
    band = (bands or STAGE_BANDS).get(stage)
    if band is None:
        return None
    start, end = band
    if fraction is None:
        return start
    f = max(0.0, min(1.0, float(fraction)))
    return round(start + f * (end - start), 1)


def time_fraction(elapsed: float, halflife: float) -> float:
    """A 0..1 progress fraction derived purely from elapsed time, approaching 1
    asymptotically: 0 at `elapsed`=0, 0.5 after one `halflife`, 0.75 after two,
    and so on -- never actually reaching 1.

    Used to keep a stage's bar creeping forward when the stage can't report real
    sub-progress, without ever claiming the stage is done. The decelerating
    shape means the bar moves briskly at first (so it visibly reads as alive)
    then eases off (so it doesn't race far ahead of reality). Negative elapsed
    (clock skew) clamps to 0; a non-positive halflife yields 0 rather than
    dividing by zero."""
    if halflife <= 0 or elapsed <= 0:
        return 0.0
    return 1.0 - 0.5 ** (elapsed / halflife)


class StageHeartbeat:
    """Keeps a long, sub-progress-poor stage's bar visibly moving.

    The transcript stage can run for many minutes with little or no sub-progress
    to report -- audio extraction, (re)loading the Whisper model, VAD, and
    especially line-by-line caption translation all run silently -- which leaves
    the overall bar frozen at the stage's band start. Used as a context manager,
    this spins up a daemon thread that eases the in-stage fraction toward (but
    never to) 1.0 on a timer, so the bar always creeps forward.

    Real sub-progress signals, when they arrive, are reported as-is through
    `report(message, fraction)` and re-anchor the easing: a real fraction
    further along jumps the bar forward, and every real signal resets the easing
    clock so the time-based creep resumes from the latest real position rather
    than racing ahead of it. The emitted fraction is held monotonic (it never
    moves backward) and capped just below the band end, so the stage's real
    completion -- reported by the caller after the heartbeat stops -- is what
    finally fills the band.

    Pass the instance's own `report` as the stage's progress callback so genuine
    updates and the heartbeat share one monotonic output:

        with StageHeartbeat(emit) as hb:
            hb.report("Acquiring a Spanish transcript...", 0.0)  # seed it
            do_the_slow_work(report=hb.report)
        emit("Transcript ready", 1.0)  # heartbeat stopped; fill the band
    """

    def __init__(
        self,
        emit: Callable[[str, Optional[float]], None],
        *,
        halflife: float = 180.0,
        interval: float = 2.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._emit = emit
        self._halflife = halflife
        self._interval = interval
        self._clock = clock
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._message: Optional[str] = None
        self._anchor_frac = 0.0          # furthest *real* fraction seen so far
        self._anchor_at = clock()        # when the easing clock was last reset
        self._emitted = 0.0              # last fraction pushed out (monotonic)

    def report(self, message: str, fraction: Optional[float]) -> None:
        """Feed a real sub-progress signal through. Re-anchors the easing and
        emits immediately (subject to the monotonic floor)."""
        with self._lock:
            self._message = message
            self._anchor_at = self._clock()
            if fraction is not None and fraction > self._anchor_frac:
                self._anchor_frac = fraction
            self._emit_locked(fraction if fraction is not None else self._anchor_frac)

    def _eased(self) -> float:
        """Time-eased fraction: ease across the gap from the last real anchor
        toward 1.0 by the elapsed-time fraction."""
        gap = 1.0 - self._anchor_frac
        return self._anchor_frac + gap * time_fraction(self._clock() - self._anchor_at, self._halflife)

    def _emit_locked(self, fraction: float) -> None:
        # Monotonic and capped just below the band end -- only the caller's
        # explicit end-of-stage report (after this heartbeat stops) fills it.
        frac = max(self._emitted, min(0.99, float(fraction)))
        self._emitted = frac
        if self._message is not None:
            self._emit(self._message, frac)

    def _tick(self) -> None:
        with self._lock:
            if self._message is not None:
                self._emit_locked(self._eased())

    def _run(self) -> None:
        # _stop.wait returns True only when set -> loop ends; otherwise it
        # blocks for `interval` and we emit one eased tick.
        while not self._stop.wait(self._interval):
            self._tick()

    def __enter__(self) -> "StageHeartbeat":
        self._thread = threading.Thread(target=self._run, name="stage-heartbeat", daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> bool:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=self._interval + 1.0)
        return False  # never suppress an exception from the stage
