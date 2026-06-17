"""Integration test for prepend_intro: the joined video must be structurally
valid -- a clean full-decode with no timestamp/codec errors -- not just exist.

This is the check that the earlier "8-hour re-encode" and "YouTube: could not be
processed" regressions both lacked: the inputs deliberately mismatch (different
resolution, fps, H.264 profile and audio rate) so a naive concat produces the
non-monotonic-DTS corruption YouTube rejects.

Skips cleanly where ffmpeg/ffprobe aren't installed (same convention as the rest
of the heavy suite)."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
    pytest.skip("ffmpeg/ffprobe not installed", allow_module_level=True)

from youtube_dubber.pipeline import ffmpeg_utils as fu  # noqa: E402


def _make(path: Path, *, size: str, rate: int, dur: int, profile: str, ar: int) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", f"testsrc=size={size}:rate={rate}:duration={dur}",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={dur}",
         "-c:v", "libx264", "-profile:v", profile, "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-ar", str(ar), "-shortest", str(path)],
        check=True, capture_output=True,
    )


def _decode_errors(path: Path) -> str:
    """Empty string if the file decodes cleanly end to end; the first error line
    otherwise (e.g. the non-monotonic-DTS corruption that breaks YouTube)."""
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"],
        capture_output=True, text=True,
    )
    return result.stderr.strip()


def test_prepend_intro_produces_a_clean_decodable_join(tmp_path):
    # Master mimics a YouTube-sourced stream the dub copies: a DIFFERENT H.264
    # profile (baseline) + resolution + fps + audio rate than the intro, so a
    # naive copy-concat corrupts the timestamps.
    master = tmp_path / "master.mp4"
    intro = tmp_path / "intro.mp4"
    _make(master, size="640x360", rate=30, dur=4, profile="baseline", ar=44100)
    _make(intro, size="1280x720", rate=24, dur=2, profile="high", ar=48000)

    out = tmp_path / "joined.mp4"
    fu.prepend_intro(intro, master, out)

    # Conforms to the master's geometry, runs ~intro+master, and -- the point --
    # decodes with zero errors.
    width, height, _ = fu.probe_video_params(out)
    assert (width, height) == (640, 360)
    assert 5.4 < fu.probe_duration(out) < 6.6  # ~2s intro + ~4s master
    assert _decode_errors(out) == ""

    # The scratch segments are cleaned up.
    leftovers = {p.name for p in tmp_path.glob("*")} - {"master.mp4", "intro.mp4", "joined.mp4"}
    assert not leftovers
