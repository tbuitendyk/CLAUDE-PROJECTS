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

    `on_progress`, if given, is called with the fraction of audio transcribed
    so far (0..1) as faster-whisper yields segments -- this is the longest part
    of the transcript stage, so it drives the progress bar through it.
    """
    model = _get_model()
    with _lock:  # CTranslate2 models are not safe for concurrent inference
        segments_iter, info = model.transcribe(
            str(audio_path),
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
        total = float(getattr(info, "duration", 0.0) or 0.0)
        segments: list[Segment] = []
        words: list[TimedWord] = []
        for seg in segments_iter:
            # faster-whisper decodes lazily: a segment is produced only as this
            # loop advances, so reporting here tracks real transcription progress.
            if on_progress is not None and total > 0:
                try:
                    on_progress(min(0.99, seg.end / total))
                except Exception:  # noqa: BLE001 -- progress is best-effort
                    pass
            if not seg.text.strip():
                continue
            segments.append(Segment(start=seg.start, end=seg.end, text=seg.text.strip()))
            for w in (seg.words or []):
                token = w.word.strip()
                if token:
                    words.append(TimedWord(start=w.start, end=w.end, text=token))
    log.info(
        "Whisper transcribed %d segments (%d timed words), detected language=%s (p=%.2f)",
        len(segments), len(words), info.language, info.language_probability,
    )
    return segments, info.language, words
