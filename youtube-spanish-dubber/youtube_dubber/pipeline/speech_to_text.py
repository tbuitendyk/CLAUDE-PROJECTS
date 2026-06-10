"""Local speech-to-text fallback using faster-whisper.

Used only when a video has no usable captions in any language. faster-whisper
is a free, open-source (MIT) re-implementation of OpenAI's Whisper that runs
entirely on the VPS's CPU -- no API key, no per-minute billing, no audio ever
leaves the machine.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path

from faster_whisper import WhisperModel

from .. import memory
from . import ffmpeg_utils
from .models import Segment
from .rechunker import TimedWord

log = logging.getLogger(__name__)

_lock = threading.Lock()
_model: WhisperModel | None = None


def _get_model() -> WhisperModel:
    global _model
    if _model is None:
        from ..config import settings
        log.info("Loading Whisper model '%s' (this happens once per process)...", settings.whisper_model_size)
        _model = WhisperModel(
            settings.whisper_model_size,
            device=settings.whisper_device,
            compute_type=settings.whisper_compute_type,
        )
    return _model


def release_model() -> None:
    """Drop the cached Whisper model so its native memory (hundreds of MB) and
    CTranslate2 thread pool are freed when the worker goes idle. It reloads
    lazily on the next transcription."""
    global _model
    with _lock:
        _model = None


def _run_inference(
    audio_path: Path,
    language: "str | None" = None,
    on_position: "Callable[[float], None] | None" = None,
) -> tuple[list[Segment], list[TimedWord], str, float]:
    """Transcribe one audio file in a single pass, timestamps relative to that
    file's own start. Returns (segments, words, language, language_probability).
    `on_position`, if given, is called with the audio position in *seconds*
    reached so far. `language`, when set, pins decoding to that language (skips
    per-file auto-detection -- used so every window of one video agrees)."""
    model = _get_model()
    with _lock:  # CTranslate2 models are not safe for concurrent inference
        segments_iter, info = model.transcribe(
            str(audio_path),
            language=language,
            vad_filter=True,
            # faster-whisper can spiral into repeating the same phrase over and
            # over once it stumbles on one -- condition_on_previous_text=True
            # (the default) feeds that bad output back in as context for the
            # next chunk, compounding it. Disabling that, plus penalizing
            # repeated tokens/n-grams directly, keeps it from looping.
            condition_on_previous_text=False,
            repetition_penalty=1.1,
            no_repeat_ngram_size=3,
            # Nudge the decoder toward properly punctuated, capitalised output
            # by seeding it with a clean example. (We keep
            # condition_on_previous_text=False above to avoid the repetition
            # spiral, which limits this prompt's reach to the opening window --
            # the rechunker's own punctuation restoration carries the rest.)
            initial_prompt="The following is a clear, well-punctuated transcript with proper capitalization.",
            # Per-word timestamps feed the rechunker's thought-boundary cutting.
            word_timestamps=True,
        )
        segments: list[Segment] = []
        words: list[TimedWord] = []
        for seg in segments_iter:
            # faster-whisper decodes lazily: a segment is produced only as this
            # loop advances, so reporting here tracks real transcription progress.
            if on_position is not None:
                try:
                    on_position(seg.end)
                except Exception:  # noqa: BLE001 -- progress is best-effort
                    pass
            if not seg.text.strip():
                continue
            segments.append(Segment(start=seg.start, end=seg.end, text=seg.text.strip()))
            for w in (seg.words or []):
                token = w.word.strip()
                if token:
                    words.append(TimedWord(start=w.start, end=w.end, text=token))
    return segments, words, info.language, info.language_probability


def transcribe(
    audio_path: Path, on_progress: "Callable[[float], None] | None" = None
) -> tuple[list[Segment], str, list[TimedWord]]:
    """Transcribe an audio file in its original language.

    Returns (segments, detected_language_code, words). `words` is a flat
    per-word stream with individual timestamps -- the rechunker uses these to
    place chunk breaks at the exact word where a thought ends (and to read the
    real pauses *between words*, far finer than cue-level gaps, when inferring
    punctuation). It's empty if word timing wasn't produced, in which case the
    rechunker interpolates timing from the segments instead.

    Long audio is transcribed in time-windows (see config.whisper_chunk_seconds):
    faster-whisper decodes the *entire* file into RAM up front, so a multi-hour
    video's waveform alone can exceed the memory budget. Each window is extracted
    to a temp file and its decoded audio released before the next, so the
    resident set stays bounded regardless of length; window timestamps are offset
    back onto the full-audio timeline. Audio shorter than one window takes the
    original single-pass path unchanged.

    `on_progress`, if given, is called with the fraction of audio transcribed so
    far (0..1) as segments are yielded -- this is the longest part of the
    transcript stage, so it drives the progress bar through it.
    """
    from ..config import settings

    total = ffmpeg_utils.probe_duration(audio_path)
    plan = ffmpeg_utils.audio_window_plan(total, settings.whisper_chunk_seconds)

    # Single window (short audio, or windowing disabled): transcribe in place.
    if len(plan) <= 1:
        report = (lambda pos: on_progress(min(0.99, pos / total))) if (on_progress and total > 0) else None
        segments, words, language, prob = _run_inference(audio_path, on_position=report)
        log.info(
            "Whisper transcribed %d segments (%d timed words), detected language=%s (p=%.2f)",
            len(segments), len(words), language, prob,
        )
        return segments, language, words

    # Long audio: one window at a time, freeing each window's decoded audio
    # before the next so the resident waveform never exceeds one window's worth.
    log.info(
        "Audio is %.0fs; transcribing in %d windows of <=%ds to bound memory.",
        total, len(plan), settings.whisper_chunk_seconds,
    )
    all_segments: list[Segment] = []
    all_words: list[TimedWord] = []
    language: "str | None" = None
    work_dir = audio_path.parent
    for idx, (start, dur) in enumerate(plan):
        window = work_dir / f"_whisper_win_{idx:03d}.wav"
        ffmpeg_utils.extract_audio_window(audio_path, window, start, dur)
        report = (lambda pos, s=start: on_progress(min(0.99, (s + pos) / total))) if on_progress else None
        try:
            # Pin the language detected on the first window for the rest, so a
            # window of music/silence can't flip mid-video.
            segments, words, lang, prob = _run_inference(window, language=language, on_position=report)
        finally:
            window.unlink(missing_ok=True)
            memory.release_to_os()  # free this window's decoded audio before the next
        if language is None:
            language = lang
            log.info("Whisper detected language=%s (p=%.2f) on window 0.", lang, prob)
        # Offset window-relative timestamps back onto the full-audio timeline.
        all_segments.extend(Segment(start=s.start + start, end=s.end + start, text=s.text) for s in segments)
        all_words.extend(TimedWord(start=w.start + start, end=w.end + start, text=w.text) for w in words)

    log.info(
        "Whisper transcribed %d segments (%d timed words) over %d windows; language=%s",
        len(all_segments), len(all_words), len(plan), language,
    )
    return all_segments, language or "en", all_words
