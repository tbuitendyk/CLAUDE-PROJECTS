"""Offline text translation via Argos Translate.

Argos Translate is free, open-source (Apache-2.0) and runs entirely offline
once its language packages are installed (see deploy/install.sh), so there
are no API keys, rate limits or per-character costs.
"""
from __future__ import annotations

import logging
import threading

from .models import Segment

log = logging.getLogger(__name__)

_lock = threading.Lock()
_cache: dict[tuple[str, str], object] = {}


def _resolve(from_code: str, to_code: str):
    # Imported lazily (like the other heavy pipeline deps) so this module is
    # importable -- and unit-testable -- without argostranslate installed; the
    # import only matters when an actual translation is performed.
    import argostranslate.translate

    key = (from_code, to_code)
    if key in _cache:
        return _cache[key]

    languages = argostranslate.translate.get_installed_languages()
    by_code = {lang.code: lang for lang in languages}

    source = by_code.get(from_code) or by_code.get(from_code.split("-")[0])
    target = by_code.get(to_code) or by_code.get(to_code.split("-")[0])
    if not source or not target:
        raise RuntimeError(
            f"No Argos Translate language package installed for '{from_code}' -> '{to_code}'. "
            "Run `argos-translate-cli --update` / deploy/install.sh to install packages, "
            "or install via the argospm CLI: argospm install translate-{from}_{to}."
        )

    translation = source.get_translation(target)
    if translation is None:
        raise RuntimeError(
            f"Argos Translate has no direct or pivot path from '{from_code}' to '{to_code}'. "
            "Install an English pivot package pair, e.g. translate-{from}_en and translate-en_{to}."
        )

    _cache[key] = translation
    return translation


def clear_cache() -> None:
    """Drop the cached translation models when the worker goes idle. Each
    language pair is a separate CTranslate2 model held in memory, so an idle
    service can otherwise sit on several of them; they reload lazily."""
    with _lock:
        _cache.clear()


def translate_text(text: str, from_code: str, to_code: str) -> str:
    if from_code.split("-")[0] == to_code.split("-")[0]:
        return text
    translation = _resolve(from_code, to_code)
    with _lock:  # argostranslate's underlying CTranslate2 model isn't thread-safe
        return translation.translate(text)


def translate_segments(
    segments: list[Segment],
    from_code: str,
    to_code: str,
    on_progress: "Callable[[int, int], None] | None" = None,
) -> list[Segment]:
    """Translate each segment in turn. `on_progress`, if given, is called as
    (lines_done, lines_total) after each line -- translation runs entirely on
    the CPU line by line and is the whole of the transcript stage for caption-
    based videos, so surfacing it keeps the progress bar moving through it
    instead of sitting silent."""
    if from_code.split("-")[0] == to_code.split("-")[0]:
        return segments

    translated: list[Segment] = []
    total = len(segments)
    for index, seg in enumerate(segments, start=1):
        translated.append(Segment(start=seg.start, end=seg.end, text=translate_text(seg.text, from_code, to_code)))
        if on_progress is not None:
            try:
                on_progress(index, total)
            except Exception:  # noqa: BLE001 -- progress is best-effort
                pass
    return translated
