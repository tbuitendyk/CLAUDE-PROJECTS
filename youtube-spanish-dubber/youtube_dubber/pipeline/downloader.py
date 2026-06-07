"""yt-dlp based downloading of source video, audio and captions.

yt-dlp is free/open-source and is the most reliable way to pull a video,
its audio track and any available (manual or auto-generated) captions for
a given language directly from YouTube.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import yt_dlp

from .models import VideoInfo

log = logging.getLogger(__name__)


def probe(url: str) -> dict:
    """Return yt-dlp's info dict without downloading anything."""
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)


def available_caption_language(info: dict, codes: tuple[str, ...], auto: bool) -> Optional[str]:
    """Return the first caption code (from `codes`, in priority order) that the
    video actually has, looking at either manual ("subtitles") or
    auto-generated ("automatic_captions") tracks."""
    bucket = info.get("automatic_captions" if auto else "subtitles") or {}
    for code in codes:
        if code in bucket and bucket[code]:
            return code
    # Fall back to a prefix match, e.g. requested "es" but video only lists "es-419".
    for code in codes:
        prefix = code.split("-")[0]
        for available in bucket:
            if available.split("-")[0] == prefix and bucket[available]:
                return available
    return None


def any_caption_language(info: dict, auto: bool) -> Optional[str]:
    bucket = info.get("automatic_captions" if auto else "subtitles") or {}
    # Prefer the original spoken language if yt-dlp identified one.
    original = info.get("language")
    if original and original in bucket and bucket[original]:
        return original
    for code in bucket:
        if bucket[code]:
            return code
    return None


def download_video(url: str, work_dir: Path) -> VideoInfo:
    """Download the best available muxed (or mux-able) video+audio as MP4."""
    out_template = str(work_dir / "source.%(ext)s")
    opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b[ext=mp4]/best",
        "outtmpl": out_template,
        "merge_output_format": "mp4",
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        path = Path(ydl.prepare_filename(info))
        if not path.exists():
            path = path.with_suffix(".mp4")

    return VideoInfo(
        id=info["id"],
        title=info.get("title") or info["id"],
        description=info.get("description") or "",
        duration=float(info.get("duration") or 0.0),
        original_language=info.get("language"),
        video_path=str(path),
    )


def download_caption(url: str, lang: str, work_dir: Path, auto: bool) -> Optional[Path]:
    """Download a single caption track as VTT. Returns the file path, or None."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "writesubtitles": not auto,
        "writeautomaticsub": auto,
        "subtitleslangs": [lang],
        "subtitlesformat": "vtt",
        "outtmpl": str(work_dir / "captions.%(ext)s"),
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    for candidate in work_dir.glob("captions*.vtt"):
        return candidate
    return None


def download_audio(url: str, work_dir: Path) -> Path:
    """Download audio-only track (used for Whisper transcription fallback)."""
    out_template = str(work_dir / "audio.%(ext)s")
    opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "ba/b",
        "outtmpl": out_template,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "wav",
            "preferredquality": "192",
        }],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    for candidate in work_dir.glob("audio*.wav"):
        return candidate
    raise FileNotFoundError("yt-dlp did not produce an audio file")
