#!/usr/bin/env python3
"""
KJV Bible Verse Lookup — MCP Server

Exposes a single tool `kjv_lookup` that finds the closest matching KJV verse
to a text snippet and returns it with surrounding context as a clean passage.

Setup:
    pip install -r requirements.txt
    python download_kjv.py   # one-time data download
    python server.py         # or register in .mcp.json / claude_desktop_config.json
"""

from mcp.server.fastmcp import FastMCP
from bible_data import find_verse_index, get_passage, format_passage

mcp = FastMCP(
    "KJV Bible Verse Lookup",
    instructions=(
        "Use kjv_lookup to find any KJV Bible verse by a partial text snippet "
        "and retrieve it with surrounding context. Always pass the returned "
        "passage back to the user verbatim — it already includes the reference."
    ),
)


@mcp.tool()
def kjv_lookup(snippet: str, context_verses: int = 3) -> str:
    """Find the closest matching KJV verse and return it with context.

    Args:
        snippet: Any partial or complete KJV verse text to search for.
        context_verses: How many verses to include before and after the match
                        (default 3; set to 0 for the single verse only).

    Returns:
        The passage as plain text — one verse per paragraph, with the full
        passage reference (e.g. "John 3:14-18") on the last line.
    """
    try:
        idx = find_verse_index(snippet)
        passage = get_passage(idx, context_verses)
        return format_passage(passage)
    except FileNotFoundError as exc:
        return (
            f"Error: KJV data not loaded. {exc}\n"
            "Run `python download_kjv.py` in the server directory first."
        )
    except Exception as exc:  # noqa: BLE001
        return f"Error during verse lookup: {exc}"


if __name__ == "__main__":
    mcp.run(transport="stdio")
