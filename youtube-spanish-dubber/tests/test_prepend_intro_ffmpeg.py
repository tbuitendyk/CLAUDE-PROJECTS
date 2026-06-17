"""Integration test for prepend_intro: the joined video must be structurally
valid -- a clean full-decode with no timestamp/codec errors -- whatever codec the
master is (it's the already-published dub, so H.264, VP9, AV1, ...).

Two strategies are exercised:
- fast path: re-encode only the short intro, keep (stream-copy) the master;
- bounded re-encode to <=1080p H.264 when the master's codec has no cheap encoder
  (e.g. AV1 with only libaom), which also caps a 4K master.

These codify the checks the earlier regressions lacked (8-hour 4K re-encode;
non-monotonic-DTS file YouTube rejected; H.264-only TS path failing on VP9; AV1
intro encode OOM). Skips where ffmpeg/ffprobe or a needed encoder aren't present.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
    pytest.skip("ffmpeg/ffprobe not installed", allow_module_level=True)

from youtube_dubber.pipeline import ffmpeg_utils as fu  # noqa: E402


def _make(path: Path, *, size: str, rate: int, dur: int, vcodec: str, extra=(), ar: int = 44100) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", f"testsrc=size={size}:rate={rate}:duration={dur}",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={dur}",
         "-c:v", vcodec, *extra, "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-ar", str(ar), "-shortest", str(path)],
        check=True, capture_output=True,
    )


def _decode_errors(path: Path) -> str:
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"],
        capture_output=True, text=True,
    )
    return result.stderr.strip()


def _av1_encoder() -> "tuple[str, list[str]] | None":
    avail = fu._available_encoders()
    if "libsvtav1" in avail:
        return "libsvtav1", ["-preset", "9"]
    if "libaom-av1" in avail:
        return "libaom-av1", ["-cpu-used", "8", "-b:v", "0", "-crf", "50"]
    return None


_FAST_CASES = [("h264", "libx264", []), ("vp9", "libvpx-vp9", ["-b:v", "800k"])]


@pytest.mark.parametrize("codec,encoder,extra", _FAST_CASES, ids=[c[0] for c in _FAST_CASES])
def test_fast_path_keeps_master_codec_and_decodes_clean(tmp_path, codec, encoder, extra):
    if encoder not in fu._available_encoders():
        pytest.skip(f"{encoder} not available")
    master, intro, out = tmp_path / "m.mp4", tmp_path / "i.mp4", tmp_path / "o.mp4"
    _make(master, size="640x360", rate=30, dur=4, vcodec=encoder, extra=extra)
    _make(intro, size="1280x720", rate=24, dur=2, vcodec="libx264", ar=48000)

    fu.prepend_intro(intro, master, out)

    assert fu.probe_video_params(out)[:2] == (640, 360)
    assert 5.4 < fu.probe_duration(out) < 6.6
    assert fu.probe_video_codec(out) == codec  # master not re-encoded
    assert _decode_errors(out) == ""
    leftovers = {p.name for p in tmp_path.glob("*")} - {"m.mp4", "i.mp4", "o.mp4"}
    assert not leftovers


def test_reencode_path_when_no_fast_encoder(tmp_path, monkeypatch):
    av1 = _av1_encoder()
    if av1 is None:
        pytest.skip("no AV1 encoder to build an AV1 master")
    master, intro, out = tmp_path / "m.mp4", tmp_path / "i.mp4", tmp_path / "o.mp4"
    _make(master, size="640x360", rate=30, dur=4, vcodec=av1[0], extra=av1[1])
    _make(intro, size="1280x720", rate=24, dur=2, vcodec="libx264", ar=48000)
    # Simulate this server: AV1 master but no SVT-AV1 -> no fast encoder -> compat.
    monkeypatch.setattr(fu, "_available_encoders", lambda: {"libx264"})

    fu.prepend_intro(intro, master, out)

    assert fu.probe_video_codec(out) == "h264"  # re-encoded to a safe, valid format
    assert 5.4 < fu.probe_duration(out) < 6.6
    assert _decode_errors(out) == ""


def test_reencode_path_caps_4k_to_1080p(tmp_path, monkeypatch):
    master, intro, out = tmp_path / "m.mp4", tmp_path / "i.mp4", tmp_path / "o.mp4"
    _make(master, size="3840x2160", rate=24, dur=2, vcodec="libx264", extra=["-preset", "ultrafast"])
    _make(intro, size="1280x720", rate=24, dur=1, vcodec="libx264")
    monkeypatch.setattr(fu, "_available_encoders", lambda: set())  # force the compat path

    fu.prepend_intro(intro, master, out)

    assert fu.probe_video_params(out)[:2] == (1920, 1080)
    assert _decode_errors(out) == ""
