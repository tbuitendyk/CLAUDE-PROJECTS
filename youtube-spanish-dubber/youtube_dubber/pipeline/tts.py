"""Spanish speech synthesis via edge-tts, time-aligned to the source captions.

edge-tts is a free, open-source wrapper around Microsoft Edge's "Read Aloud"
neural text-to-speech service. It needs no API key or account and produces
natural neural voices in many languages/locales, including several Spanish
variants (e.g. es-ES-AlvaroNeural, es-MX-JorgeNeural).

For each caption segment we:
  1. synthesize speech for the (Spanish) text,
  2. speed it up *only if* it would overrun the window before the next line
     starts (capped at `tts_max_tempo` so it never sounds chipmunked) -- a line
     that already fits is left at its natural pace, and
  3. place every clip at its line's *real* start time, inserting the original
     pauses between lines as silence.

Anchoring each line to its own timestamp -- rather than gluing the clips back
to back -- is what keeps the dub from drifting seconds ahead (racing through
the original's pauses) or behind (a long line shoving everything after it
later). When a line does overrun, the next one starts as soon as it can and the
slack is absorbed by the next pause ("catch up in the pauses"), so timing
errors reset at every silence instead of accumulating over the video. A final
gentle tempo nudge only kicks in if the last lines overran the end of the video
with no pause left to absorb them (see _fit_to_duration).
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Callable, Optional

from . import ffmpeg_utils
from ..config import settings
from .models import Segment

log = logging.getLogger(__name__)


async def _synthesize(text: str, voice: str, rate: str, out_path: Path) -> None:
    import edge_tts  # lazy: keeps the module importable (and the pure timeline
    # logic testable) without the synthesis dependency installed.

    communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
    await communicate.save(str(out_path))


def _synthesize_sync(text: str, voice: str, rate: str, out_path: Path) -> None:
    asyncio.run(_synthesize(text, voice, rate, out_path))


def _fit_tempo(raw_duration: float, window: float, max_tempo: float) -> float:
    """Tempo to play a clip at so it fits the `window` before the next line.

    Only ever speeds up, and only when the clip would overrun: a clip that
    already fits stays at its natural pace (1.0) and the leftover time becomes a
    real pause. Capped at `max_tempo` -- we'd rather let a line overrun (the
    timeline's catch-up absorbs it) than chipmunk the speech to force a fit."""
    if window <= 0.2 or raw_duration <= 0 or raw_duration <= window:
        return 1.0
    return min(max_tempo, raw_duration / window)


def synthesize_track(
    segments: list[Segment],
    total_duration: float,
    voice: str,
    rate: str,
    work_dir: Path,
    on_line: "Optional[Callable[[int, int], None]]" = None,
) -> Path:
    """Build a single Spanish narration WAV aligned to `segments` timing.

    The result spans exactly `total_duration` seconds (silence-padded) so it
    can be muxed directly against the source video.

    `on_line`, if given, is called as (line_number, total_lines) before each
    line is synthesized -- this is typically the longest stage, so it drives
    the progress bar line by line.
    """
    clips_dir = work_dir / "tts_clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    max_tempo = settings.tts_max_tempo

    total_lines = len(segments)
    placed: list[tuple[float, float, Path]] = []  # (start, fitted_duration, path)
    for idx, seg in enumerate(segments):
        if on_line is not None:
            try:
                on_line(idx + 1, total_lines)
            except Exception:  # noqa: BLE001 -- progress is best-effort
                pass
        text = seg.text.strip()
        if not text:
            continue

        raw_path = clips_dir / f"seg_{idx:04d}_raw.mp3"
        try:
            _synthesize_sync(text, voice, rate, raw_path)
        except Exception:
            log.exception("edge-tts failed for segment %d (%r); skipping it", idx, text[:60])
            continue

        raw_duration = ffmpeg_utils.probe_duration(raw_path)
        if raw_duration <= 0:
            continue

        # Window = time until the next line is due to start. We only compress a
        # clip that would overrun it; one that fits keeps its natural pace and
        # the remaining time becomes a real pause (preserved by _plan_timeline).
        next_start = segments[idx + 1].start if idx + 1 < len(segments) else total_duration
        tempo = _fit_tempo(raw_duration, next_start - seg.start, max_tempo)

        fitted_path = clips_dir / f"seg_{idx:04d}.wav"
        ffmpeg_utils.to_standard_wav(raw_path, fitted_path, atempo=tempo)
        raw_path.unlink(missing_ok=True)

        fitted_duration = ffmpeg_utils.probe_duration(fitted_path)
        placed.append((seg.start, fitted_duration, fitted_path))

    if not placed:
        raise RuntimeError("No speech segments were synthesized; cannot build a dub track")

    track_path = _build_timeline(placed, total_duration, work_dir)
    return _fit_to_duration(track_path, total_duration, work_dir)


def _plan_timeline(
    placed: list[tuple[float, float, Path]], total_duration: float
) -> list[tuple[Optional[Path], float]]:
    """Lay out the narration track: each clip at its real start time, with the
    original pauses inserted as silence.

    Returns an ordered list of (path | None, duration); a None path is a silence
    gap. The running `cursor` is where the previous clip ended. When the next
    clip's start is still ahead of the cursor there's a genuine pause, inserted
    as silence so the line lands on time; when it's at or behind the cursor the
    previous line overran, so the clip plays immediately (no silence) and the
    slack is left for the next pause to absorb -- timing errors reset at each
    silence rather than accumulating."""
    plan: list[tuple[Optional[Path], float]] = []
    cursor = 0.0
    for start, duration, path in sorted(placed, key=lambda item: item[0]):
        if start > cursor + 0.05:
            plan.append((None, start - cursor))
            cursor = start
        plan.append((path, duration))
        cursor += duration
    if cursor < total_duration - 0.05:
        plan.append((None, total_duration - cursor))
    return plan


def _build_timeline(
    placed: list[tuple[float, float, Path]], total_duration: float, work_dir: Path
) -> Path:
    """Render the `_plan_timeline` layout to a single WAV: clips placed at their
    timestamps, gaps filled with generated silence."""
    plan = _plan_timeline(placed, total_duration)
    silence_dir = work_dir / "tts_clips" / "silence"
    silence_dir.mkdir(parents=True, exist_ok=True)

    timeline: list[Path] = []
    for index, (path, duration) in enumerate(plan):
        if path is None:
            silence_path = silence_dir / f"gap_{index:04d}.wav"
            ffmpeg_utils.generate_silence(silence_path, duration)
            timeline.append(silence_path)
        else:
            timeline.append(path)

    out_path = work_dir / "narration.wav"
    ffmpeg_utils.concat_wavs(timeline, out_path)
    return out_path


def _fit_to_duration(track_path: Path, total_duration: float, work_dir: Path) -> Path:
    """Safety net: if the narration still runs past the end of the video -- the
    last lines overran with no pause left to absorb them -- gently speed the
    whole track up so it lands on time. Anchoring keeps this tiny or
    unnecessary; a track that already ends on/inside the video (tail-padded to
    length) is left untouched."""
    actual_duration = ffmpeg_utils.probe_duration(track_path)
    if actual_duration <= 0 or total_duration <= 0:
        return track_path

    tempo = actual_duration / total_duration
    if tempo <= 1.005:  # already on time or tail-padded to length -- leave it
        return track_path

    tempo = min(settings.tts_max_tempo, tempo)
    fitted_path = work_dir / "narration_aligned.wav"
    ffmpeg_utils.to_standard_wav(track_path, fitted_path, atempo=tempo)
    return fitted_path
