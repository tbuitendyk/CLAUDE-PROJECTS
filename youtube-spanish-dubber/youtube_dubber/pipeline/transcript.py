"""Acquire a Spanish transcript for a video, trying the cheapest options first.

Order of preference (cheapest / highest-fidelity first):
  1. An existing manually-created Spanish caption track.
  2. An existing auto-generated Spanish caption track.
  3. Any existing caption track (manual, then auto-generated) in another
     language, machine-translated to Spanish.
  4. As a last resort: transcribe the audio from scratch with a local
     Whisper model, then machine-translate that transcript to Spanish.

Returns both the resulting Spanish segments and a human-readable description
of which path was used (surfaced in job progress for transparency).
"""
from __future__ import annotations

import logging
from pathlib import Path

from . import downloader, subtitles, translator
from .models import Segment

log = logging.getLogger(__name__)


class TranscriptResult:
    def __init__(self, segments: list[Segment], source: str):
        self.segments = segments
        self.source = source


def _read_vtt(path: Path) -> list[Segment]:
    return subtitles.parse_cues(path.read_text(encoding="utf-8", errors="ignore"))


def obtain_spanish_segments(url: str, info: dict, work_dir: Path, target_language: str) -> TranscriptResult:
    from ..config import settings

    es_codes = settings.spanish_caption_codes

    # 1. Manual Spanish captions.
    code = downloader.available_caption_language(info, es_codes, auto=False)
    if code:
        path = downloader.download_caption(url, code, work_dir, auto=False)
        if path:
            return TranscriptResult(_read_vtt(path), f"existing manual Spanish captions ({code})")

    # 2. Auto-generated Spanish captions.
    code = downloader.available_caption_language(info, es_codes, auto=True)
    if code:
        path = downloader.download_caption(url, code, work_dir, auto=True)
        if path:
            return TranscriptResult(_read_vtt(path), f"existing auto-generated Spanish captions ({code})")

    # 3. Any other-language caption track, then translate.
    for auto in (False, True):
        code = downloader.any_caption_language(info, auto=auto)
        if not code:
            continue
        path = downloader.download_caption(url, code, work_dir, auto=auto)
        if not path:
            continue
        segments = _read_vtt(path)
        if not segments:
            continue
        kind = "auto-generated" if auto else "manual"
        translated = translator.translate_segments(segments, from_code=code, to_code=target_language)
        return TranscriptResult(
            translated, f"translated from {kind} {code} captions to {target_language}"
        )

    # 4. Nothing usable exists -- transcribe the audio ourselves with Whisper.
    from . import speech_to_text  # imported lazily: heavy (loads ML model)

    audio_path = downloader.download_audio(url, work_dir)
    stt_segments, detected_language = speech_to_text.transcribe(audio_path)
    translated = translator.translate_segments(
        stt_segments, from_code=detected_language, to_code=target_language
    )
    return TranscriptResult(
        translated,
        f"freshly transcribed with Whisper ({detected_language}) and translated to {target_language}",
    )
