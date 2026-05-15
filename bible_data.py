"""Bible data loader and fuzzy verse search — supports multiple translations."""

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
VP_FILE   = Path(__file__).parent / "vp.json"

_cache: dict = {}  # {str(path): [verses]}


def _normalize(text: str) -> str:
    return re.sub(r"[^\w\s]", "", text.lower())


def _load(data_file: Path = None) -> list:
    data_file = data_file or DATA_FILE
    key = str(data_file)
    if key in _cache:
        return _cache[key]

    if not data_file.exists():
        raise FileNotFoundError(f"Bible data not found: {data_file}")

    with open(data_file, encoding="utf-8") as f:
        raw = json.load(f)

    verses = []
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
        for entry in raw:
            verses.append({
                "book": entry.get("book", str(entry.get("b", ""))),
                "chapter": int(entry.get("c", entry.get("chapter", 0))),
                "verse": int(entry.get("v", entry.get("verse", 0))),
                "text": entry.get("t", entry.get("text", "")).strip(),
            })
    else:
        raise ValueError(f"Unrecognised Bible JSON format in {data_file}")

    _cache[key] = verses
    return verses


def find_verse_index(snippet: str, data_file: Path = None) -> int:
    verses = _load(data_file)
    norm_snippet = _normalize(snippet)

    if _USE_RAPIDFUZZ:
        norm_texts = [_normalize(v["text"]) for v in verses]
        result = rfprocess.extractOne(
            norm_snippet, norm_texts, scorer=fuzz.token_set_ratio,
        )
        return result[2]
    else:
        best_idx, best_score = 0, 0.0
        for i, v in enumerate(verses):
            score = SequenceMatcher(None, norm_snippet, _normalize(v["text"])).ratio()
            if score > best_score:
                best_score = score
                best_idx = i
        return best_idx


def get_passage(center_idx: int, n: int, data_file: Path = None) -> list:
    verses = _load(data_file)
    start = max(0, center_idx - n)
    end = min(len(verses) - 1, center_idx + n)
    return verses[start : end + 1]


def _make_reference(first: dict, last: dict) -> str:
    if first["book"] == last["book"]:
        if first["chapter"] == last["chapter"]:
            if first["verse"] == last["verse"]:
                return f"{first['book']} {first['chapter']}:{first['verse']}"
            return f"{first['book']} {first['chapter']}:{first['verse']}-{last['verse']}"
        return f"{first['book']} {first['chapter']}:{first['verse']} - {last['chapter']}:{last['verse']}"
    return f"{first['book']} {first['chapter']}:{first['verse']} - {last['book']} {last['chapter']}:{last['verse']}"


def format_passage(verses_slice: list) -> str:
    paragraphs = [v["text"] for v in verses_slice]
    reference = _make_reference(verses_slice[0], verses_slice[-1])
    return "\n\n".join(paragraphs) + "\n\n" + reference
