"""Tests for the linguistically-aware rechunker.

Run: python -m pytest tests/test_rechunker.py   (needs spaCy + en_core_web_sm
for the spaCy-path tests; those skip cleanly if the model isn't installed).
"""
from __future__ import annotations

import re

import pytest

from youtube_dubber.pipeline.models import Segment
from youtube_dubber.pipeline import rechunker
from youtube_dubber.pipeline.rechunker import TimedWord


# --- helpers ---------------------------------------------------------------
def words_from_reference(reference: str, wps: float = 0.45,
                         sentence_pause: float = 0.7, clause_pause: float = 0.35):
    """Turn a *punctuated* reference sentence into a stream of TimedWords that
    mimics raw ASR output: punctuation/casing stripped, but with realistic
    silences left where sentence/clause boundaries were -- exactly the signal
    the heuristic restorer is meant to recover."""
    words = []
    t = 0.0
    for raw in reference.split():
        bare = re.sub(r"[^\w']", "", raw).lower()
        if not bare:
            continue
        words.append(TimedWord(start=t, end=t + wps, text=bare))
        t += wps
        if re.search(r"[.!?]$", raw):
            t += sentence_pause
        elif re.search(r"[,;:]$", raw):
            t += clause_pause
    return words


def durations(segs):
    return [round(s.end - s.start, 1) for s in segs]


# --- pure timing/assembly logic (no spaCy needed) --------------------------
def test_interpolation_covers_segment_span():
    segs = [Segment(0.0, 4.0, "one two three four")]
    words = rechunker.words_from_segments(segs)
    assert len(words) == 4
    assert words[0].start == 0.0
    assert words[-1].end == 4.0  # snapped to segment end


def test_no_breaks_still_cuts_within_hard_window():
    # 60s of evenly spaced words, zero punctuation/pauses -> must still cut.
    words = [TimedWord(i * 0.5, i * 0.5 + 0.5, f"w{i}") for i in range(120)]
    score = [rechunker._NONE] * len(words)
    spans = rechunker._assemble(words, score, 3.0, 11.0, 20.0, 4.0)
    for s, e in spans:
        assert words[e].end - words[s].start <= 20.0 + 1e-6


def test_big_gap_forces_a_cut():
    words = [TimedWord(i * 0.5, i * 0.5 + 0.5, f"w{i}") for i in range(10)]
    # 6s silence after word 4
    for k in range(5, 10):
        words[k] = TimedWord(words[k].start + 6.0, words[k].end + 6.0, f"w{k}")
    score = [rechunker._NONE] * len(words)
    spans = rechunker._assemble(words, score, 3.0, 11.0, 20.0, 4.0)
    assert spans[0] == (0, 4)  # cut right before the silence


def test_discourse_openers_segment_a_run_on_with_no_pauses():
    # A fast speaker: zero pauses between words, no punctuation -- the pause
    # rules alone would find nothing. "okay" (a strong opener) must still start
    # a new sentence; the period lands on the word before it.
    text = "luther was a monk okay so he had a crisis"
    words = [TimedWord(i * 0.4, i * 0.4 + 0.4, t) for i, t in enumerate(text.split())]
    restored = rechunker.restore_punctuation(words)
    joined = " ".join(w.text for w in restored)
    assert "monk." in joined          # sentence broken before "okay"
    assert "Okay" in joined           # opener capitalised as a new sentence start
    assert restored[0].text == "Luther"  # first word always capitalised


def test_midsentence_opener_word_not_oversplit():
    # "now" here is mid-phrase ("right now"), with no pause -> must NOT break.
    text = "he is leaving right now for the church"
    words = [TimedWord(i * 0.4, i * 0.4 + 0.4, t) for i, t in enumerate(text.split())]
    restored = rechunker.restore_punctuation(words)
    joined = " ".join(w.text for w in restored)
    assert "right. Now" not in joined and "right, Now" not in joined


def test_tiny_chunk_merges_back():
    words = [TimedWord(i * 1.0, i * 1.0 + 1.0, f"w{i}") for i in range(5)]
    score = [rechunker._NONE] * 5
    score[3] = rechunker._SENTENCE  # would cut at 4.0s leaving a 1s tail
    spans = rechunker._assemble(words, score, 3.0, 11.0, 20.0, 4.0)
    assert spans == [(0, 4)]  # tail folded back in


# --- end-to-end with the heuristic restorer + spaCy ------------------------
HAVE_SPACY = rechunker._load_nlp("en") is not None
needs_spacy = pytest.mark.skipif(not HAVE_SPACY, reason="en_core_web_sm not installed")

# The user's actual transcript text (from the preview screenshots), with
# punctuation added back as ground truth for the simulator to strip.
REFERENCE = (
    "Martin Luther started the protestant reformation in the early 16th century. "
    "The story goes, Luther nailed his 95 theses to the wittenberg church door, "
    "and he launched the reformation. What he was actually doing was just routine "
    "to stimulate a scholarly debate, but what happened was the 95 theses were "
    "translated into german and distributed among the people. "
    "In the protestant tradition, our question here today is, did Luther return "
    "to new testament christianity, or did the reformation return us to new "
    "testament christianity? Augustine had a Gnostic background himself, and "
    "although he initially rejected christianity, at the age of 20 he embraced "
    "the religion of manichaeism."
)


@needs_spacy
def test_chunks_break_at_thought_boundaries():
    words = words_from_reference(REFERENCE)
    segs = rechunker.chunk([], language="en", words=words)

    # Every chunk sits inside the size band (allow small float slack).
    for d in durations(segs):
        assert d <= rechunker.TARGET_HARD + 1.0, durations(segs)
        assert d >= rechunker.TARGET_MIN - 0.5

    # Chunks should end on sentence-final or clause punctuation, not mid-word.
    enders = sum(1 for s in segs if re.search(r"[.,;:!?]$", s.text))
    assert enders >= max(1, len(segs) - 1), [s.text for s in segs]

    # The restorer should have recovered capitalisation + terminal periods.
    full = " ".join(s.text for s in segs)
    assert full[0].isupper()
    assert full.count(".") >= 3


@needs_spacy
def test_does_not_clobber_existing_punctuation():
    # Already-punctuated input (manual captions) should keep its own marks.
    segs_in = [
        Segment(0.0, 6.0, "Bienvenidos a todos."),
        Segment(6.0, 12.0, "Hoy vamos a hablar de la reforma protestante."),
    ]
    out = rechunker.chunk(segs_in, language="es")
    joined = " ".join(s.text for s in out)
    assert "Bienvenidos a todos." in joined


@needs_spacy
def test_empty_input():
    assert rechunker.chunk([], language="en") == []
    assert rechunker.chunk([], language="en", words=[]) == []


if __name__ == "__main__":
    # Convenience: show the actual chunking of the reference transcript.
    if not HAVE_SPACY:
        print("en_core_web_sm not installed; spaCy-path demo skipped.")
    words = words_from_reference(REFERENCE)
    segs = rechunker.chunk([], language="en", words=words)
    print(f"\n{len(segs)} chunks from the reference transcript:\n")
    for s in segs:
        print(f"  [{s.start:5.1f}-{s.end:5.1f}  {s.end-s.start:4.1f}s] {s.text}")
