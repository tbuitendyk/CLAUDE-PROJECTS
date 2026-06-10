"""Acquire a Spanish transcript for a video.

Order of preference (highest-fidelity first):
  1. An existing manually-created Spanish caption track.
  2. Transcribe the audio with a local Whisper model, then translate to
     Spanish.  Whisper produces properly punctuated, capitalised output
     natively -- vastly cleaner input for the rechunker than YouTube's
     auto-generated captions, which arrive as an unpunctuated lowercase
     stream and defeat the punctuation-aware boundary detection.
  3. An existing auto-generated Spanish caption track (fallback if Whisper
     fails for any reason -- lower quality but no local compute needed).
  4. Any existing caption track in another language, machine-translated to
     Spanish (last resort).

Returns both the resulting Spanish segments and a human-readable description
of which path was used (surfaced in job progress for transparency).
"""
from __future__ import annotations

import logging
from pathlib import Path

from .. import memory
from . import downloader, ffmpeg_utils, rechunker, subtitles, translator
from .models import Segment

log = logging.getLogger(__name__)


def _release_rechunk_models() -> None:
    """Free the rechunk stage's models -- the ONNX punctuation session and the
    spaCy NLP models -- and return their memory to the OS. Called once a rechunk
    is done so they don't stay resident (stacking with the translation model)
    through the rest of the stage. They reload lazily if needed again."""
    from . import punctuation_onnx  # lazy: avoids importing onnxruntime eagerly

    punctuation_onnx.release_model()
    rechunker.release_models()
    memory.release_to_os()

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
    url: str, info: dict, work_dir: Path, target_language: str, video_path: Path,
    report: "Callable[[str, float], None] | None" = None,
) -> TranscriptResult:
    """`report`, if given, is called as (message, fraction) to surface fine
    progress *within* the transcript stage (0..1) -- chiefly the Whisper
    transcription, which is the slow part when a video has no usable captions."""
    from ..config import settings

    _report = report or (lambda message, fraction: None)
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

    # 2. Whisper transcription -- preferred over auto-generated captions because
    # it produces punctuated, capitalised output natively (the rechunker's
    # punctuation-aware boundary detection then works on real sentences instead
    # of fighting a lowercase unpunctuated stream). Extract audio from the video
    # we already downloaded so no extra YouTube request is needed.
    from . import speech_to_text  # imported lazily: heavy (loads ML model)

    try:
        audio_path = work_dir / "audio.wav"
        ffmpeg_utils.to_standard_wav(video_path, audio_path)
        # Whisper drives the first ~90% of the transcript stage; translation the
        # rest. (seg fraction is audio-position from speech_to_text.transcribe.)
        stt_segments, detected_language, stt_words = speech_to_text.transcribe(
            audio_path,
            on_progress=lambda f: _report(f"Transcribing audio with Whisper… {int(f * 100)}%", min(0.9, f * 0.9)),
        )
        # Transcription is the stage's memory peak: the Whisper model plus the
        # fully-decoded audio waveform. Neither is needed past this point, so
        # drop them now -- before the punctuation/spaCy/translation models load --
        # so they don't stack on top and push the job's resident set past the
        # cgroup throttle line. Whisper reloads lazily on the next job.
        speech_to_text.release_model()
        memory.release_to_os()

        stt_segments = rechunker.chunk(stt_segments, language=detected_language, words=stt_words)
        _release_rechunk_models()  # free punctuation + spaCy before translating
        # Whisper drove 0..0.9 of the stage; translation drives the final
        # 0.9..0.99 (the band's end is filled by the caller once it's all done).
        _report(f"Translating {len(stt_segments)} lines to {target_language}…", 0.9)
        translated = translator.translate_segments(
            stt_segments, from_code=detected_language, to_code=target_language,
            on_progress=lambda done, total: _report(
                f"Translating to {target_language}… line {done}/{total}",
                0.9 + 0.09 * (done / total if total else 1.0),
            ),
        )
        return TranscriptResult(
            translated,
            f"freshly transcribed with Whisper ({detected_language}) and translated to {target_language}",
            original_segments=stt_segments, original_language=detected_language,
        )
    except Exception as exc:
        log.warning("Whisper transcription failed (%s); falling back to caption tracks.", exc)
        # Whisper may have loaded before failing; free it so it doesn't sit
        # resident through the caption-based fallback paths below.
        speech_to_text.release_model()
        memory.release_to_os()

    # 3. Auto-generated Spanish captions (fallback: no local compute, but arrives
    # as an unpunctuated lowercase stream that limits rechunker quality).
    code = downloader.available_caption_language(info, es_codes, auto=True)
    if code:
        path = downloader.download_caption(url, code, work_dir, auto=True)
        if path:
            return TranscriptResult(
                rechunker.chunk(_read_vtt(path), language=code),
                f"existing auto-generated Spanish captions ({code})", original_language=code
            )

    # 4. Any other-language caption track, then translate.
    for auto in (False, True):
        code = downloader.any_caption_language(info, auto=auto)
        if not code:
            continue
        path = downloader.download_caption(url, code, work_dir, auto=auto)
        if not path:
            continue
        # Rechunk in the *source* language before translating, so chunk breaks
        # fall at the source's thought boundaries and the translator sees whole
        # thoughts (far better Spanish from a complete clause than a fragment).
        segments = rechunker.chunk(_read_vtt(path), language=code)
        if not segments:
            continue
        _release_rechunk_models()  # free punctuation + spaCy before translating
        kind = "auto-generated" if auto else "manual"
        # No Whisper here, so translation is the whole slow part of the stage:
        # drive most of the band (0.05..0.99) off its line count.
        translated = translator.translate_segments(
            segments, from_code=code, to_code=target_language,
            on_progress=lambda done, total: _report(
                f"Translating {kind} {code} captions to {target_language}… line {done}/{total}",
                0.05 + 0.94 * (done / total if total else 1.0),
            ),
        )
        return TranscriptResult(
            translated, f"translated from {kind} {code} captions to {target_language}",
            original_segments=segments, original_language=code,
        )

    raise RuntimeError(
        "No transcript source available: Whisper failed and no usable caption tracks were found."
    )
