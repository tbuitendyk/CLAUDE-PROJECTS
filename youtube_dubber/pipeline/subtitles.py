"""Minimal WebVTT/SRT cue parser.

YouTube subtitles downloaded via yt-dlp arrive as WebVTT (or SRT). Both formats
share the same essential structure (a timecode line followed by one or more
text lines), so a single regex-based parser handles both without adding a
dependency.
"""
from __future__ import annotations

import re

from .models import Segment

_TIMECODE_RE = re.compile(
    r"(\d+):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[.,](\d{1,3})"
)
_TAG_RE = re.compile(r"</?[^>]+>")
_POSITIONING_RE = re.compile(r"^(NOTE|STYLE|Kind:|Language:).*", re.IGNORECASE)


def _to_seconds(h: str, m: str, s: str, frac: str) -> float:
    millis = int(frac.ljust(3, "0")[:3])
    return int(h) * 3600 + int(m) * 60 + int(s) + millis / 1000.0


def parse_cues(raw_text: str) -> list[Segment]:
    """Parse VTT/SRT text into a chronological, de-duplicated list of segments."""
    segments: list[Segment] = []
    lines = raw_text.splitlines()

    i = 0
    while i < len(lines):
        match = _TIMECODE_RE.search(lines[i])
        if not match:
            i += 1
            continue

        start = _to_seconds(*match.groups()[0:4])
        end = _to_seconds(*match.groups()[4:8])

        i += 1
        text_lines: list[str] = []
        while i < len(lines) and lines[i].strip() and not _TIMECODE_RE.search(lines[i]):
            line = lines[i].strip()
            if not _POSITIONING_RE.match(line):
                line = _TAG_RE.sub("", line)
                if line:
                    text_lines.append(line)
            i += 1

        text = " ".join(text_lines).strip()
        if text and end > start:
            segments.append(Segment(start=start, end=end, text=text))

    return _merge_overlaps(_dedupe(segments))


def _dedupe(segments: list[Segment]) -> list[Segment]:
    """YouTube auto-captions repeat the trailing words of the previous cue
    (rolling captions). Drop cues that are pure substrings/duplicates of the
    immediately preceding one to avoid synthesizing the same words twice."""
    cleaned: list[Segment] = []
    for seg in segments:
        if cleaned and (seg.text == cleaned[-1].text or cleaned[-1].text.endswith(seg.text)):
            continue
        if cleaned and seg.text.startswith(cleaned[-1].text):
            cleaned[-1] = Segment(start=cleaned[-1].start, end=seg.end, text=seg.text)
            continue
        cleaned.append(seg)
    return cleaned


def _merge_overlaps(segments: list[Segment]) -> list[Segment]:
    """Clip cues so that segment[i].end <= segment[i+1].start, preserving order.
    Rolling auto-captions often overlap by design; downstream timing math
    assumes non-overlapping windows."""
    fixed: list[Segment] = []
    for seg in segments:
        if fixed and seg.start < fixed[-1].end:
            seg = Segment(start=fixed[-1].end, end=max(seg.end, fixed[-1].end + 0.05), text=seg.text)
        if seg.end > seg.start:
            fixed.append(seg)
    return fixed
