"""Publish the finished dub to the user's YouTube channel.

Uses the official YouTube Data API v3 (free quota: 10,000 units/day; a
single upload costs 1,600 units, i.e. roughly six uploads per day at no
charge) via Google's official, free, open-source client libraries.

Authentication is OAuth2 "installed app" flow: the operator runs a one-time
interactive authorization (see deploy/README section "YouTube authorization"),
which produces a refresh token cached on disk. From then on the service can
upload unattended -- Google's client library refreshes the access token
automatically.
"""
from __future__ import annotations

import logging
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from ..config import settings

log = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
API_SERVICE_NAME = "youtube"
API_VERSION = "v3"


def _load_credentials() -> Credentials:
    token_file = settings.youtube_token_file
    creds: Credentials | None = None

    if token_file.exists():
        creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        token_file.write_text(creds.to_json(), encoding="utf-8")
        return creds

    raise RuntimeError(
        "No valid YouTube credentials found. Run the one-time authorization "
        "helper first:\n"
        "    python -m youtube_dubber.cli authorize\n"
        f"(expects an OAuth client secret at {settings.youtube_client_secrets_file})"
    )


def run_authorization_flow() -> None:
    """Interactive, one-time OAuth2 authorization (run manually, not by the worker)."""
    secrets_file = settings.youtube_client_secrets_file
    if not secrets_file.exists():
        raise FileNotFoundError(
            f"Missing OAuth client secret file at {secrets_file}. "
            "Download it from Google Cloud Console (APIs & Services -> Credentials) "
            "for an OAuth client of type 'Desktop app' and place it there."
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(secrets_file), SCOPES)
    # Fixed port so it matches the SSH port-forward documented in the README,
    # and open_browser=False because the VPS is headless -- trying to launch
    # one raises webbrowser.Error instead of falling back to printing the URL.
    creds = flow.run_local_server(port=8080, open_browser=False)
    settings.youtube_token_file.parent.mkdir(parents=True, exist_ok=True)
    settings.youtube_token_file.write_text(creds.to_json(), encoding="utf-8")
    log.info("Saved YouTube credentials to %s", settings.youtube_token_file)


def upload_video(
    video_path: Path,
    title: str,
    description: str,
    tags: list[str] | None = None,
    privacy_status: str | None = None,
    category_id: str | None = None,
    on_progress: "Callable[[float], None] | None" = None,
) -> str:
    """Upload `video_path` to the authorized channel. Returns the new video ID.

    `on_progress`, if given, receives the upload completion fraction (0..1) as
    the resumable upload streams its chunks."""
    creds = _load_credentials()
    youtube = build(API_SERVICE_NAME, API_VERSION, credentials=creds, cache_discovery=False)

    body = {
        "snippet": {
            "title": title[:100],
            "description": description[:5000],
            "tags": (tags or [])[:500],
            "categoryId": category_id or settings.upload_category_id,
        },
        "status": {
            "privacyStatus": privacy_status or settings.upload_privacy_status,
            "selfDeclaredMadeForKids": False,
        },
    }

    media = MediaFileUpload(str(video_path), chunksize=8 * 1024 * 1024, resumable=True, mimetype="video/mp4")
    request = youtube.videos().insert(part="snippet,status", body=body, media_body=media)

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            log.info("Upload progress: %d%%", int(status.progress() * 100))
            if on_progress is not None:
                try:
                    on_progress(min(0.99, status.progress()))
                except Exception:  # noqa: BLE001 -- progress is best-effort
                    pass

    video_id = response["id"]
    log.info("Uploaded video https://youtu.be/%s", video_id)
    return video_id


def set_thumbnail(video_id: str, thumbnail_path: Path) -> bool:
    """Set a custom thumbnail on an already-uploaded video. Returns True on
    success.

    Best-effort by design: custom thumbnails require a phone-verified YouTube
    channel, so a 403 here is expected and benign on an unverified channel --
    we log it and return False rather than failing the dub, which has already
    published successfully (YouTube just keeps its auto-generated thumbnail).
    """
    try:
        creds = _load_credentials()
        youtube = build(API_SERVICE_NAME, API_VERSION, credentials=creds, cache_discovery=False)
        media = MediaFileUpload(str(thumbnail_path), mimetype="image/jpeg")
        youtube.thumbnails().set(videoId=video_id, media_body=media).execute()
        log.info("Set custom thumbnail on https://youtu.be/%s", video_id)
        return True
    except Exception as exc:  # noqa: BLE001 -- never fail a published dub over a thumbnail
        log.warning(
            "Couldn't set custom thumbnail on %s (%s). Custom thumbnails need a "
            "verified channel; leaving YouTube's auto-generated one.", video_id, exc
        )
        return False
