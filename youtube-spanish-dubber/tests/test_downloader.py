"""Tests for the yt-dlp binary wrapper (downloader).

Cover the command construction and error/caption parsing -- the pieces that
don't need the actual yt-dlp binary or the network."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from youtube_dubber.pipeline import downloader


@pytest.fixture
def fake_settings(monkeypatch, tmp_path):
    fake = SimpleNamespace(
        ytdlp_bin=tmp_path / "yt-dlp",
        youtube_cookies_file=tmp_path / "cookies.txt",
    )
    monkeypatch.setattr(downloader, "settings", fake)
    return fake


def test_base_cmd_uses_only_token_exempt_clients(fake_settings):
    cmd = downloader._base_cmd()
    assert "--extractor-args" in cmd
    arg = cmd[cmd.index("--extractor-args") + 1]
    assert arg == "youtube:player_client=tv,web_embedded,android_vr"


def test_base_cmd_omits_cookies_when_the_file_is_absent(fake_settings):
    assert "--cookies" not in downloader._base_cmd()


def test_base_cmd_adds_cookies_when_present(fake_settings):
    fake_settings.youtube_cookies_file.write_text("# Netscape HTTP Cookie File\n")
    cmd = downloader._base_cmd()
    assert "--cookies" in cmd
    assert str(fake_settings.youtube_cookies_file) in cmd


def test_binary_falls_back_to_path_when_not_installed(fake_settings):
    assert downloader._binary() == "yt-dlp"  # tmp path doesn't exist
    fake_settings.ytdlp_bin.write_text("#!/bin/sh\n")
    assert downloader._binary() == str(fake_settings.ytdlp_bin)


def test_clean_error_extracts_the_error_line():
    stderr = (
        "WARNING: something\n"
        "ERROR: [youtube] X: Sign in to confirm you're not a bot. Use --cookies\n"
        "trailing noise\n"
    )
    assert downloader._clean_error(stderr).startswith("[youtube] X: Sign in to confirm")


def test_clean_error_handles_empty():
    assert downloader._clean_error("") == ""


def test_available_caption_language_prefix_match():
    info = {"subtitles": {"es-419": [{"url": "x"}]}}
    assert downloader.available_caption_language(info, ("es",), auto=False) == "es-419"
