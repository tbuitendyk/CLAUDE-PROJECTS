"""Combine the source video with the freshly synthesized Spanish narration."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from . import ffmpeg_utils


def mux(
    video_path: Path,
    narration_path: Path,
    out_path: Path,
    mode: str,
    duck_volume: float,
    bed_path: Optional[Path] = None,
) -> Path:
    """Mux the narration onto the video per `mode`:

    - "music": lay the narration over `bed_path` (the speech-removed music+SFX
      bed). Falls back to "replace" if no bed was produced (separation off/failed).
    - "duck": keep the *original* audio as a bed, sidechain-ducked under speech.
    - else ("replace"): the narration is the only audio.
    """
    if mode == "music" and bed_path is not None:
        ffmpeg_utils.mux_music_bed(video_path, narration_path, bed_path, out_path, duck_volume)
    elif mode == "duck":
        ffmpeg_utils.mux_duck_audio(video_path, narration_path, out_path, duck_volume)
    else:
        ffmpeg_utils.mux_replace_audio(video_path, narration_path, out_path)
    return out_path
