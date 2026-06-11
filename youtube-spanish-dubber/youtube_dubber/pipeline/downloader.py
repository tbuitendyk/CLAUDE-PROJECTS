"""yt-dlp based downloading of source video, audio and captions.

yt-dlp is free/open-source and is the most reliable way to pull a video,
its audio track and any available (manual or auto-generated) captions for
a given language directly from YouTube.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable, Optional

import yt_dlp

from ..config import settings
from .models import ThumbnailSource, VideoInfo

log = logging.getLogger(__name__)

# YouTube now requires a "PO Token" for most player clients (web/tv/ios); without
# one, the only formats yt-dlp can use return HTTP 403 on download. android_vr is
# exempt from that requirement, so force it rather than standing up a companion
# PO-token-provider service. https://github.com/yt-dlp/yt-dlp-wiki/blob/master/PO%20Token%20Guide.md
_EXTRACTOR_ARGS = {"youtube": {"player_client": ["android_vr"]}}


def _with_cookies(opts: dict) -> dict:
    """Attach a cookies file to yt-dlp opts when one is configured and present.

    YouTube increasingly bot-checks datacenter IPs ("Sign in to confirm you're
    not a bot"); supplying cookies from a signed-in session is yt-dlp's
    recommended remedy. Optional -- with no file on disk the opts are unchanged
    (and extraction may hit the bot wall)."""
    cookies = settings.youtube_cookies_file
    if cookies and Path(cookies).exists():
        opts["cookiefile"] = str(cookies)
    return opts


def probe(url: str) -> dict:
    """Return yt-dlp's info dict without downloading anything."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "format": "bv*+ba/b",
        "extractor_args": _EXTRACTOR_ARGS,
    }
    with yt_dlp.YoutubeDL(_with_cookies(opts)) as ydl:
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


def _download_progress_hook(on_progress: "Callable[[float], None]"):
    """Adapt yt-dlp's progress dict to a simple 0..1 fraction callback. yt-dlp
    fires this per file (video, then audio), so the fraction resets once between
    them -- still a steadily-advancing signal within the download stage. Never
    lets a progress error interrupt the download."""
    def hook(d: dict) -> None:
        if d.get("status") != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        done = d.get("downloaded_bytes") or 0
        if total:
            try:
                on_progress(min(0.99, done / total))
            except Exception:  # noqa: BLE001 -- progress is best-effort
                pass
    return hook


def download_video(
    url: str, work_dir: Path, on_progress: "Optional[Callable[[float], None]]" = None
) -> VideoInfo:
    """Download the best available muxed (or mux-able) video+audio as MP4,
    plus the source thumbnail (so the dub can reuse/brand it). `on_progress`,
    if given, receives the download completion fraction (0..1)."""
    out_template = str(work_dir / "source.%(ext)s")
    opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b[ext=mp4]/best",
        "outtmpl": out_template,
        "merge_output_format": "mp4",
        # Save the thumbnail alongside the video. Best-effort: yt-dlp just skips
        # it if the video has none, and a missing thumbnail never fails a job.
        "writethumbnail": True,
        "extractor_args": _EXTRACTOR_ARGS,
    }
    if on_progress is not None:
        opts["progress_hooks"] = [_download_progress_hook(on_progress)]
    with yt_dlp.YoutubeDL(_with_cookies(opts)) as ydl:
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
        thumbnail_path=_find_thumbnail(work_dir, path),
    )


def fetch_thumbnail(url: str, work_dir: Path) -> Optional[ThumbnailSource]:
    """Download only the source video's thumbnail (no video/audio) plus the bit
    of metadata the preview needs. Returns None if no thumbnail could be saved.

    This is what makes the thumbnail-approval step cheap enough to run the
    instant a URL is pasted: `skip_download` means yt-dlp fetches just the
    info + the thumbnail image, not the (large, slow) media streams the full
    `download_video` pulls.

    Returns None only when extraction succeeded but the video had no thumbnail
    image; a fetch/extraction failure (bot check, unavailable video, an
    aged-out extractor, ...) re-raises so the caller can report the real
    reason rather than a blank 'no thumbnail'."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "writethumbnail": True,
        # We only want the thumbnail image + a little metadata, never a media
        # stream -- so don't let format selection abort the extraction. Some
        # player clients return no matching downloadable format ("Requested
        # format is not available"); that's irrelevant here, the thumbnail is
        # written regardless.
        "ignore_no_formats_error": True,
        "outtmpl": str(work_dir / "thumb.%(ext)s"),
        "extractor_args": _EXTRACTOR_ARGS,
    }
    try:
        with yt_dlp.YoutubeDL(_with_cookies(opts)) as ydl:
            info = ydl.extract_info(url, download=True)
    except yt_dlp.utils.DownloadError as exc:
        log.warning("Thumbnail fetch failed for %s: %s", url, exc)
        raise

    thumb = next(
        (str(p) for p in sorted(work_dir.glob("thumb.*")) if p.suffix.lower() in _THUMBNAIL_EXTS),
        None,
    )
    if thumb is None:
        return None
    return ThumbnailSource(
        thumbnail_path=thumb,
        title=info.get("title") or info["id"],
        original_language=info.get("language"),
        video_id=info["id"],
    )


# Thumbnail extensions yt-dlp may save (it picks whatever the site serves).
_THUMBNAIL_EXTS = (".jpg", ".jpeg", ".png", ".webp")


def _find_thumbnail(work_dir: Path, video_path: Path) -> Optional[str]:
    """Locate the thumbnail yt-dlp saved next to the video (e.g. `source.webp`),
    ignoring the video file itself. Returns its path, or None if none was
    written."""
    for candidate in sorted(work_dir.glob("source.*")):
        if candidate == video_path:
            continue
        if candidate.suffix.lower() in _THUMBNAIL_EXTS:
            return str(candidate)
    return None


def download_caption(url: str, lang: str, work_dir: Path, auto: bool) -> Optional[Path]:
    """Download a single caption track as VTT. Returns the file path, or None
    if the track doesn't exist on YouTube -- or if the download itself fails
    (e.g. a transient rate limit or network error). Callers treat both cases
    identically: fall back to the next-best transcript source rather than
    failing the whole job over a single caption track."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "writesubtitles": not auto,
        "writeautomaticsub": auto,
        "subtitleslangs": [lang],
        "subtitlesformat": "vtt",
        "outtmpl": str(work_dir / "captions.%(ext)s"),
        "extractor_args": _EXTRACTOR_ARGS,
    }
    try:
        with yt_dlp.YoutubeDL(_with_cookies(opts)) as ydl:
            ydl.download([url])
    except yt_dlp.utils.DownloadError as exc:
        log.warning("Caption download failed (lang=%s, auto=%s): %s", lang, auto, exc)
        return None

    for candidate in work_dir.glob("captions*.vtt"):
        return candidate
    return None
