"""Minimal WebVTT/SRT cue parser.

YouTube subtitles downloaded via yt-dlp arrive as WebVTT (or SRT). Both formats
share the same essential structure (a timecode line followed by one or more
text lines), so a single regex-based parser handles both without adding a
dependency.
"""
from __future__ import annotations

import re
import string

from .models import Segment

_TIMECODE_RE = re.compile(
    r"(\d+):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[.,](\d{1,3})"
)
_TAG_RE = re.compile(r"</?[^>]+>")
_POSITIONING_RE = re.compile(r"^(NOTE|STYLE|Kind:|Language:).*", re.IGNORECASE)
# YouTube auto-captions denote non-speech audio events ("[Music]", "[Applause]",
# "[inaudible]", ...) with bracketed tags. They aren't spoken words -- left in,
# they get translated ("[música]") and read aloud verbatim by the TTS voice.
_SOUND_DESCRIPTOR_RE = re.compile(r"\[[^\]]*\]")


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
                line = _SOUND_DESCRIPTOR_RE.sub("", line).strip()
                if line:
                    text_lines.append(line)
            i += 1

        text = " ".join(text_lines).strip()
        if text and end > start:
            segments.append(Segment(start=start, end=end, text=text))

    return _merge_overlaps(_dedupe(segments))


def _norm_word(word: str) -> str:
    return word.lower().strip(string.punctuation)


def _word_overlap(prev_words: list[str], next_words: list[str]) -> int:
    """Length of the longest run where the tail of `prev_words` equals the
    head of `next_words` (case/punctuation-insensitive) -- i.e. how many of
    the next cue's leading words are just a repeat of the previous cue's
    trailing words."""
    max_k = min(len(prev_words), len(next_words))
    for k in range(max_k, 0, -1):
        if [_norm_word(w) for w in prev_words[-k:]] == [_norm_word(w) for w in next_words[:k]]:
            return k
    return 0


def _dedupe(segments: list[Segment]) -> list[Segment]:
    """YouTube's rolling auto-captions show a sliding window of the spoken
    text, so consecutive cues commonly share a chunk of words -- e.g. one cue
    ends "...comes from Martin Luther." and the next begins "today comes from
    Martin Luther. He invented...". Strip however many of each cue's leading
    words are just a repeat of the previous cue's tail, keeping only the new
    words, so the synthesized narration doesn't say everything twice."""
    cleaned: list[Segment] = []
    for seg in segments:
        if not cleaned:
            cleaned.append(seg)
            continue
        prev = cleaned[-1]
        prev_words = prev.text.split()
        seg_words = seg.text.split()
        overlap = _word_overlap(prev_words, seg_words)
        remainder = seg_words[overlap:]
        if not remainder:
            # This cue is wholly contained in the previous cue's tail --
            # extend its time range rather than adding an empty/duplicate cue.
            cleaned[-1] = Segment(start=prev.start, end=max(prev.end, seg.end), text=prev.text)
        else:
            cleaned.append(Segment(start=seg.start, end=seg.end, text=" ".join(remainder)))
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
