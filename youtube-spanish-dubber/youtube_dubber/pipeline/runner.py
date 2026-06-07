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

from ..config import settings
from . import downloader, transcript, translator, tts, uploader, video

log = logging.getLogger(__name__)

ProgressFn = Callable[[str, str], None]


def _noop(stage: str, message: str) -> None:
    log.info("[%s] %s", stage, message)


def run(source_url: str, target_language: str, work_dir: Path, on_progress: ProgressFn = _noop) -> dict:
    """Run the full pipeline. Returns a result dict with at least
    `youtube_video_id` and `youtube_video_url` on success."""

    on_progress("probing", "Looking up video metadata and available captions...")
    info = downloader.probe(source_url)

    on_progress("downloading", f"Downloading source video: {info.get('title')!r}")
    source = downloader.download_video(source_url, work_dir)

    on_progress("transcript", "Acquiring a Spanish transcript...")
    result = transcript.obtain_spanish_segments(
        source_url, info, work_dir, target_language, Path(source.video_path)
    )
    on_progress("transcript", f"Transcript ready via: {result.source} ({len(result.segments)} lines)")

    on_progress("synthesizing", f"Synthesizing Spanish narration with voice '{settings.tts_voice}'...")
    narration_path = tts.synthesize_track(
        result.segments,
        total_duration=source.duration or _probe_duration_fallback(source.video_path),
        voice=settings.tts_voice,
        rate=settings.tts_rate,
        work_dir=work_dir,
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
    title = f"{settings.title_prefix}{translated_title} ({source.title})"[:100]
    translated_description = (
        translator.translate_text(source.description, from_code=source_lang, to_code=target_language)
        if source.description else ""
    )
    description = f"{translated_description}{settings.description_suffix}".strip()
    video_id = uploader.upload_video(dubbed_path, title=title, description=description)

    video_url = f"https://youtu.be/{video_id}"
    on_progress("done", f"Published: {video_url}")

    return {
        "youtube_video_id": video_id,
        "youtube_video_url": video_url,
        "transcript_source": result.source,
        "title": title,
    }


def _probe_duration_fallback(video_path: str) -> float:
    from . import ffmpeg_utils
    return ffmpeg_utils.probe_duration(Path(video_path))
