"""Linguistically-aware rechunking of a transcript into natural "thought units".

The old approach (see transcript.merge_segments) globbed caption/Whisper cues
into ~15s blocks and decided sentence/clause boundaries purely from the length
of the *silence* between cues -- a speaker pausing for breath mid-clause forced
a false break, and two sentences run together became one giant run-on. That is
exactly what makes a dub need hours of hand-editing.

This module instead breaks where the *language* says a thought ends:

  1. Restore punctuation/casing when the source lacks it (auto-generated
     captions and, in practice, a lot of Whisper output arrive as an
     unbroken lowercase stream). The restorer here is a dependency-free
     heuristic driven by *word-level* pauses (much finer than the old
     per-cue gaps) plus light capitalisation. `restore_with_model` leaves a
     hook to swap in a transformer punctuation model later without touching
     anything else.
  2. Find sentence and clause boundaries with spaCy (real dependency-parse
     boundaries: sentence ends, coordinating/subordinating conjunctions,
     commas, and a few spoken-language discourse markers).
  3. Assemble chunks greedily within a duration window so breaks land on the
     strongest available boundary -- a complete sentence when one falls in
     range, else a clause -- while keeping each chunk in a TTS-friendly size
     band (merging tiny ones, splitting over-long ones at clauses).

Every stage degrades gracefully: no spaCy model for the language -> fall back
to punctuation-only boundaries; nothing punctuated at all -> the duration
window still keeps chunks sane. So this never makes the pipeline *worse* than
the old merge, only better when the linguistic signal is available.
"""
from __future__ import annotations

import logging
import re
from bisect import bisect_right
from dataclasses import dataclass

from .models import Segment

log = logging.getLogger(__name__)

# --- Chunk-size band (seconds). Cut at a sentence as soon as the chunk is at
# least *_MIN; once past *_SOFT a clause break is good enough; never run past
# *_HARD without forcing a cut. Tuned so narration breathes at thought
# boundaries while staying in a range edge-tts can time-fit comfortably. ---
TARGET_MIN = 3.0
TARGET_SOFT = 11.0
TARGET_HARD = 20.0
# Never bridge a silence longer than this (musical interlude, scene change).
MAX_GAP = 4.0

# Break strengths (higher = better place to end a chunk).
_SENTENCE = 4
_CLAUSE = 3
_NONE = 0

# Word-level pause thresholds used to *infer* punctuation when the source has
# none. Finer-grained than the old per-cue values because Whisper word
# timestamps expose the real gap between individual words.
_SENTENCE_PAUSE = 0.55
_CLAUSE_PAUSE = 0.28

# A clear breath to fall back on when an un-punctuated run-on must be cut and no
# sentence/clause boundary is available: cut at the longest such pause in the
# window rather than at an arbitrary word.
_BREATH_PAUSE = 0.35
# A stretch of speech this long with no punctuation at all is treated as a
# run-on the source failed to segment; augment_runon_punctuation fills in marks
# from word pauses inside it (and only inside it).
_RUNON_SECONDS = 8.0

_SENTENCE_END_RE = re.compile(r"[.!?…][\"')\]]?$")
_CLAUSE_END_RE = re.compile(r"[,;:][\"')\]]?$")
_ANY_TERMINAL = ".,;:!?…"

# Spoken-language openers that almost always start a fresh thought in lectures
# and sermons ("okay so...", "now what happened was...", "alright let's...").
_DISCOURSE_OPENERS = {
    "okay", "ok", "so", "now", "well", "alright", "anyway", "anyhow",
    "basically", "look", "see", "right", "listen",
}

# A subset that is almost never mid-sentence -- safe to treat as a sentence
# start even with no pause at all (the key signal for a fast, low-pause speaker
# the pause-based rules can't otherwise segment). The rest of _DISCOURSE_OPENERS
# ("so", "now", "well", "right"...) DO occur mid-sentence ("right now", "he was
# so angry"), so they only force a break when a small real pause backs them up.
_STRONG_OPENERS = {"okay", "ok", "alright", "allright", "anyway", "anyhow"}
_OPENER_MIN_PAUSE = 0.12


@dataclass
class TimedWord:
    start: float
    end: float
    text: str


