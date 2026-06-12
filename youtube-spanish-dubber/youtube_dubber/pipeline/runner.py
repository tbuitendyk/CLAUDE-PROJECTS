"""Orchestrates a single dubbing job end to end.

Stage order: probe -> download -> transcript (existing/translated/whisper)
-> synthesize Spanish narration -> mux with video -> upload to YouTube.

Each stage reports its progress through `on_progress`, which the worker uses
to persist job status to the database so it's visible via the HTTP API.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from .. import memory, naming, progress
from ..config import settings
from . import (
    downloader,
    image_text,
    ocr_onnx,
    separate,
    thumbnail,
    transcript,
    translator,
    tts,
    uploader,
    video,
)
from .models import Segment

log = logging.getLogger(__name__)

# (stage, message, fraction=None) -- fraction is optional within-stage 0..1.
ProgressFn = Callable[..., None]


def _noop(stage: str, message: str, fraction: float | None = None) -> None:
    log.info("[%s] %s", stage, message)


def run(
    source_url: str,
    target_language: str,
    work_dir: Path,
    on_progress: ProgressFn = _noop,
    transcript_override: list[Segment] | None = None,
    thumbnail_override: Path | None = None,
    privacy: str | None = None,
    voice: str | None = None,
    cached_bed: Path | None = None,
) -> dict:
    """Run the full pipeline. Returns a result dict with at least
    `youtube_video_id` and `youtube_video_url` on success.

    `transcript_override`, when given, replaces the normal transcript
    acquisition stage outright -- it's how a "preview transcript first" pass
    that the user then hand-edited gets used verbatim for the actual dub,
    instead of the pipeline re-acquiring and re-translating from scratch (and
    potentially landing on different lines than the ones they reviewed).

    `privacy`/`voice` override the global upload-privacy and TTS-voice settings
    for this job. `cached_bed` is a previously separated music/SFX bed for this
    project: when it exists, the (slow, lossy-if-repeated) speech-separation
    stage is skipped outright and the bed is reused as-is."""

    on_progress("probing", "Looking up video metadata and available captions...")
    info = downloader.probe(source_url)

    on_progress("downloading", f"Downloading source video: {info.get('title')!r}")
    source = downloader.download_video(
        source_url, work_dir,
        on_progress=lambda f: on_progress("downloading", f"Downloading source video… {int(f * 100)}%", fraction=f),
    )

    # The thumbnail we'll set on the upload at the end. A `thumbnail_override`
    # is one the user already previewed/edited and approved (banner baked in),
    # so it's used verbatim -- otherwise we localise + brand the source
    # thumbnail now (local, best-effort: any failure just leaves YouTube's
    # auto-thumbnail).
    if thumbnail_override is not None:
        branded_thumbnail = thumbnail_override
    else:
        branded_thumbnail = _brand_thumbnail(source, target_language, work_dir, on_progress)

    if transcript_override is not None:
        on_progress("transcript", f"Using your edited transcript ({len(transcript_override)} lines)...")
        segments = transcript_override
        transcript_source = "edited transcript from preview"
        # An override carries only the (target-language) lines we'll narrate.
        transcript_rows = [
            {"start": s.start, "end": s.end, "original_text": None, "translated_text": s.text}
            for s in segments
        ]
    else:
        on_progress("transcript", "Acquiring a Spanish transcript...")
        # The transcript stage is long and largely silent (model load, VAD,
        # caption translation). A heartbeat eases the bar forward throughout so
        # it never freezes; real sub-progress signals re-anchor it (see
        # progress.StageHeartbeat). Seed it so the creep starts immediately,
        # before the first internal signal.
        with progress.StageHeartbeat(
            lambda message, fraction: on_progress("transcript", message, fraction=fraction)
        ) as heartbeat:
            heartbeat.report("Acquiring a Spanish transcript...", 0.0)
            result = transcript.obtain_spanish_segments(
                source_url, info, work_dir, target_language, Path(source.video_path),
                report=heartbeat.report,
            )
        # Heartbeat stopped: fill the band (fraction=1.0) so the bar lands at the
        # transcript band's end rather than snapping back to its start.
        on_progress("transcript", f"Transcript ready via: {result.source} ({len(result.segments)} lines)", fraction=1.0)
        segments = result.segments
        transcript_source = result.source
        # Keep both columns when a translation happened, so the library shows
        # source vs target; otherwise (already-target captions) just the target.
        if result.original_segments is not None:
            transcript_rows = [
                {"start": o.start, "end": o.end, "original_text": o.text, "translated_text": t.text}
                for o, t in zip(result.original_segments, result.segments)
            ]
        else:
            transcript_rows = [
                {"start": s.start, "end": s.end, "original_text": None, "translated_text": s.text}
                for s in result.segments
            ]

    tts_voice = voice or settings.tts_voice
    on_progress("synthesizing", f"Synthesizing Spanish narration with voice '{tts_voice}'...")
    narration_path = tts.synthesize_track(
        segments,
        total_duration=source.duration or _probe_duration_fallback(source.video_path),
        voice=tts_voice,
        rate=settings.tts_rate,
        work_dir=work_dir,
        on_line=lambda i, n: on_progress(
            "synthesizing", f"Synthesizing narration — line {i}/{n}…", fraction=(i / n if n else None)
        ),
    )

    # In "music" mode, first strip the original speech from the source audio so
    # the narration sits over a clean music+SFX bed (the heavy ML step). A
    # cached bed from this project's first dub skips that entirely -- separation
    # runs once per project, ever. It degrades gracefully: if separation is
    # unavailable or fails, bed_path is None and video.mux falls back to a
    # narration-only ("replace") mix.
    bed_path = None
    freshly_separated = False
    if settings.audio_mode == "music":
        if cached_bed is not None and cached_bed.exists():
            on_progress("separating", "Reusing this project's saved music & sound-effects bed…", fraction=1.0)
            bed_path = cached_bed
        else:
            # Free the transcript/TTS model singletons before the memory-heavy
            # separation so it doesn't stack on top of them and hit the cgroup memory
            # cap. They reload lazily if something later needs them (title translation).
            _release_heavy_models()
            # Separation runs for minutes with long silent gaps (decoding the whole
            # track, loading the model) before the first chunk reports -- so drive it
            # through a heartbeat (like the transcript stage) to keep the bar moving,
            # with the real per-chunk fraction re-anchoring it.
            with progress.StageHeartbeat(
                lambda message, fraction: on_progress("separating", message, fraction=fraction)
            ) as heartbeat:
                heartbeat.report("Removing the original speech (keeping music & sound effects)…", 0.0)
                bed_path = separate.instrumental_bed(
                    Path(source.video_path), work_dir,
                    on_progress=lambda f: heartbeat.report(
                        f"Removing the original speech… {int(f * 100)}%", f
                    ),
                )
            freshly_separated = bed_path is not None
            on_progress("separating", "Original speech removed; mixing the bed…", fraction=1.0)
            memory.release_to_os()  # free the separation model + audio buffers

    on_progress("muxing", f"Combining narration with the source video (mode={settings.audio_mode})...")
    dubbed_path = work_dir / "dubbed.mp4"
    bed_volume = settings.music_bed_volume if settings.audio_mode == "music" else settings.duck_original_volume
    video.mux(
        Path(source.video_path), narration_path, dubbed_path,
        mode=settings.audio_mode, duck_volume=bed_volume, bed_path=bed_path,
    )

    on_progress("uploading", "Uploading the dubbed video to your YouTube channel...")
    source_lang = source.original_language or "en"
    # Scrub any tag a previous dub already added before translating/composing,
    # so a title can never come out double-tagged ("[Versión Español] [Versión
    # Español] ..."), no matter what the source video was.
    source_title = naming.strip_title_tag(source.title, settings.title_prefix)
    translated_title = translator.translate_text(source_title, from_code=source_lang, to_code=target_language)
    title = naming.compose_title(translated_title, source_title, settings.title_prefix)
    translated_description = (
        translator.translate_text(source.description, from_code=source_lang, to_code=target_language)
        if source.description else ""
    )
    description = f"{translated_description}{settings.description_suffix}".strip()
    video_id = uploader.upload_video(
        dubbed_path, title=title, description=description,
        privacy_status=privacy,
        on_progress=lambda f: on_progress("uploading", f"Uploading to YouTube… {int(f * 100)}%", fraction=f),
    )

    if branded_thumbnail is not None:
        on_progress("uploading", "Applying the branded thumbnail...")
        uploader.set_thumbnail(video_id, branded_thumbnail)

    video_url = f"https://youtu.be/{video_id}"
    on_progress("done", f"Published: {video_url}")

    return {
        "youtube_video_id": video_id,
        "youtube_video_url": video_url,
        "transcript_source": transcript_source,
        "title": title,
        "source_title": source.title,
        "source_video_id": source.id,
        "voice": tts_voice,
        "transcript": transcript_rows,
        # A freshly separated bed lives in the (about-to-be-deleted) work dir;
        # the worker encodes it into the project's cache before cleanup.
        "bed_source_path": str(bed_path) if freshly_separated else None,
    }


def preview_transcript(source_url: str, target_language: str, work_dir: Path, on_progress: ProgressFn = _noop) -> dict:
    """Run only the transcript-acquisition stages (probe, download, transcript
    + translation) and return the original-language and Spanish text side by
    side, line by line -- skipping narration synthesis, muxing and uploading.

    This lets you check whether a poor dub would be due to bad transcription
    or bad translation before spending the time on a full (much slower) run.
    """

    on_progress("probing", "Looking up video metadata and available captions...")
    info = downloader.probe(source_url)

    on_progress("downloading", f"Downloading source video: {info.get('title')!r}")
    source = downloader.download_video(
        source_url, work_dir,
        on_progress=lambda f: on_progress("downloading", f"Downloading source video… {int(f * 100)}%", fraction=f),
    )

    on_progress("transcript", "Acquiring a transcript and translating it to Spanish...")
    with progress.StageHeartbeat(
        lambda message, fraction: on_progress("transcript", message, fraction=fraction)
    ) as heartbeat:
        heartbeat.report("Acquiring a transcript and translating it to Spanish...", 0.0)
        result = transcript.obtain_spanish_segments(
            source_url, info, work_dir, target_language, Path(source.video_path),
            report=heartbeat.report,
        )

    if result.original_segments is not None:
        rows = [
            {
                "start": orig.start,
                "end": orig.end,
                "original_text": orig.text,
                "translated_text": trans.text,
            }
            for orig, trans in zip(result.original_segments, result.segments)
        ]
    else:
        # The transcript was already in Spanish (existing Spanish captions) --
        # nothing was translated, so there's only one column to show.
        rows = [
            {"start": seg.start, "end": seg.end, "original_text": None, "translated_text": seg.text}
            for seg in result.segments
        ]

    on_progress("done", f"Transcript preview ready via: {result.source} ({len(rows)} lines)")

    return {
        "title": source.title,
        "source_video_id": source.id,
        "transcript_source": result.source,
        "original_language": result.original_language,
        "rows": rows,
    }


def _brand_thumbnail(source, target_language: str, work_dir: Path, on_progress: ProgressFn):
    """Produce the dub's thumbnail: translate any text baked into the source
    thumbnail in place, then overlay the Spanish banner on top of that ("keep
    both"). Returns the finished image path, or None if disabled / unavailable.

    Fully defensive at every step -- a thumbnail is a nice-to-have, never a
    reason to fail (or even noisily warn within) the dub. Each step degrades on
    its own: if OCR localisation isn't possible we still brand the original; if
    branding isn't possible we still return the localised image."""
    if not settings.thumbnail_enabled or not source.thumbnail_path:
        return None
    original = Path(source.thumbnail_path)
    localized: Path | None = None
    try:
        # fraction=1.0 keeps the bar parked at the download band's end (the
        # download just finished there); without it this would reset to the
        # band start and visibly jump the bar backward before the transcript.
        if settings.thumbnail_translate_text_enabled:
            on_progress("downloading", "Translating text in the thumbnail...", fraction=1.0)
            localized = image_text.localize_image_file(
                original,
                work_dir / "thumbnail_localized.jpg",
                from_code=(source.original_language or "en"),
                to_code=target_language,
                min_confidence=settings.thumbnail_ocr_min_confidence,
            )

        on_progress("downloading", "Branding the thumbnail with the Spanish banner...", fraction=1.0)
        branded = thumbnail.brand_thumbnail(
            localized or original,
            work_dir / "thumbnail_es.jpg",
            text=settings.thumbnail_banner_text,
            font=settings.thumbnail_font,
        )
        # If the banner couldn't render but we did translate the text, the
        # localised image is still an improvement worth keeping.
        return branded or localized
    except Exception as exc:  # noqa: BLE001 -- best effort
        log.warning("Thumbnail branding skipped (%s)", exc)
        return localized
    finally:
        # The OCR model is only used here, once per job, and is heavy enough
        # that it shouldn't linger through transcription/TTS. Release it now
        # (per-stage), mirroring how transcript.py frees its models between
        # stages so a dub's resident memory doesn't stack.
        ocr_onnx.release_model()
        memory.release_to_os()


def _release_heavy_models() -> None:
    """Drop the transcript/TTS model singletons (Whisper, Argos, spaCy, the ONNX
    sessions) before the memory-heavy separation step so it doesn't stack on top
    of them and hit the service's memory cap. Best-effort; each reloads lazily if
    needed afterward."""
    from importlib import import_module

    for module_name, fn_name in (
        ("speech_to_text", "release_model"),
        ("punctuation_onnx", "release_model"),
        ("rechunker", "release_models"),
        ("translator", "clear_cache"),
    ):
        try:
            getattr(import_module(f".{module_name}", __package__), fn_name)()
        except Exception:  # noqa: BLE001 -- best effort
            pass
    memory.release_to_os()


def _probe_duration_fallback(video_path: str) -> float:
    from . import ffmpeg_utils
    return ffmpeg_utils.probe_duration(Path(video_path))
