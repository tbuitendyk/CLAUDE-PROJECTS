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
    # Path to the source video's downloaded thumbnail image, if one was saved
    # (used to brand and reuse it for the dub). None if unavailable.
    thumbnail_path: str | None = None


@dataclass
class TextRegion:
    """A single run of text localized in an image: the reusable contract handed
    from detection/recognition (ocr_onnx.py) to the translate -> remove ->
    re-render steps (image_text.py).

    The thumbnail's in-place text localisation is the *first* consumer of this
    shape. It is deliberately the same shape a future in-video text pass would
    use -- there, a tracker would carry one of these across the frames of a shot
    so the text is only recognised/translated once and re-rendered consistently.
    Keeping the geometry as a polygon (not just a box) is what makes that
    future tracking/perspective work possible; today's thumbnail renderer just
    uses the axis-aligned `bbox`, since title text is almost always horizontal.
    """

    # Detector output: 4+ (x, y) points in the detector's order. Image pixels.
    polygon: list[tuple[float, float]]
    # Recognizer output and its confidence (0..1).
    text: str
    confidence: float = 1.0
    # Appearance estimated from the surrounding pixels at render time and kept
    # here so a caller -- or a video tracker reusing the region across frames --
    # can reason about or override how the replacement text is drawn.
    fill_color: tuple[int, int, int] | None = None    # the (translated) text colour
    stroke_color: tuple[int, int, int] | None = None   # outline drawn for contrast

    @property
    def bbox(self) -> tuple[int, int, int, int]:
        """Axis-aligned (x0, y0, x1, y1) bounds of the polygon, integer pixels."""
        xs = [p[0] for p in self.polygon]
        ys = [p[1] for p in self.polygon]
        return (int(min(xs)), int(min(ys)), int(round(max(xs))), int(round(max(ys))))