# --------------------------------------------------------------------------
# Word stream construction
# --------------------------------------------------------------------------
def words_from_segments(segments: list[Segment]) -> list[TimedWord]:
    """Explode segments into per-word tokens, distributing each segment's time
    span across its words in proportion to their length.

    Used for caption sources (and as a fallback) where we only have cue-level
    timing -- it lets the chunker cut *inside* a cue at a thought boundary
    instead of being locked to cue edges. Whisper supplies real per-word times
    instead (see speech_to_text.transcribe), which are preferred when present.
    """
    words: list[TimedWord] = []
    for seg in segments:
        tokens = seg.text.split()
        if not tokens:
            continue
        span = max(0.0, seg.end - seg.start)
        total_chars = sum(len(t) for t in tokens) or 1
        t = seg.start
        for tok in tokens:
            frac = len(tok) / total_chars
            dur = span * frac
            words.append(TimedWord(start=t, end=t + dur, text=tok))
            t += dur
        # snap the last word's end to the segment end (rounding drift)
        if words:
            words[-1] = TimedWord(words[-1].start, seg.end, words[-1].text)
    return words


# --------------------------------------------------------------------------
# Punctuation restoration
# --------------------------------------------------------------------------
def _punctuation_density(words: list[TimedWord]) -> float:
    """Sentence-ending marks per word -- a cheap proxy for 'is this already
    punctuated?'. Well-punctuated prose sits around 0.05-0.12 (a sentence
    every 8-20 words); near-zero means an unbroken ASR/caption stream."""
    if not words:
        return 1.0
    ends = sum(1 for w in words if _SENTENCE_END_RE.search(w.text))
    return ends / len(words)


def restore_punctuation(words: list[TimedWord]) -> list[TimedWord]:
    """Infer sentence/clause punctuation and basic casing from word-level
    pauses, in place of a heavy ML restorer.

    Only applied when the stream looks under-punctuated, so we never clobber
    punctuation a caption track or Whisper already provided. Two signals drive
    it: (1) a gap longer than `_SENTENCE_PAUSE` after a word -> sentence end
    (period + next word capitalised), a shorter-but-notable gap -> clause break
    (comma); and (2) a following discourse opener ("okay", "alright", "so",
    "now"...) -> sentence end *without* needing a pause, which is what lets a
    fast, run-on speaker (who gives the pause rules nothing to work with) still
    get segmented. It's not a grammar model, but it gives spaCy real anchors to
    find boundaries downstream.
    """
    out: list[TimedWord] = []
    start_of_sentence = True
    n = len(words)
    for idx, w in enumerate(words):
        text = w.text
        if start_of_sentence and text[:1].islower():
            text = text[:1].upper() + text[1:]

        ends_sentence = False
        if text[-1:] not in _ANY_TERMINAL:
            gap = (words[idx + 1].start - w.end) if idx + 1 < n else _SENTENCE_PAUSE
            nxt = words[idx + 1].text.lower().strip(_ANY_TERMINAL) if idx + 1 < n else ""
            opener_break = nxt in _STRONG_OPENERS or (
                nxt in _DISCOURSE_OPENERS and gap >= _OPENER_MIN_PAUSE
            )
            if gap >= _SENTENCE_PAUSE or opener_break:
                text += "."
                ends_sentence = True
            elif gap >= _CLAUSE_PAUSE:
                text += ","
        else:
            ends_sentence = bool(_SENTENCE_END_RE.search(text))

        out.append(TimedWord(start=w.start, end=w.end, text=text))
        start_of_sentence = ends_sentence
    return out


def _normalize_word(s: str) -> str:
    # Strip sentencepiece special tokens (e.g. <unk> for hyphens/OOV chars)
    # before comparing, so "co<unk>bishop," and "co-bishop" both reduce to
    # "cobishop" and don't trigger a false alignment-drift fallback.
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"[^a-z]", "", s.lower())


