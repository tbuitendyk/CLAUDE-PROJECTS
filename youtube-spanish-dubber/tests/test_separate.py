"""Tests for speech separation (separate.py) and the music-bed mux dispatch.

The MDX model isn't present in the test env, so the model-dependent paths are
exercised through their graceful-fallback behaviour; the DSP roundtrip and the
mux wiring are tested for real."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

np = pytest.importorskip("numpy")

from youtube_dubber.pipeline import ffmpeg_utils, separate, video  # noqa: E402


def test_stft_istft_roundtrip_is_exact():
    # The whole separation hinges on matching torch's STFT/ISTFT; a near-zero
    # roundtrip error is what proves the numpy reimplementation is faithful.
    assert separate.roundtrip_max_error(60000) < 1e-6


def test_available_false_without_model(monkeypatch, tmp_path):
    monkeypatch.setattr(separate, "settings", SimpleNamespace(separator_model_path=tmp_path / "missing.onnx"))
    assert separate.available() is False


def test_instrumental_bed_returns_none_when_unavailable(monkeypatch, tmp_path):
    monkeypatch.setattr(separate, "available", lambda: False)
    assert separate.instrumental_bed(tmp_path / "src.mp4", tmp_path) is None


def test_mux_music_uses_bed_when_present(monkeypatch):
    calls = {}
    monkeypatch.setattr(ffmpeg_utils, "mux_music_bed",
                        lambda v, n, b, d, vol: calls.setdefault("music", (b, vol)))
    monkeypatch.setattr(ffmpeg_utils, "mux_replace_audio", lambda *a: calls.setdefault("replace", True))
    video.mux(Path("v.mp4"), Path("n.wav"), Path("out.mp4"),
              mode="music", duck_volume=0.7, bed_path=Path("bed.wav"))
    assert calls.get("music") == (Path("bed.wav"), 0.7)
    assert "replace" not in calls


def test_mux_music_falls_back_to_replace_without_bed(monkeypatch):
    calls = {}
    monkeypatch.setattr(ffmpeg_utils, "mux_replace_audio", lambda v, n, o: calls.setdefault("replace", True))
    monkeypatch.setattr(ffmpeg_utils, "mux_music_bed", lambda *a: calls.setdefault("music", True))
    video.mux(Path("v.mp4"), Path("n.wav"), Path("out.mp4"),
              mode="music", duck_volume=0.7, bed_path=None)
    assert calls.get("replace") is True and "music" not in calls


def test_mux_music_bed_filter_has_no_sidechain(monkeypatch):
    captured = {}
    monkeypatch.setattr(ffmpeg_utils, "_run", lambda cmd: captured.setdefault("cmd", cmd))
    ffmpeg_utils.mux_music_bed(Path("v.mp4"), Path("n.wav"), Path("bed.wav"), Path("out.mp4"), 0.7)
    cmd = captured["cmd"]
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "volume=0.700[bed]" in fc
    assert "sidechaincompress" not in fc          # no ducking once the speech is gone
    assert "volume=2.0" in fc and "alimiter=" in fc
    assert "[2:a]" in fc and "[1:a]" in fc         # bed = input 2, narration = input 1
