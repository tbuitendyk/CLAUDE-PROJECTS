"""Tests for the yt-dlp player-client resolver (the self-healing 'watcher'):
format counting, ladder parsing, command building, and resolve/cache logic.
The network probe (_probe_formats) is stubbed so no yt-dlp/YouTube is touched."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from youtube_dubber.pipeline import downloader


@pytest.fixture(autouse=True)
def fake_settings(monkeypatch):
    """A settings double with the extraction knobs, and a clean resolver cache."""
    fake = SimpleNamespace(
        ytdlp_bin="/nonexistent/yt-dlp",
        ytdlp_plugin_dirs="/nonexistent/plugins",
        ytdlp_player_clients="",
        ytdlp_client_ladder="web,mweb,web_safari,tv,default",
        youtube_use_cookies=False,
        youtube_cookies_file="/nonexistent/cookies.txt",
    )
    monkeypatch.setattr(downloader, "settings", fake)
    downloader.reset_resolved_client()
    yield fake
    downloader.reset_resolved_client()


def test_count_real_formats_ignores_storyboards():
    info = {"formats": [
        {"vcodec": "none", "acodec": "none"},          # storyboard
        {"vcodec": "avc1", "acodec": "none"},           # video-only -> real
        {"vcodec": "none", "acodec": "mp4a"},           # audio-only -> real
        {"vcodec": "vp9", "acodec": "opus"},            # muxed -> real
    ]}
    assert downloader.count_real_formats(info) == 3
    assert downloader.count_real_formats({"formats": []}) == 0
    assert downloader.count_real_formats({}) == 0


def test_client_ladder_parsing(fake_settings):
    assert downloader.client_ladder() == ["web", "mweb", "web_safari", "tv", "default"]
    fake_settings.ytdlp_client_ladder = " tv , web "
    assert downloader.client_ladder() == ["tv", "web"]
    fake_settings.ytdlp_client_ladder = ""
    assert downloader.client_ladder() == ["default"]


def test_client_extractor_args():
    assert downloader._client_extractor_args("web") == ["--extractor-args", "youtube:player_client=web"]
    assert downloader._client_extractor_args("") == []
    assert downloader._client_extractor_args("default") == []


def test_base_cmd_uses_resolved_client(fake_settings, monkeypatch):
    # No pin, nothing resolved -> default (no --extractor-args).
    assert "--extractor-args" not in downloader._base_cmd()
    # Resolve to mweb (web fails, mweb works), then _base_cmd pins mweb.
    monkeypatch.setattr(downloader, "_probe_formats",
                        lambda url, client: 5 if client == "mweb" else 0)
    downloader.ensure_working_client("https://youtu.be/x")
    cmd = downloader._base_cmd()
    assert "youtube:player_client=mweb" in cmd


def test_hard_pin_overrides_resolver(fake_settings, monkeypatch):
    fake_settings.ytdlp_player_clients = "tv"
    probed = []
    monkeypatch.setattr(downloader, "_probe_formats",
                        lambda url, client: probed.append(client) or 1)
    downloader.ensure_working_client("https://youtu.be/x")  # must be a no-op
    assert probed == []  # operator pin respected; no ladder probing
    assert "youtube:player_client=tv" in downloader._base_cmd()


def test_resolve_picks_first_working_client(fake_settings, monkeypatch):
    monkeypatch.setattr(downloader, "_probe_formats",
                        lambda url, client: 3 if client in ("web_safari", "tv") else 0)
    assert downloader.resolve_working_client("https://youtu.be/x") == "web_safari"


def test_resolve_returns_none_when_all_fail(fake_settings, monkeypatch):
    monkeypatch.setattr(downloader, "_probe_formats", lambda url, client: 0)
    assert downloader.resolve_working_client("https://youtu.be/x") is None


def test_ensure_runs_once_and_caches(fake_settings, monkeypatch):
    calls = []
    monkeypatch.setattr(downloader, "_probe_formats",
                        lambda url, client: calls.append(client) or (9 if client == "web" else 0))
    downloader.ensure_working_client("https://youtu.be/x")
    assert calls == ["web"]            # web won immediately
    calls.clear()
    downloader.ensure_working_client("https://youtu.be/y")
    assert calls == []                 # cached -> no re-probe
    assert "youtube:player_client=web" in downloader._base_cmd()


def test_ensure_best_effort_when_none_work(fake_settings, monkeypatch):
    monkeypatch.setattr(downloader, "_probe_formats", lambda url, client: 0)
    downloader.ensure_working_client("https://youtu.be/x")
    # No client pinned -> falls back to yt-dlp's default (no --extractor-args).
    assert "--extractor-args" not in downloader._base_cmd()


def test_probe_client_formats_reports_each(fake_settings, monkeypatch):
    monkeypatch.setattr(downloader, "_probe_formats",
                        lambda url, client: {"web": 0, "mweb": 7}.get(client, 0))
    results = dict(downloader.probe_client_formats("https://youtu.be/x"))
    assert results["web"] == 0 and results["mweb"] == 7