def restore_with_model(words: list[TimedWord]) -> "list[TimedWord] | None":
    """Restore punctuation/casing with the grammar-based ONNX model (CPU, no
    torch -- see punctuation_onnx), mapping the result back onto the original
    word timings.

    Returns a new TimedWord list (same timings, restored text) or None if the
    model is disabled/unavailable, or if the restored token stream doesn't line
    up 1:1 with the input -- in which case the caller falls back to the pause/
    opener heuristic. Never raises into the pipeline.
    """
    if not words:
        return None
    try:
        from . import punctuation_onnx

        sentences = punctuation_onnx.restore_sentences(" ".join(w.text for w in words))
    except Exception:  # pragma: no cover - defensive; model path must never break the run
        return None
    if not sentences:
        return None

    # Flatten to (token, is_last_word_of_sentence). The model keeps word order
    # and the words themselves -- it only adds punctuation/casing and sentence
    # splits -- so this should align 1:1 with `words`.
    out_words: list[tuple[str, bool]] = []
    for sent in sentences:
        toks = sent.split()
        for i, tok in enumerate(toks):
            out_words.append((tok, i == len(toks) - 1))

    if len(out_words) != len(words):
        log.info(
            "Punctuation model produced %d words vs %d input; falling back to heuristic.",
            len(out_words), len(words),
        )
        return None

    restored: list[TimedWord] = []
    for w, (tok, is_sentence_end) in zip(words, out_words):
        if _normalize_word(tok) != _normalize_word(w.text):
            log.info("Punctuation model alignment drift (%r vs %r); falling back to heuristic.", tok, w.text)
            return None
        text = tok
        # Guarantee the boundary the model intended is visible to break_scores.
        if is_sentence_end and text[-1:] not in _ANY_TERMINAL:
            text += "."
        restored.append(TimedWord(start=w.start, end=w.end, text=text))
    log.info("Punctuation model restored %d words into %d sentences.", len(words), len(sentences))
    return restored


def augment_runon_punctuation(words: list[TimedWord]) -> list[TimedWord]:
    """Fill sentence/clause punctuation into long *un-punctuated run-ons* only,
    leaving already-punctuated regions exactly as the source produced them.

    Whisper usually punctuates well, but on a fast speaker it occasionally emits
    a long unbroken stretch with no marks at all. Globally the transcript still
    looks well-punctuated, so the full restorer (gated on overall density) never
    runs -- yet that one stretch gives the boundary detector nothing to grab, so
    it gets force-cut mid-thought. Here we find each span between existing marks
    that runs longer than `_RUNON_SECONDS` and, *within that span only*, add a
    period at sentence-length pauses (capitalising what follows) or before a
    strong discourse opener, and a comma at shorter notable pauses. It never
    touches a word that already carries punctuation, so well-formed output is
    preserved.
    """
    n = len(words)
    if n == 0:
        return words
    out = [TimedWord(w.start, w.end, w.text) for w in words]

    # Words that already end a sentence/clause split the stream into runs; a run
    # longer than the threshold is a run-on we augment between its endpoints.
    marks = [-1] + [i for i, w in enumerate(words) if w.text[-1:] in _ANY_TERMINAL] + [n - 1]
    for a, b in zip(marks, marks[1:]):
        run_start, run_last = a + 1, b
        if run_start >= run_last:
            continue
        if words[run_last].end - words[run_start].start < _RUNON_SECONDS:
            continue
        for idx in range(run_start, run_last):  # never touch the marked word at b
            w = out[idx]
            if w.text[-1:] in _ANY_TERMINAL:
                continue
            gap = words[idx + 1].start - words[idx].end
            nxt = words[idx + 1].text.lower().strip(_ANY_TERMINAL)
            if gap >= _SENTENCE_PAUSE or nxt in _STRONG_OPENERS:
                out[idx] = TimedWord(w.start, w.end, w.text + ".")
                follow = out[idx + 1]
                if follow.text[:1].islower():
                    out[idx + 1] = TimedWord(
                        follow.start, follow.end, follow.text[:1].upper() + follow.text[1:]
                    )
            elif gap >= _CLAUSE_PAUSE:
                out[idx] = TimedWord(w.start, w.end, w.text + ",")
    return out


# --------------------------------------------------------------------------
# Boundary detection (spaCy when available, else punctuation-only)
# --------------------------------------------------------------------------
_NLP_CACHE: dict[str, object] = {}
_SPACY_MODELS = {"en": "en_core_web_sm", "es": "es_core_news_sm"}


