#!/usr/bin/env python3
"""
One-time setup: download the public-domain KJV Bible JSON and save as kjv.json.

Sources tried in order:
  1. thiagobodruk/bible on GitHub (chapters array format)
  2. Fallback: aruljohn/popular-quotations (skipped — not a full Bible)

Run once before starting the MCP server:
    python download_kjv.py
"""

import json
import sys
import urllib.request
from pathlib import Path

OUT = Path(__file__).parent / "kjv.json"

SOURCES = [
    # Format: [{abbrev, name/book, chapters: [["verse",...],...]}, ...]
    # Note: this file has a UTF-8 BOM — decoded with utf-8-sig below
    "https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json",
    # Flat verse format: [{b, c, v, t}, ...]
    "https://raw.githubusercontent.com/scrollmapper/bible_databases/master/json/t_kjv.json",
    # Another chapters-array mirror
    "https://raw.githubusercontent.com/jadenzaleski/bible-json/main/KJV/KJV.json",
]


def _fix_scrollmapper(data: list) -> list:
    """
    scrollmapper format: {"books": [{"book_id":1,"book_name":"Genesis","chapters":[...]}]}
    or flat: [{"b":1,"c":1,"v":1,"t":"..."}]
    Normalise to thiagobodruk shape.
    """
    # flat verse-per-entry format
    if data and "t" in data[0]:
        # Need a book-number→name mapping
        book_names = [
            "Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges",
            "Ruth","1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles",
            "2 Chronicles","Ezra","Nehemiah","Esther","Job","Psalms","Proverbs",
            "Ecclesiastes","Song of Solomon","Isaiah","Jeremiah","Lamentations",
            "Ezekiel","Daniel","Hosea","Joel","Amos","Obadiah","Jonah","Micah",
            "Nahum","Habakkuk","Zephaniah","Haggai","Zechariah","Malachi",
            "Matthew","Mark","Luke","John","Acts","Romans","1 Corinthians",
            "2 Corinthians","Galatians","Ephesians","Philippians","Colossians",
            "1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus",
            "Philemon","Hebrews","James","1 Peter","2 Peter","1 John","2 John",
            "3 John","Jude","Revelation",
        ]
        books: dict = {}
        for entry in data:
            b = int(entry["b"]) - 1
            c = int(entry["c"]) - 1
            v = int(entry["v"]) - 1
            t = entry["t"]
            if b not in books:
                books[b] = {"name": book_names[b] if b < len(book_names) else f"Book {b+1}", "chapters": {}}
            if c not in books[b]["chapters"]:
                books[b]["chapters"][c] = {}
            books[b]["chapters"][c][v] = t
        result = []
        for b_idx in sorted(books):
            bk = books[b_idx]
            chapters = []
            for c_idx in sorted(bk["chapters"]):
                ch = bk["chapters"][c_idx]
                chapters.append([ch[v_idx] for v_idx in sorted(ch)])
            result.append({"name": bk["name"], "chapters": chapters})
        return result
    return data


def download() -> None:
    if OUT.exists():
        print(f"kjv.json already exists at {OUT} — delete it to re-download.")
        return

    for url in SOURCES:
        print(f"Trying {url} ...")
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "kjv-mcp-setup/1.0"}
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                content = resp.read()
            # utf-8-sig strips BOM if present, harmless if not
            raw = json.loads(content.decode("utf-8-sig"))
        except Exception as exc:
            print(f"  Failed: {exc}")
            continue

        # Normalise if needed
        if isinstance(raw, dict) and "books" in raw:
            raw = raw["books"]
        if raw and ("t" in raw[0] or "b" in raw[0]):
            raw = _fix_scrollmapper(raw)

        # Validate: must have chapters arrays
        if not (isinstance(raw, list) and raw and "chapters" in raw[0]):
            print("  Unexpected format, skipping.")
            continue

        # Quick sanity check — Genesis 1:1 should contain "beginning"
        try:
            first_verse = raw[0]["chapters"][0][0]
            assert "beginning" in first_verse.lower(), first_verse
        except Exception as exc:
            print(f"  Sanity check failed: {exc}, skipping.")
            continue

        # Ensure 'name' key (some sources use 'book')
        for entry in raw:
            if "name" not in entry and "book" in entry:
                entry["name"] = entry["book"]

        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(raw, f, ensure_ascii=False, separators=(",", ":"))

        total = sum(
            len(ch) for bk in raw for ch in bk["chapters"]
        )
        print(f"Saved {total:,} verses to {OUT}")
        return

    print(
        "\nAll sources failed. Please download a KJV JSON manually and save it\n"
        f"as: {OUT}\n\n"
        "Expected format:\n"
        '  [{"name": "Genesis", "chapters": [["In the beginning...", ...], ...]}, ...]\n'
    )
    sys.exit(1)


if __name__ == "__main__":
    download()
