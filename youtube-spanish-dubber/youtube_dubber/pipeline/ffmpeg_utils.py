"""Small wrappers around the `ffmpeg`/`ffprobe` CLIs (free, open-source, the
de-facto standard for audio/video manipulation, installed via apt on Debian).

All intermediate narration audio is normalized to a single PCM format
(mono, 24kHz, 16-bit) so it can be losslessly joined with ffmpeg's `concat`
demuxer without complex filter graphs.
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)

SAMPLE_RATE = 24000
CHANNELS = 1


def _run(cmd: list[str]) -> None:
    log.debug("Running: %s", " ".join(cmd))
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed ({' '.join(cmd)}):\n{result.stderr[-4000:]}")


def probe_duration(path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def to_standard_wav(src: Path, dst: Path, atempo: float | None = None) -> None:
    """Re-encode `src` to the standard mono/24kHz/16-bit PCM format, optionally
    applying a tempo (speed) change. ffmpeg's `atempo` only supports 0.5-2.0
    per instance, which comfortably covers our clamped speaking-rate range."""
    filters = []
    if atempo is not None and abs(atempo - 1.0) > 1e-3:
        filters.append(f"atempo={atempo:.4f}")
    filter_arg = ",".join(filters) if filters else "anull"
    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-filter:a", filter_arg,
        "-ar", str(SAMPLE_RATE), "-ac", str(CHANNELS),
        "-c:a", "pcm_s16le", str(dst),
    ]
    _run(cmd)


def generate_silence(dst: Path, duration: float) -> None:
    duration = max(duration, 0.02)
    cmd = [
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", f"anullsrc=r={SAMPLE_RATE}:cl=mono",
        "-t", f"{duration:.3f}",
        "-c:a", "pcm_s16le", str(dst),
    ]
    _run(cmd)


def concat_wavs(paths: list[Path], dst: Path) -> None:
    if len(paths) == 1:
        to_standard_wav(paths[0], dst)
        return
    list_file = dst.with_suffix(".concat.txt")
    with list_file.open("w", encoding="utf-8") as fh:
        for path in paths:
            escaped = str(path.resolve()).replace("'", "'\\''")
            fh.write(f"file '{escaped}'\n")
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
        "-c:a", "pcm_s16le", str(dst),
    ]
    _run(cmd)
    list_file.unlink(missing_ok=True)


def mux_replace_audio(video_path: Path, audio_path: Path, dst: Path) -> None:
    """Output = original video stream + new narration as the sole audio track."""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path), "-i", str(audio_path),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-shortest", str(dst),
    ]
    _run(cmd)


def mux_duck_audio(video_path: Path, audio_path: Path, dst: Path, original_volume: float) -> None:
    """Output = original audio (lowered) mixed under the new narration."""
    filter_complex = (
        f"[0:a]volume={original_volume:.3f}[orig];"
        f"[1:a]volume=1.0[dub];"
        f"[orig][dub]amix=inputs=2:duration=longest:dropout_transition=0[aout]"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path), "-i", str(audio_path),
        "-filter_complex", filter_complex,
        "-map", "0:v:0", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-shortest", str(dst),
    ]
    _run(cmd)
