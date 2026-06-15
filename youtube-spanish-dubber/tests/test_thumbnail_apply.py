"""Tests for the standalone re-thumbnail endpoint (POST /thumbnail/apply).

The `app` module pulls in the upload/runner chain (yt_dlp, googleapiclient), so
these skip cleanly when those deps aren't installed -- same convention as the
rest of the heavy-pipeline suite -- and run in full where they are.
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

app = pytest.importorskip("youtube_dubber.app")

from fastapi import HTTPException  # noqa: E402
from PIL import Image  # noqa: E402

from youtube_dubber.pipeline import thumbnail_preview as tp, uploader  # noqa: E402


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
        "https://youtube.com/shorts/dQw4w9WgXcQ",
        "https://www.youtube.com/live/dQw4w9WgXcQ",
    ],
)
def test_extract_video_id(url):
    assert app._extract_video_id(url) == "dQw4w9WgXcQ"


def test_extract_video_id_rejects_idless_url():
    with pytest.raises(HTTPException) as exc:
        app._extract_video_id("https://youtube.com/")
    assert exc.value.status_code == 422


def _tiny_data_uri() -> str:
    return tp.image_to_data_uri(Image.new("RGB", (16, 9), "red"))


def test_thumbnail_apply_pushes_to_target(monkeypatch):
    seen = {}

    def fake_set(video_id, path, raise_on_error=False):
        seen.update(video_id=video_id, exists=Path(path).exists(), raise_on_error=raise_on_error)
        return True

    monkeypatch.setattr(uploader, "set_thumbnail", fake_set)

    payload = app.ThumbnailApplyRequest(target_url="https://youtu.be/dQw4w9WgXcQ", thumbnail=_tiny_data_uri())
    result = app.thumbnail_apply(payload)

    # The approved image is written to a real file and pushed to the parsed ID,
    # with raise_on_error so the endpoint can report the failure reason.
    assert seen == {"video_id": "dQw4w9WgXcQ", "exists": True, "raise_on_error": True}
    assert result["video_id"] == "dQw4w9WgXcQ"
    assert result["status"] == "updated"


def test_thumbnail_apply_rejects_a_bad_image():
    payload = app.ThumbnailApplyRequest(
        target_url="https://youtu.be/dQw4w9WgXcQ", thumbnail="data:image/png;base64,not-an-image"
    )
    with pytest.raises(HTTPException) as exc:
        app.thumbnail_apply(payload)
    assert exc.value.status_code == 422


def test_thumbnail_apply_maps_403_to_a_clear_error(monkeypatch):
    from googleapiclient.errors import HttpError

    def fake_set(video_id, path, raise_on_error=False):
        raise HttpError(SimpleNamespace(status=403, reason="Forbidden"), b'{"error":{"message":"forbidden"}}')

    monkeypatch.setattr(uploader, "set_thumbnail", fake_set)

    payload = app.ThumbnailApplyRequest(target_url="https://youtu.be/dQw4w9WgXcQ", thumbnail=_tiny_data_uri())
    with pytest.raises(HTTPException) as exc:
        app.thumbnail_apply(payload)
    assert exc.value.status_code == 502
    assert "verified" in exc.value.detail


def test_thumbnail_apply_maps_expired_token_to_a_clear_error(monkeypatch):
    # invalid_grant -> RefreshError (not an HttpError); the endpoint must tell the
    # user to re-authorize, not the unhelpful "check the service logs".
    from google.auth.exceptions import RefreshError

    def fake_set(video_id, path, raise_on_error=False):
        raise RefreshError("invalid_grant: Token has been expired or revoked.")

    monkeypatch.setattr(uploader, "set_thumbnail", fake_set)

    payload = app.ThumbnailApplyRequest(target_url="https://youtu.be/dQw4w9WgXcQ", thumbnail=_tiny_data_uri())
    with pytest.raises(HTTPException) as exc:
        app.thumbnail_apply(payload)
    assert exc.value.status_code == 502
    assert "authoriz" in exc.value.detail.lower() and "expired" in exc.value.detail.lower()
