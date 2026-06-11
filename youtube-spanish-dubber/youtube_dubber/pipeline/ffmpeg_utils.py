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


def audio_window_plan(total_seconds: float, window_seconds: float) -> list[tuple[float, float]]:
    """Split a [0, total) timeline into consecutive (start, duration) windows of
    at most `window_seconds`, the last covering the remainder.

    Returns a single full-length window when windowing is disabled
    (`window_seconds` <= 0) or unnecessary (audio already shorter than a window),
    and an empty list for non-positive `total_seconds`. Used to feed Whisper one
    time-window at a time so the whole audio is never decoded into RAM at once.
    """
    if total_seconds <= 0:
        return []
    if window_seconds <= 0 or total_seconds <= window_seconds:
        return [(0.0, total_seconds)]
    plan: list[tuple[float, float]] = []
    start = 0.0
    while start < total_seconds - 1e-6:
        plan.append((start, min(window_seconds, total_seconds - start)))
        start += window_seconds
    return plan


def extract_audio_window(src: Path, dst: Path, start: float, duration: float) -> None:
    """Write [start, start+duration) of `src` to `dst` as a standalone WAV in the
    standard mono/24kHz/16-bit PCM format. `-ss`/`-t` before `-i` keeps the seek
    fast and (for PCM) sample-accurate, so windows tile the audio with no gaps."""
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{start:.3f}", "-t", f"{duration:.3f}",
        "-i", str(src),
        "-ar", str(SAMPLE_RATE), "-ac", str(CHANNELS),
        "-c:a", "pcm_s16le", str(dst),
    ]
    _run(cmd)


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


def duck_filter_complex(bed_volume: float) -> str:
    """ffmpeg filter graph: keep the original audio as a bed under the narration.

    Both streams are first normalised to a common format. The original is held
    at `bed_volume` and *sidechain-compressed by the narration* -- so it dips
    automatically while the narration speaks and rises back to `bed_volume`
    during the pauses the anchored timeline preserves -- then mixed with the
    narration (kept at full level), with a limiter to stop the sum clipping."""
    return (
        "[0:a]aresample=48000,aformat=channel_layouts=stereo,"
        f"volume={bed_volume:.3f}[bed];"
        "[1:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[dub][sc];"
        "[bed][sc]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=350:makeup=1[ducked];"
        "[ducked][dub]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,"
        "alimiter=limit=0.98[aout]"
    )


def mux_duck_audio(video_path: Path, audio_path: Path, dst: Path, original_volume: float) -> None:
    """Output = the original audio kept as a music/ambience bed under the new
    narration, ducked under speech and swelling back in the pauses."""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path), "-i", str(audio_path),
        "-filter_complex", duck_filter_complex(original_volume),
        "-map", "0:v:0", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-shortest", str(dst),
    ]
    _run(cmd)
