#!/usr/bin/env python3
"""
Download the Reina-Valera Purificada 1602 (RVP) Bible text and save as rvp.json.

Source: llromerorr/TextosBiblicos on GitHub
Format: plain-text .txt files, one per book
  #title Génesis
  1:1 EN el principio creó Dios el cielo y la tierra.
  1:2 ...
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

OUT = Path(__file__).parent / "rvp.json"
API_URL  = "https://api.github.com/repos/llromerorr/TextosBiblicos/contents/V1602P"
RAW_BASE = "https://raw.githubusercontent.com/llromerorr/TextosBiblicos/main/V1602P"


def _fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "kjv-mcp-setup/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def download() -> None:
    if OUT.exists():
        print(f"rvp.json already exists at {OUT} — delete it to re-download.")
        return

    print("Fetching file list from GitHub...")
    try:
        listing = json.loads(_fetch(API_URL))
    except Exception as exc:
        print(f"Failed to fetch file list: {exc}")
        sys.exit(1)

    txt_files = sorted(
        [f["name"] for f in listing if f["name"].endswith(".txt")],
        key=lambda n: int(n.split("_")[0]),
    )
    print(f"Found {len(txt_files)} book files.")

    verses = []
    for filename in txt_files:
        url = f"{RAW_BASE}/{filename}"
        try:
            content = _fetch(url).decode("utf-8")
        except Exception as exc:
            print(f"  Failed to fetch {filename}: {exc}")
            sys.exit(1)

        book_name = None
        book_verses = 0
        for line in content.splitlines():
            line = line.strip()
            if line.startswith("#title "):
                book_name = line[7:].strip()
            elif line.startswith("#") or not line:
                continue
            else:
                m = re.match(r"^(\d+):(\d+)\s+(.+)$", line)
                if m and book_name:
                    verses.append({
                        "book": book_name,
                        "chapter": int(m.group(1)),
                        "verse": int(m.group(2)),
                        "text": m.group(3).strip(),
                    })
                    book_verses += 1

        print(f"  {filename}: {book_name} ({book_verses} verses)")

    if not verses:
        print("No verses parsed — aborting.")
        sys.exit(1)

    # Sanity check — Génesis 1:1 should contain "principio"
    first = next((v for v in verses if v["chapter"] == 1 and v["verse"] == 1), None)
    if not first or "principio" not in first["text"].lower():
        print(f"Sanity check failed on first verse: {first}")
        sys.exit(1)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(verses, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\nSaved {len(verses):,} verses to {OUT}")


if __name__ == "__main__":
    download()
