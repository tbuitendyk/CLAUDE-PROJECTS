"""Video-link and title helpers shared by the API, the library and the pipeline.

Deliberately dependency-free (no pipeline imports) so the db layer and tests can
use it without dragging in yt-dlp/googleapiclient.
"""
from __future__ import annotations

import re

# Pulls the 11-char video ID out of any URL shape we accept (watch/shorts/live/
# youtu.be), or matches a bare ID passed through as-is.
_VIDEO_ID_RE = re.compile(r"(?:v=|youtu\.be/|shorts/|live/)([\w\-]{11})")
_BARE_ID_RE = re.compile(r"^[\w\-]{11}$")


def extract_video_id(url_or_id: str) -> str | None:
    """The clean 11-char YouTube video ID from a URL (any share/playlist/track
    params dropped) or a bare ID -- the library's canonical key. None if there
    isn't one."""
    value = (url_or_id or "").strip()
    if _BARE_ID_RE.match(value):
        return value
    match = _VIDEO_ID_RE.search(value)
    return match.group(1) if match else None


def watch_url(video_id: str) -> str:
    """The canonical URL rendered for a stored clean video ID."""
    return f"https://www.youtube.com/watch?v={video_id}"


def strip_title_tag(text: str, tag: str) -> str:
    """Remove every leading occurrence of `tag` (e.g. "[Versión Español]") from
    `text` -- the guard that keeps a redub from stacking tags ("[Versión
    Español] [Versión Español] ...")."""
    tag = tag.strip()
    if not tag:
        return text.strip()
    out = text.strip()
    while out.lower().startswith(tag.lower()):
        out = out[len(tag):].lstrip()
    return out


def compose_title(translated_title: str, source_title: str, prefix: str, max_len: int = 100) -> str:
    """The dub's video title: "<prefix> <translated> (<original>)", idempotent.

    Both inputs are scrubbed of any tag the prefix would add, so composing from
    an already-tagged title (a redub that read its own output) can never double
    it up."""
    tag = prefix.strip()
    translated = strip_title_tag(translated_title or "", tag)
    original = strip_title_tag(source_title or "", tag)
    title = f"{tag} {translated}".strip()
    if original and original.lower() != translated.lower():
        title = f"{title} ({original})"
    return title[:max_len]
