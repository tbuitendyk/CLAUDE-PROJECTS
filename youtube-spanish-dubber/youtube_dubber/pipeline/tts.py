"""Spanish speech synthesis via edge-tts, time-aligned to the source captions.

edge-tts is a free, open-source wrapper around Microsoft Edge's "Read Aloud"
neural text-to-speech service. It needs no API key or account and produces
natural neural voices in many languages/locales, including several Spanish
variants (e.g. es-ES-AlvaroNeural, es-MX-JorgeNeural).

For each caption segment we:
  1. synthesize speech for the (Spanish) text,
  2. time-stretch it with ffmpeg so it fills the gap until the next line
     starts -- not just its own (often much shorter) caption window --
     clamped to a sane speaking-rate range so it doesn't sound chipmunked or,
     conversely, race ahead and then sit in silence, and
  3. glue every clip together back to back -- with no silence wedged between
     them -- into one continuous narration track spanning the whole video,
     padded only at the very start (until the first line begins) and the very
     end (after the last line finishes), so the dub speaks naturally with no
     dead air in the middle.

Per-segment fitting alone can't be perfect -- some lines are clamped to the
speaking-rate range and over/underrun their slot, and those small drifts
accumulate over a long video. As a final pass, the whole assembled track
gets one gentle, uniform tempo nudge so it starts and ends exactly with the
video regardless of how it drifted in the middle (see _fit_to_duration).
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import edge_tts

from . import ffmpeg_utils
from .models import Segment

log = logging.getLogger(__name__)

# Clamp how much we're willing to speed up/slow down synthesized speech to
# match its target duration. Outside this range dubs start to sound
# unnatural, so we'd rather drift slightly out of sync than butcher the audio.
MIN_TEMPO = 0.8
MAX_TEMPO = 1.2

# How much of the time until the *next* line starts a clip is allowed to
# stretch into. A caption cue's own start/end window only covers "while these
# words are on screen", which is often much shorter than the natural pause
# before the next line begins -- sizing to the cue alone makes the narration
# race to fit a tight window, finish early, then sit in silence until the
# next cue's start time arrives. Targeting the *entire* gap between lines
# instead lets each clip speak at a natural pace with no idle silence between
# them, rather than alternating between rushed and idle.
NARRATION_FILL_FRACTION = 1.0


async def _synthesize(text: str, voice: str, rate: str, out_path: Path) -> None:
    communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
    await communicate.save(str(out_path))


def _synthesize_sync(text: str, voice: str, rate: str, out_path: Path) -> None:
    asyncio.run(_synthesize(text, voice, rate, out_path))


def synthesize_track(
    segments: list[Segment],
    total_duration: float,
    voice: str,
    rate: str,
    work_dir: Path,
    on_line: "Callable[[int, int], None] | None" = None,
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

        next_start = segments[idx + 1].start if idx + 1 < len(segments) else total_duration
        slot = max(next_start - seg.start, seg.duration)
        target_duration = slot * NARRATION_FILL_FRACTION if slot > 0.2 else raw_duration
        tempo = max(MIN_TEMPO, min(MAX_TEMPO, raw_duration / target_duration))

        fitted_path = clips_dir / f"seg_{idx:04d}.wav"
        ffmpeg_utils.to_standard_wav(raw_path, fitted_path, atempo=tempo)
        raw_path.unlink(missing_ok=True)

        fitted_duration = ffmpeg_utils.probe_duration(fitted_path)
        placed.append((seg.start, fitted_duration, fitted_path))

    if not placed:
        raise RuntimeError("No speech segments were synthesized; cannot build a dub track")

    track_path = _build_timeline(placed, total_duration, work_dir)
    return _fit_to_duration(track_path, total_duration, work_dir)


def _fit_to_duration(track_path: Path, total_duration: float, work_dir: Path) -> Path:
    """Final alignment pass: nudge the *whole* assembled track's tempo so it
    starts and ends exactly with the video, regardless of how per-segment
    fitting drifted along the way.

    Per-segment fitting keeps each line roughly anchored to its own moment,
    but small overruns/underruns (especially ones pinned at MIN_TEMPO/
    MAX_TEMPO because a line genuinely couldn't fit its slot) accumulate --
    left alone, the narration would end before or after the video does.
    Spreading that accumulated drift across the entire track as one gentle,
    uniform speed change is far less perceptible than it showing up as a
    growing desync or a mistimed ending.
    """
    actual_duration = ffmpeg_utils.probe_duration(track_path)
    if actual_duration <= 0 or total_duration <= 0:
        return track_path

    global_tempo = max(MIN_TEMPO, min(MAX_TEMPO, actual_duration / total_duration))
    if abs(global_tempo - 1.0) < 0.005:
        return track_path

    fitted_path = work_dir / "narration_aligned.wav"
    ffmpeg_utils.to_standard_wav(track_path, fitted_path, atempo=global_tempo)
    return fitted_path


def _build_timeline(placed: list[tuple[float, float, Path]], total_duration: float, work_dir: Path) -> Path:
    """Glue clips together back to back, in chronological order, with no
    silence between them.

    An earlier version anchored each clip to its own cue's start time and
    plugged the resulting gaps with silence -- but per-segment fitting can't
    be perfect (lines clamped to the speaking-rate range routinely finish
    short of their slot), so that left the narration full of distracting dead
    air between lines. Playing every clip immediately after the previous one
    instead guarantees zero gaps in the middle of the track; the only silence
    left is the natural lead-in before the first line starts and the tail
    after the last one ends. `_fit_to_duration` (below) then nudges the whole
    track's tempo so it still starts and ends exactly with the video.
    """
    placed = sorted(placed, key=lambda item: item[0])
    silence_dir = work_dir / "tts_clips" / "silence"
    silence_dir.mkdir(parents=True, exist_ok=True)

    timeline: list[Path] = []
    cursor = 0.0

    lead_in = placed[0][0]
    if lead_in > 0.05:
        lead_path = silence_dir / "lead_in.wav"
        ffmpeg_utils.generate_silence(lead_path, lead_in)
        timeline.append(lead_path)
        cursor += lead_in

    for _, duration, path in placed:
        timeline.append(path)
        cursor += duration

    if cursor < total_duration - 0.05:
        tail_path = silence_dir / "tail.wav"
        ffmpeg_utils.generate_silence(tail_path, total_duration - cursor)
        timeline.append(tail_path)

    out_path = work_dir / "narration.wav"
    ffmpeg_utils.concat_wavs(timeline, out_path)
    return out_path
