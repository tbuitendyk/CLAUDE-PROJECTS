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

from .. import progress
from ..config import settings
from . import downloader, thumbnail, transcript, translator, tts, uploader, video
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
) -> dict:
    """Run the full pipeline. Returns a result dict with at least
    `youtube_video_id` and `youtube_video_url` on success.

    `transcript_override`, when given, replaces the normal transcript
    acquisition stage outright -- it's how a "preview transcript first" pass
    that the user then hand-edited gets used verbatim for the actual dub,
    instead of the pipeline re-acquiring and re-translating from scratch (and
    potentially landing on different lines than the ones they reviewed).
    """

    on_progress("probing", "Looking up video metadata and available captions...")
    info = downloader.probe(source_url)

    on_progress("downloading", f"Downloading source video: {info.get('title')!r}")
    source = downloader.download_video(
        source_url, work_dir,
        on_progress=lambda f: on_progress("downloading", f"Downloading source video… {int(f * 100)}%", fraction=f),
    )

    # Brand the original thumbnail now (cheap, local); we set it on the upload
    # at the end. Best-effort: any failure just leaves YouTube's auto-thumbnail.
    branded_thumbnail = _brand_thumbnail(source, work_dir, on_progress)

    if transcript_override is not None:
        on_progress("transcript", f"Using your edited transcript ({len(transcript_override)} lines)...")
        segments = transcript_override
        transcript_source = "edited transcript from preview"
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

    on_progress("synthesizing", f"Synthesizing Spanish narration with voice '{settings.tts_voice}'...")
    narration_path = tts.synthesize_track(
        segments,
        total_duration=source.duration or _probe_duration_fallback(source.video_path),
        voice=settings.tts_voice,
        rate=settings.tts_rate,
        work_dir=work_dir,
        on_line=lambda i, n: on_progress(
            "synthesizing", f"Synthesizing narration — line {i}/{n}…", fraction=(i / n if n else None)
        ),
    )

    on_progress("muxing", f"Combining narration with the source video (mode={settings.audio_mode})...")
    dubbed_path = work_dir / "dubbed.mp4"
    video.mux(
        Path(source.video_path), narration_path, dubbed_path,
        mode=settings.audio_mode, duck_volume=settings.duck_original_volume,
    )

    on_progress("uploading", "Uploading the dubbed video to your YouTube channel...")
    source_lang = source.original_language or "en"
    translated_title = translator.translate_text(source.title, from_code=source_lang, to_code=target_language)
    title = f"{settings.title_prefix.rstrip()} {translated_title} ({source.title})"[:100]
    translated_description = (
        translator.translate_text(source.description, from_code=source_lang, to_code=target_language)
        if source.description else ""
    )
    description = f"{translated_description}{settings.description_suffix}".strip()
    video_id = uploader.upload_video(
        dubbed_path, title=title, description=description,
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
        "transcript_source": result.source,
        "original_language": result.original_language,
        "rows": rows,
    }


def _brand_thumbnail(source, work_dir: Path, on_progress: ProgressFn):
    """Produce a branded copy of the source thumbnail, or None if disabled /
    unavailable. Fully defensive -- a thumbnail is a nice-to-have, never a
    reason to fail (or even noisily warn within) the dub."""
    if not settings.thumbnail_enabled or not source.thumbnail_path:
        return None
    try:
        # fraction=1.0 keeps the bar parked at the download band's end (the
        # download just finished there); without it this would reset to the
        # band start and visibly jump the bar backward before the transcript.
        on_progress("downloading", "Branding the thumbnail with the Spanish banner...", fraction=1.0)
        return thumbnail.brand_thumbnail(
            Path(source.thumbnail_path),
            work_dir / "thumbnail_es.jpg",
            text=settings.thumbnail_banner_text,
            font=settings.thumbnail_font,
        )
    except Exception as exc:  # noqa: BLE001 -- best effort
        log.warning("Thumbnail branding skipped (%s)", exc)
        return None


def _probe_duration_fallback(video_path: str) -> float:
    from . import ffmpeg_utils
    return ffmpeg_utils.probe_duration(Path(video_path))
