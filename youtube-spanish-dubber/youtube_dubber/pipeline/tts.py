"""Spanish speech synthesis via edge-tts, time-aligned to the source captions.

edge-tts is a free, open-source wrapper around Microsoft Edge's "Read Aloud"
neural text-to-speech service. It needs no API key or account and produces
natural neural voices in many languages/locales, including several Spanish
variants (e.g. es-ES-AlvaroNeural, es-MX-JorgeNeural).

For each caption segment we:
  1. synthesize speech for the (Spanish) text,
  2. time-stretch it with ffmpeg so it fills most of the gap until the next
     line starts -- not just its own (often much shorter) caption window --
     clamped to a sane speaking-rate range so it doesn't sound chipmunked or,
     conversely, race ahead and then sit in silence, and
  3. stitch every clip together -- with a small silence gap between each --
     into one narration track spanning the whole video, so the dub stays
     roughly in sync with on-screen action and cuts.
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
MIN_TEMPO = 0.75
MAX_TEMPO = 1.6

# How much of the time until the *next* line starts a clip is allowed to
# stretch into. A caption cue's own start/end window only covers "while these
# words are on screen", which is often much shorter than the natural pause
# before the next line begins -- sizing to the cue alone makes the narration
# race to fit a tight window, finish early, then sit in silence until the
# next cue's start time arrives. Targeting most of the *actual* gap between
# lines instead lets each clip speak at a natural pace with only a small,
# even breathing gap, rather than alternating between rushed and idle.
NARRATION_FILL_FRACTION = 0.95


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
) -> Path:
    """Build a single Spanish narration WAV aligned to `segments` timing.

    The result spans exactly `total_duration` seconds (silence-padded) so it
    can be muxed directly against the source video.
    """
    clips_dir = work_dir / "tts_clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    placed: list[tuple[float, float, Path]] = []  # (start, fitted_duration, path)
    for idx, seg in enumerate(segments):
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

    return _build_timeline(placed, total_duration, work_dir)


def _build_timeline(placed: list[tuple[float, float, Path]], total_duration: float, work_dir: Path) -> Path:
    """Concatenate clips in chronological order, inserting silence to keep
    each one anchored close to its original start time and avoid overlap."""
    placed = sorted(placed, key=lambda item: item[0])
    silence_dir = work_dir / "tts_clips" / "silence"
    silence_dir.mkdir(parents=True, exist_ok=True)

    timeline: list[Path] = []
    cursor = 0.0
    for n, (start, duration, path) in enumerate(placed):
        gap = start - cursor
        if gap > 0.05:
            silence_path = silence_dir / f"gap_{n:04d}.wav"
            ffmpeg_utils.generate_silence(silence_path, gap)
            timeline.append(silence_path)
            cursor += gap
        # If this clip would overlap the previous one (because it had to be
        # slowed down to MAX_TEMPO and still ran long), it simply plays back
        # to back -- still far better than truncating speech.
        timeline.append(path)
        cursor += duration

    if cursor < total_duration - 0.05:
        tail_path = silence_dir / "tail.wav"
        ffmpeg_utils.generate_silence(tail_path, total_duration - cursor)
        timeline.append(tail_path)

    out_path = work_dir / "narration.wav"
    ffmpeg_utils.concat_wavs(timeline, out_path)
    return out_path
