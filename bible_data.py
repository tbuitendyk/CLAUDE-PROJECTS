"""KJV Bible data loader and fuzzy verse search."""

import json
import re
from pathlib import Path

try:
    from rapidfuzz import fuzz, process as rfprocess
    _USE_RAPIDFUZZ = True
except ImportError:
    from difflib import SequenceMatcher
    _USE_RAPIDFUZZ = False

DATA_FILE = Path(__file__).parent / "kjv.json"

_verses = None  # flat list: [{book, chapter, verse, text}]


def _normalize(text: str) -> str:
    """Lowercase and strip punctuation for comparison."""
    return re.sub(r"[^\w\s]", "", text.lower())


def _load() -> list:
    global _verses
    if _verses is not None:
        return _verses

    if not DATA_FILE.exists():
        raise FileNotFoundError(
            f"KJV data file not found at {DATA_FILE}\n"
            "Run `python download_kjv.py` to download it."
        )

    with open(DATA_FILE, encoding="utf-8") as f:
        raw = json.load(f)

    verses = []
    # Support two common JSON shapes:
    # Shape A: [{abbrev, book, chapters: [["verse text", ...], ...]}, ...]
    # Shape B: [{b, c, v, t}, ...] (flat)
    if isinstance(raw, list) and raw and "chapters" in raw[0]:
        for book_data in raw:
            book_name = book_data.get("name") or book_data.get("book", "Unknown")
            for chap_idx, chapter in enumerate(book_data["chapters"]):
                for verse_idx, text in enumerate(chapter):
                    verses.append({
                        "book": book_name,
                        "chapter": chap_idx + 1,
                        "verse": verse_idx + 1,
                        "text": text.strip(),
                    })
    elif isinstance(raw, list) and raw and ("t" in raw[0] or "text" in raw[0]):
        # flat format with book name lookup needed — skip, handled below
        for entry in raw:
            verses.append({
                "book": entry.get("book", str(entry.get("b", ""))),
                "chapter": int(entry.get("c", entry.get("chapter", 0))),
                "verse": int(entry.get("v", entry.get("verse", 0))),
                "text": entry.get("t", entry.get("text", "")).strip(),
            })
    else:
        raise ValueError("Unrecognised KJV JSON format in kjv.json")

    _verses = verses
    return verses


def find_verse_index(snippet: str) -> int:
    """Return the index in the flat verse list of the best fuzzy match."""
    verses = _load()
    norm_snippet = _normalize(snippet)

    if _USE_RAPIDFUZZ:
        norm_texts = [_normalize(v["text"]) for v in verses]
        result = rfprocess.extractOne(
            norm_snippet,
            norm_texts,
            scorer=fuzz.token_set_ratio,
        )
        return result[2]  # index
    else:
        best_idx = 0
        best_score = 0.0
        for i, v in enumerate(verses):
            score = SequenceMatcher(
                None, norm_snippet, _normalize(v["text"])
            ).ratio()
            if score > best_score:
                best_score = score
                best_idx = i
        return best_idx


def get_passage(center_idx: int, n: int) -> list:
    """Return the slice of verses centered on center_idx with n before/after."""
    verses = _load()
    start = max(0, center_idx - n)
    end = min(len(verses) - 1, center_idx + n)
    return verses[start : end + 1]


def _make_reference(first: dict, last: dict) -> str:
    """Build a compact passage reference string."""
    if first["book"] == last["book"]:
        if first["chapter"] == last["chapter"]:
            if first["verse"] == last["verse"]:
                return f"{first['book']} {first['chapter']}:{first['verse']}"
            return (
                f"{first['book']} {first['chapter']}:"
                f"{first['verse']}-{last['verse']}"
            )
        return (
            f"{first['book']} {first['chapter']}:{first['verse']}"
            f" - {last['chapter']}:{last['verse']}"
        )
    return (
        f"{first['book']} {first['chapter']}:{first['verse']}"
        f" - {last['book']} {last['chapter']}:{last['verse']}"
    )


def format_passage(verses_slice: list) -> str:
    """Format verses as one-per-paragraph with the reference at the end."""
    paragraphs = [v["text"] for v in verses_slice]
    reference = _make_reference(verses_slice[0], verses_slice[-1])
    return "\n\n".join(paragraphs) + "\n\n" + reference
