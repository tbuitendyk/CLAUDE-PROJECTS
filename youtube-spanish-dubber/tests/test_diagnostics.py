"""Tests for the extraction-diagnostics subsystem: report assembly, persistence
to data/diagnostics/last.txt, best-effort failure capture, and the worker's
'is this an extraction failure worth capturing' classifier. The yt-dlp probes
are stubbed so nothing hits the network."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from youtube_dubber import diagnostics
from youtube_dubber.pipeline import downloader


@pytest.fixture
def fake(tmp_path, monkeypatch):
    settings = SimpleNamespace(
        data_dir=tmp_path,
        youtube_use_cookies=True,
        youtube_cookies_file=str(tmp_path / "cookies.txt"),
        ytdlp_player_clients="",
        ytdlp_client_ladder="web,mweb,default",
    )
    monkeypatch.setattr(diagnostics, "settings", settings)
    # Keep the downloader's own settings consistent for client_ladder().
    monkeypatch.setattr(downloader, "settings", SimpleNamespace(
        ytdlp_player_clients="", ytdlp_client_ladder="web,mweb,default",
        ytdlp_plugin_dirs="/nope", ytdlp_bin="/nope/yt-dlp",
        youtube_use_cookies=True, youtube_cookies_file=str(tmp_path / "cookies.txt"),
    ))
    monkeypatch.setattr(diagnostics, "_yt_dlp_version", lambda: "2026.06.09")
    monkeypatch.setattr(diagnostics, "verbose_probe", lambda url, **k: "VERBOSE-TRACE-HERE")
    return settings


def test_report_assembles_and_persists(fake, monkeypatch):
    (fake.data_dir / "cookies.txt").write_text("# cookies\n")
    monkeypatch.setattr(downloader, "probe_client_formats",
                        lambda url: [("web", 0), ("mweb", 12), ("default", 0)])

    data = diagnostics.report("https://youtu.be/abc")
    assert data["working_client"] == "mweb"
    assert data["cookies_enabled"] is True and data["cookies_present"] is True
    assert data["per_client"][1] == {"client": "mweb", "real_formats": 12}
    # The human-readable report carries the key facts + the verbose trace.
    assert "WORKING client: mweb" in data["report"]
    assert "VERBOSE-TRACE-HERE" in data["report"]
    # Persisted for GET /diagnostics/last.
    assert diagnostics.last_report() == data["report"]


def test_report_when_nothing_works(fake, monkeypatch):
    monkeypatch.setattr(downloader, "probe_client_formats",
                        lambda url: [("web", 0), ("mweb", 0), ("default", 0)])
    data = diagnostics.report()
    assert data["working_client"] is None
    assert "NO client returned real formats" in data["report"]


def test_capture_failure_writes_per_job_file(fake, monkeypatch):
    monkeypatch.setattr(downloader, "probe_client_formats", lambda url: [("web", 0)])
    text = diagnostics.capture_failure("https://youtu.be/abc", job_id="job123")
    assert text is not None
    assert (fake.data_dir / "diagnostics" / "job-job123.txt").exists()


def test_capture_failure_never_raises(fake, monkeypatch):
    def boom(url):
        raise RuntimeError("probe exploded")
    monkeypatch.setattr(downloader, "probe_client_formats", boom)
    assert diagnostics.capture_failure("https://youtu.be/abc", "j") is None


def test_last_report_none_when_absent(fake):
    assert diagnostics.last_report() is None


def test_worker_classifies_extraction_failures():
    from youtube_dubber import worker
    assert worker._looks_like_extraction_failure(RuntimeError("Sign in to confirm you're not a bot"))
    assert worker._looks_like_extraction_failure(RuntimeError("Requested format is not available"))
    assert not worker._looks_like_extraction_failure(RuntimeError("disk full while writing mux"))
