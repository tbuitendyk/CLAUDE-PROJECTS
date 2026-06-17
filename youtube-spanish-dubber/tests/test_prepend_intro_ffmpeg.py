"""Integration test for prepend_intro: the joined video must be structurally
valid -- a clean full-decode with no timestamp/codec errors -- not just exist,
and it must work whatever codec the master is (the master is the already-
published dub, so it can be H.264, VP9, AV1, ... depending on the source).

This codifies the checks the earlier regressions lacked: the 8-hour full
re-encode, the non-monotonic-DTS file YouTube rejected, and the H.264-only TS
path that failed on a VP9 master.

Skips cleanly where ffmpeg/ffprobe (or a given codec's encoder) aren't installed.
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
    """Empty if the file decodes cleanly end to end; the first error otherwise
    (e.g. the non-monotonic-DTS corruption that breaks YouTube processing)."""
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"],
        capture_output=True, text=True,
    )
    return result.stderr.strip()


# (test id, master video codec, encoder, extra encode args)
_CASES = [
    ("h264", "h264", "libx264", []),
    ("vp9", "vp9", "libvpx-vp9", ["-b:v", "800k"]),
]


@pytest.mark.parametrize("name,codec,encoder,extra", _CASES, ids=[c[0] for c in _CASES])
def test_prepend_intro_clean_join_per_codec(tmp_path, name, codec, encoder, extra):
    if encoder not in fu._available_encoders():
        pytest.skip(f"{encoder} not available in this ffmpeg")

    # Master uses this codec at one geometry/fps; the intro deliberately differs
    # (resolution, fps, H.264, audio rate) so a naive concat would corrupt it.
    master = tmp_path / "master.mp4"
    intro = tmp_path / "intro.mp4"
    _make(master, size="640x360", rate=30, dur=4, vcodec=encoder, extra=extra, ar=44100)
    _make(intro, size="1280x720", rate=24, dur=2, vcodec="libx264", ar=48000)

    out = tmp_path / "joined.mp4"
    fu.prepend_intro(intro, master, out)

    width, height, _ = fu.probe_video_params(out)
    assert (width, height) == (640, 360)
    assert 5.4 < fu.probe_duration(out) < 6.6  # ~2s intro + ~4s master
    assert fu.probe_video_codec(out) == codec  # master codec preserved (not re-encoded)
    assert _decode_errors(out) == ""

    leftovers = {p.name for p in tmp_path.glob("*")} - {"master.mp4", "intro.mp4", "joined.mp4"}
    assert not leftovers
