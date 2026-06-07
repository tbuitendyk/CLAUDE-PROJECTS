"""Shared data structures passed between pipeline stages."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Segment:
    """A single timed line of speech (subtitle cue or transcribed utterance)."""

    start: float  # seconds
    end: float    # seconds
    text: str

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass
class VideoInfo:
    id: str
    title: str
    description: str
    duration: float
    original_language: str | None
    video_path: str
