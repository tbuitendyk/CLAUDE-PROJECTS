"""Recorded intro clips.

The operator records short intros, uploads them to YouTube as *unlisted* videos
and supplies the link. We fetch the media once (the same standalone yt-dlp the
dub pipeline uses), cache it on disk and measure its exact duration, so it can
later be prepended to a project's pre-intro master and republished as a new
video -- without re-dubbing. See IDEAS.md (#2).
"""
from __future__ import annotations

import logging
import shutil
import tempfile
import uuid
from pathlib import Path

from . import db

log = logging.getLogger(__name__)


def ingest_intro(url: str, name: str | None = None) -> db.Intro:
    """Download the intro at `url` (an unlisted YouTube link), cache its media,
    measure its exact duration and record it in the intro library. Raises
    downloader.DownloadError on a fetch failure so the caller can report why."""
    from .pipeline import downloader, ffmpeg_utils

    intro_id = uuid.uuid4().hex[:12]
    with tempfile.TemporaryDirectory() as tmp:
        info = downloader.download_video(url, Path(tmp))
        src = Path(info.video_path)
        duration = ffmpeg_utils.probe_duration(src)
        dest = db.intro_file_path(intro_id)
        shutil.move(str(src), str(dest))

    intro = db.create_intro(
        source_url=url,
        file_path=str(dest),
        duration=duration,
        name=(name or info.title or info.id),
        youtube_id=info.id,
        intro_id=intro_id,
    )
    log.info("Ingested intro %s (%.2fs) from %s", intro.id, duration, url)
    db.record_event("Intro added", video_title=intro.name, detail=f"{duration:.1f}s")
    return intro


def delete_intro(intro_id: str) -> db.Intro | None:
    """Remove an intro from the library (detaching it from any project using it)
    and unlink its cached media. Returns the deleted row, or None if unknown."""
    intro = db.delete_intro(intro_id)
    if intro is None:
        return None
    Path(intro.file_path).unlink(missing_ok=True)
    db.record_event("Intro deleted", video_title=intro.name)
    return intro
