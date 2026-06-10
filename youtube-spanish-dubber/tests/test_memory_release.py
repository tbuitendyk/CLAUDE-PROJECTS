"""Tests for the per-stage memory-release hooks that keep a single dub's heavy
models from stacking (and pushing the resident set past the cgroup throttle).

These cover the dependency-free leaf modules; the full transcript-stage
orchestration that calls them needs faster-whisper / argostranslate installed
and is exercised end to end, not here.
"""
from __future__ import annotations

from youtube_dubber import memory
from youtube_dubber.pipeline import punctuation_onnx, rechunker


def test_release_to_os_is_safe_to_call():
    # gc.collect + malloc_trim; must never raise (malloc_trim is best-effort on
    # non-glibc hosts).
    memory.release_to_os()


def test_rechunker_release_models_clears_spacy_cache():
    # The spaCy NLP cache had no release hook before -- it leaked across jobs and
    # idle. release_models() must empty it (models reload lazily on next chunk).
    rechunker._NLP_CACHE["en"] = object()
    rechunker._NLP_CACHE["es"] = object()
    rechunker.release_models()
    assert rechunker._NLP_CACHE == {}


def test_punctuation_release_model_drops_the_session():
    punctuation_onnx._model = object()
    punctuation_onnx.release_model()
    assert punctuation_onnx._model is None


def test_punctuation_release_keeps_a_failed_load_flagged():
    # A previously failed load is left flagged so the worker doesn't retry the
    # (expensive, doomed) download every idle cycle -- releasing must not reset it.
    punctuation_onnx._model = None
    punctuation_onnx._load_failed = True
    try:
        punctuation_onnx.release_model()
        assert punctuation_onnx._load_failed is True
    finally:
        punctuation_onnx._load_failed = False