def _load_nlp(language: str | None):
    """Lazily load (and cache) a small spaCy model for the source language.
    Returns None when spaCy or the model isn't installed -- callers then fall
    back to punctuation-only boundary detection."""
    if not language:
        return None
    lang = language.split("-")[0].lower()
    model = _SPACY_MODELS.get(lang)
    if model is None:
        return None
    if lang in _NLP_CACHE:
        return _NLP_CACHE[lang]
    nlp = None
    try:
        import spacy

        # Only the parser/senter is needed for boundaries; dropping NER keeps
        # it fast on long transcripts.
        nlp = spacy.load(model, disable=["ner", "lemmatizer"])
    except Exception as exc:  # ImportError or model-not-found
        log.info("spaCy model '%s' unavailable (%s); using punctuation-only boundaries.", model, exc)
    _NLP_CACHE[lang] = nlp
    return nlp


def _word_char_spans(words: list[TimedWord]) -> tuple[str, list[int]]:
    """Join words into one text and record the starting char offset of each
    word, so spaCy token offsets can be mapped back to word indices."""
    starts: list[int] = []
    pos = 0
    parts = []
    for i, w in enumerate(words):
        if i:
            pos += 1  # the single joining space
        starts.append(pos)
        parts.append(w.text)
        pos += len(w.text)
    return " ".join(parts), starts


def break_scores(words: list[TimedWord], language: str | None) -> list[int]:
    """Score the boundary *after* each word: _SENTENCE, _CLAUSE or _NONE.

    Uses spaCy's sentence + dependency boundaries when a model is available,
    and always folds in punctuation already present in the word text. Falls
    back to punctuation-only scoring otherwise.
    """
    n = len(words)
    score = [_NONE] * n
    if n == 0:
        return score

    # Punctuation carried by the words themselves (covers the no-spaCy path and
    # reinforces the spaCy path).
    for i, w in enumerate(words):
        if _SENTENCE_END_RE.search(w.text):
            score[i] = _SENTENCE
        elif _CLAUSE_END_RE.search(w.text):
            score[i] = max(score[i], _CLAUSE)

    nlp = _load_nlp(language)
    if nlp is None:
        return score

    text, starts = _word_char_spans(words)

    def word_at(char_idx: int) -> int:
        # rightmost word whose start <= char_idx
        return max(0, bisect_right(starts, char_idx) - 1)

    try:
        doc = nlp(text)
    except Exception as exc:  # pragma: no cover - defensive
        log.warning("spaCy parse failed (%s); using punctuation-only boundaries.", exc)
        return score

    # Sentence ends -> strong break after the sentence's last real token.
    for sent in doc.sents:
        last = None
        for tok in sent:
            if not tok.is_space:
                last = tok
        if last is not None:
            score[word_at(last.idx)] = _SENTENCE

    # Clause starts -> break *before* the conjunction/marker (i.e. after the
    # previous word). Discourse openers at a sentence start get the same.
    for tok in doc:
        is_clause_start = tok.dep_ in ("cc", "mark", "preconj")
        is_opener = tok.is_sent_start and tok.lower_ in _DISCOURSE_OPENERS
        if not (is_clause_start or is_opener):
            continue
        wi = word_at(tok.idx)
        if wi > 0 and score[wi - 1] < _CLAUSE:
            score[wi - 1] = _CLAUSE
    return score


# --------------------------------------------------------------------------
# Greedy duration-windowed assembly
# --------------------------------------------------------------------------
def _assemble(words, score, target_min, target_soft, target_hard, max_gap):
    """Walk the words, cutting at the best boundary available within the size
    band. Returns a list of (start_idx, end_idx) inclusive spans."""
    n = len(words)
    spans: list[tuple[int, int]] = []
    start = 0
    i = 0
    best_clause = None       # latest clause-or-better break seen, as a fallback cut
    best_gap_idx = None      # word before the longest pause seen, as a last resort
    best_gap_size = 0.0
    while i < n:
        dur = words[i].end - words[start].start
        sc = score[i]
        next_gap = (words[i + 1].start - words[i].end) if i + 1 < n else float("inf")
        big_gap = next_gap > max_gap  # a long silence is a hard boundary, any size

        # Remember the longest inter-word pause once the chunk is big enough to
        # end: for an un-punctuated run-on with no sentence/clause boundary, a
        # breath is a far more natural cut than an arbitrary word at the limit.
        if i + 1 < n and dur >= target_min and next_gap > best_gap_size:
            best_gap_size = next_gap
            best_gap_idx = i

        cut = None
        if sc >= _SENTENCE and dur >= target_min:
            cut = i                                   # natural sentence end
        elif sc >= _CLAUSE and dur >= target_soft:
            cut = i                                   # clause end, already full enough
        elif big_gap:
            cut = i                                   # never bridge a long silence
        elif dur >= target_hard or i == n - 1:
            if best_clause is not None and best_clause >= start:
                cut = best_clause                     # fall back to a clause break
            elif best_gap_idx is not None and best_gap_idx >= start and best_gap_size >= _BREATH_PAUSE:
                cut = best_gap_idx                    # else cut at the longest breath
            else:
                cut = i                               # else an arbitrary hard cut

        if cut is None:
            if sc >= _CLAUSE and dur >= target_min:
                best_clause = i
            i += 1
            continue

        spans.append((start, cut))
        start = cut + 1
        i = cut + 1
        best_clause = None
        best_gap_idx = None
        best_gap_size = 0.0
    return _merge_short(spans, words, target_min, target_hard, max_gap)


