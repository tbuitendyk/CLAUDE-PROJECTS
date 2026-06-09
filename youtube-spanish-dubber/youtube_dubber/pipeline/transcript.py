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

from . import downloader, ffmpeg_utils, rechunker, subtitles, translator
from .models import Segment

log = logging.getLogger(__name__)

# Caption cues and raw Whisper utterances arrive as short, often sentence-
# fragmenting phrases. Rechunking them into natural "thought units" (whole
# sentences/clauses) before translation and synthesis is what keeps the
# narration from sounding like a string of disconnected, rushed bursts -- and
# what keeps the translator from mangling fragments. All of that logic
# (punctuation restoration, spaCy boundary detection, duration-windowed
# assembly) lives in the rechunker module; see rechunker.chunk().


class TranscriptResult:
    """The final Spanish segments plus, where translation happened, the
    original-language segments and language code they were translated from --
    so a diagnostic view can show both sides and reveal whether quality issues
    come from transcription or from translation.

    `original_segments`/`original_language` are None when the Spanish text
    came directly from an existing Spanish caption track (nothing was
    translated, so there is nothing to compare it against).
    """

    def __init__(
        self,
        segments: list[Segment],
        source: str,
        original_segments: list[Segment] | None = None,
        original_language: str | None = None,
    ):
        self.segments = segments
        self.source = source
        self.original_segments = original_segments
        self.original_language = original_language


def _read_vtt(path: Path) -> list[Segment]:
    return subtitles.parse_cues(path.read_text(encoding="utf-8", errors="ignore"))


def obtain_spanish_segments(
    url: str, info: dict, work_dir: Path, target_language: str, video_path: Path
) -> TranscriptResult:
    from ..config import settings

    es_codes = settings.spanish_caption_codes

    # 1. Manual Spanish captions.
    code = downloader.available_caption_language(info, es_codes, auto=False)
    if code:
        path = downloader.download_caption(url, code, work_dir, auto=False)
        if path:
            return TranscriptResult(
                rechunker.chunk(_read_vtt(path), language=code),
                f"existing manual Spanish captions ({code})", original_language=code
            )

    # 2. Auto-generated Spanish captions.
    code = downloader.available_caption_language(info, es_codes, auto=True)
    if code:
        path = downloader.download_caption(url, code, work_dir, auto=True)
        if path:
            return TranscriptResult(
                rechunker.chunk(_read_vtt(path), language=code),
                f"existing auto-generated Spanish captions ({code})", original_language=code
            )

    # 3. Any other-language caption track, then translate.
    for auto in (False, True):
        code = downloader.any_caption_language(info, auto=auto)
        if not code:
            continue
        path = downloader.download_caption(url, code, work_dir, auto=auto)
        if not path:
            continue
        # Rechunk in the *source* language before translating, so chunk breaks
        # fall at the source's thought boundaries and the translator sees whole
        # thoughts (it produces far better Spanish from a complete clause than
        # from a fragment sliced mid-sentence).
        segments = rechunker.chunk(_read_vtt(path), language=code)
        if not segments:
            continue
        kind = "auto-generated" if auto else "manual"
        translated = translator.translate_segments(segments, from_code=code, to_code=target_language)
        return TranscriptResult(
            translated, f"translated from {kind} {code} captions to {target_language}",
            original_segments=segments, original_language=code,
        )

    # 4. Nothing usable exists -- transcribe the audio ourselves with Whisper.
    # Extract the audio from the video we already downloaded rather than asking
    # YouTube for it again -- this fallback then needs no further YouTube
    # requests at all, so it isn't affected by the rate limits / network errors
    # that may be why we ended up here in the first place.
    from . import speech_to_text  # imported lazily: heavy (loads ML model)

    audio_path = work_dir / "audio.wav"
    ffmpeg_utils.to_standard_wav(video_path, audio_path)
    stt_segments, detected_language, stt_words = speech_to_text.transcribe(audio_path)
    stt_segments = rechunker.chunk(stt_segments, language=detected_language, words=stt_words)
    translated = translator.translate_segments(
        stt_segments, from_code=detected_language, to_code=target_language
    )
    return TranscriptResult(
        translated,
        f"freshly transcribed with Whisper ({detected_language}) and translated to {target_language}",
        original_segments=stt_segments, original_language=detected_language,
    )
