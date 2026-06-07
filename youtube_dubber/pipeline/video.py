"""Combine the source video with the freshly synthesized Spanish narration."""
from __future__ import annotations

from pathlib import Path

from . import ffmpeg_utils


def mux(video_path: Path, narration_path: Path, out_path: Path, mode: str, duck_volume: float) -> Path:
    if mode == "duck":
        ffmpeg_utils.mux_duck_audio(video_path, narration_path, out_path, duck_volume)
    else:
        ffmpeg_utils.mux_replace_audio(video_path, narration_path, out_path)
    return out_path