def _merge_short(spans, words, target_min, target_hard, max_gap):
    """Fold any sub-`target_min` chunk into the neighbour that keeps the result
    smallest and still within `target_hard` -- but never across a silence longer
    than `max_gap` (that gap is a real boundary we must not bridge)."""
    spans = list(spans)

    def gap_between(a, b):  # silence between span a (earlier) and span b (later)
        return words[spans[b][0]].start - words[spans[a][1]].end

    j = 0
    while j < len(spans):
        s, e = spans[j]
        if words[e].end - words[s].start >= target_min or len(spans) == 1:
            j += 1
            continue
        prev_ok = j > 0 and gap_between(j - 1, j) <= max_gap
        next_ok = j < len(spans) - 1 and gap_between(j, j + 1) <= max_gap
        prev_len = (words[e].end - words[spans[j - 1][0]].start) if prev_ok else float("inf")
        next_len = (words[spans[j + 1][1]].end - words[s].start) if next_ok else float("inf")
        if prev_len <= next_len and prev_len <= target_hard:
            spans[j - 1] = (spans[j - 1][0], e)
            del spans[j]
            j = max(0, j - 1)
        elif next_len <= target_hard:
            spans[j + 1] = (s, spans[j + 1][1])
            del spans[j]
        else:
            j += 1  # can't merge without bridging a gap or going oversize; leave it
    return spans


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------
def chunk(
    segments: list[Segment],
    language: str | None = None,
    words: list[TimedWord] | None = None,
    target_min: float = TARGET_MIN,
    target_soft: float = TARGET_SOFT,
    target_hard: float = TARGET_HARD,
    max_gap: float = MAX_GAP,
) -> list[Segment]:
    """Rechunk `segments` into natural thought units.

    `language` is the source language code (selects the spaCy model). `words`,
    when given (Whisper word timestamps), supplies precise per-word timing;
    otherwise timing is interpolated across each segment.
    """
    if not segments and not words:
        return []

    stream = list(words) if words else words_from_segments(segments)
    if not stream:
        return []

    if _punctuation_density(stream) < 0.02:
        restored = restore_with_model(stream)
        stream = restored if restored is not None else restore_punctuation(stream)

    # Fill punctuation into any long un-punctuated run-on the source left behind
    # (common with Whisper on a fast speaker) so the boundary detector has marks
    # to cut on there too; a no-op on already-punctuated stretches.
    stream = augment_runon_punctuation(stream)

    score = break_scores(stream, language)
    spans = _assemble(stream, score, target_min, target_soft, target_hard, max_gap)

    out: list[Segment] = []
    for idx, (s, e) in enumerate(spans):
        text = " ".join(w.text for w in stream[s:e + 1]).strip()
        if not text:
            continue
        # Guarantee every chunk ends on a mark so the translator/TTS get a clean
        # prosodic boundary: a period when the cut is a real sentence end (or a
        # long silence follows, or it's the final chunk), otherwise a comma to
        # signal the thought continues into the next chunk.
        if text[-1] not in _ANY_TERMINAL:
            is_last = idx == len(spans) - 1
            gap_after = float("inf") if is_last else stream[spans[idx + 1][0]].start - stream[e].end
            ends_sentence = score[e] >= _SENTENCE or gap_after >= _SENTENCE_PAUSE or is_last
            text += "." if ends_sentence else ","
        out.append(Segment(start=stream[s].start, end=stream[e].end, text=text))
    return out
