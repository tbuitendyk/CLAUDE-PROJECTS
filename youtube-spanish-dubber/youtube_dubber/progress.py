"""Maps pipeline stages (and within-stage fractions) to an overall 0-100%
completion figure for the job progress bar.

Each stage owns a contiguous band of the overall bar. A stage that can report
how far along it is (download bytes, Whisper audio position, synthesized line
count, upload bytes) interpolates within its band, so the bar keeps moving
through the long stages instead of jumping only at stage boundaries. Stages
that can't report sub-progress simply park at their band's start until the next
stage begins -- the UI animates the bar meanwhile so it still reads as alive.

Bands are deliberately weighted toward the slow stages (transcript + synthesis)
so the bar's pace roughly tracks real elapsed time rather than stage count.
"""
from __future__ import annotations

from typing import Optional

# stage -> (start%, end%). Order/contiguity is intentional; gaps would make the
# bar jump backward when a stage with no sub-progress hands off to the next.
STAGE_BANDS: dict[str, tuple[float, float]] = {
    "queued": (0.0, 0.0),
    "probing": (1.0, 3.0),
    "downloading": (3.0, 15.0),
    "transcript": (15.0, 45.0),
    "synthesizing": (45.0, 82.0),
    "muxing": (82.0, 90.0),
    "uploading": (90.0, 99.0),
    "done": (100.0, 100.0),
}


def overall_percent(stage: str, fraction: Optional[float] = None) -> Optional[float]:
    """Overall completion (0-100) for `stage`, optionally interpolated by an
    in-stage `fraction` (0..1). Returns None for stages not on the bar
    (e.g. 'starting', 'failed', 'cancelled', 'interrupted') so the caller can
    leave the last known percent untouched rather than resetting it."""
    band = STAGE_BANDS.get(stage)
    if band is None:
        return None
    start, end = band
    if fraction is None:
        return start
    f = max(0.0, min(1.0, float(fraction)))
    return round(start + f * (end - start), 1)
