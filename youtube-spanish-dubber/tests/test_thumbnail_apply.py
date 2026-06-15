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


class _FakeList:
    def __init__(self, result):
        self._result = result

    def list(self, **_kw):
        return self

    def execute(self):
        return self._result


class _FakeYouTube:
    def __init__(self, channels=None, videos=None):
        self._channels = channels
        self._videos = videos

    def channels(self):
        return _FakeList(self._channels)

    def videos(self):
        return _FakeList(self._videos)


def test_authorized_channel_parses_the_api_shape(monkeypatch):
    monkeypatch.setattr(
        uploader, "_youtube",
        lambda: _FakeYouTube(channels={"items": [{"id": "UC_auth", "snippet": {"title": "My Brand"}}]}),
    )
    assert uploader.authorized_channel() == ("UC_auth", "My Brand")


def test_authorized_channel_is_none_when_unreadable(monkeypatch):
    # No readonly scope -> the API raises -> diagnostics stay quiet (return None).
    def boom():
        raise RuntimeError("insufficient authentication scopes")

    monkeypatch.setattr(uploader, "_youtube", boom)
    assert uploader.authorized_channel() is None


def test_video_owner_parses_the_api_shape(monkeypatch):
    monkeypatch.setattr(
        uploader, "_youtube",
        lambda: _FakeYouTube(videos={"items": [{"snippet": {"channelId": "UC_owner", "channelTitle": "Other"}}]}),
    )
    assert uploader.video_owner("vid123") == ("UC_owner", "Other")


def test_diagnose_names_a_channel_mismatch(monkeypatch):
    monkeypatch.setattr(uploader, "authorized_channel", lambda: ("UC_auth", "My Personal"))
    monkeypatch.setattr(uploader, "video_owner", lambda _v: ("UC_owner", "My Brand"))
    hint = uploader.diagnose_thumbnail_failure("vid123")
    assert "My Personal" in hint and "My Brand" in hint
    assert "UC_auth" in hint and "UC_owner" in hint
    assert "Brand Account" in hint and "authorize" in hint.lower()


def test_diagnose_points_at_verification_when_channel_matches(monkeypatch):
    monkeypatch.setattr(uploader, "authorized_channel", lambda: ("UC_same", "My Brand"))
    monkeypatch.setattr(uploader, "video_owner", lambda _v: ("UC_same", "My Brand"))
    hint = uploader.diagnose_thumbnail_failure("vid123")
    assert "verify" in hint.lower() and "youtube.com/verify" in hint


def test_diagnose_returns_none_when_identity_unreadable(monkeypatch):
    # Upload-only token -> identity can't be read -> None, so the caller keeps its
    # generic guidance instead of inventing a reason.
    monkeypatch.setattr(uploader, "authorized_channel", lambda: None)
    monkeypatch.setattr(uploader, "video_owner", lambda _v: None)
    assert uploader.diagnose_thumbnail_failure("vid123") is None


def test_thumbnail_apply_403_appends_the_channel_diagnosis(monkeypatch):
    from googleapiclient.errors import HttpError

    def fake_set(video_id, path, raise_on_error=False):
        raise HttpError(SimpleNamespace(status=403, reason="Forbidden"), b'{"error":{"message":"forbidden"}}')

    monkeypatch.setattr(uploader, "set_thumbnail", fake_set)
    monkeypatch.setattr(
        uploader, "diagnose_thumbnail_failure",
        lambda _v: "Authorized as channel 'A' but that video belongs to 'B'.",
    )

    payload = app.ThumbnailApplyRequest(target_url="https://youtu.be/dQw4w9WgXcQ", thumbnail=_tiny_data_uri())
    with pytest.raises(HTTPException) as exc:
        app.thumbnail_apply(payload)
    # Both the base phone-verified guidance AND the concrete channel reason appear.
    assert "verified" in exc.value.detail
    assert "that video belongs to 'B'" in exc.value.detail


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
