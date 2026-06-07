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


def transcribe(audio_path: Path) -> tuple[list[Segment], str]:
    """Transcribe an audio file in its original language.

    Returns (segments, detected_language_code).
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
        )
        segments = [
            Segment(start=seg.start, end=seg.end, text=seg.text.strip())
            for seg in segments_iter
            if seg.text.strip()
        ]
    log.info(
        "Whisper transcribed %d segments, detected language=%s (p=%.2f)",
        len(segments), info.language, info.language_probability,
    )
    return segments, info.language
