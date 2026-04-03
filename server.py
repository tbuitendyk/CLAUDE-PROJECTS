#!/usr/bin/env python3
"""
KJV Bible Verse Lookup — MCP Server

Supports two transports:
  stdio             — local use with Claude Desktop / Claude Code
  streamable-http   — remote use with Claude.ai on any device (phone, web)

Environment variables:
  TRANSPORT   stdio | http   (default: http)
  HOST        bind address   (default: 0.0.0.0)
  PORT        port number    (default: 8000)
  API_KEY     optional bearer token — set this to protect your endpoint
"""

import os
import sys
from pathlib import Path

from mcp.server.fastmcp import FastMCP
import bible_data

# ---------------------------------------------------------------------------
# Auto-download KJV data if missing (needed for fresh container deployments)
# ---------------------------------------------------------------------------
if not Path(bible_data.DATA_FILE).exists():
    print("KJV data not found — downloading now...", flush=True)
    try:
        import download_kjv
        download_kjv.download()
    except SystemExit:
        print("ERROR: Could not download KJV data. Exiting.", file=sys.stderr)
        sys.exit(1)

# Pre-load into memory so the first request isn't slow
bible_data._load()

# ---------------------------------------------------------------------------
# MCP server
# ---------------------------------------------------------------------------
mcp = FastMCP(
    "KJV Bible Verse Lookup",
    instructions=(
        "Use kjv_lookup to find any KJV Bible verse by a partial text snippet "
        "and retrieve it with surrounding context. Always pass the returned "
        "passage back to the user verbatim — it already includes the reference."
    ),
)

API_KEY = os.environ.get("API_KEY", "")


def _check_auth() -> str | None:
    """Return an error string if auth fails, else None."""
    if not API_KEY:
        return None  # no key configured — open access
    # FastMCP does not expose request headers directly; auth is enforced at
    # the transport layer via middleware added below when running HTTP.
    return None


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
        idx = bible_data.find_verse_index(snippet)
        passage = bible_data.get_passage(idx, context_verses)
        return bible_data.format_passage(passage)
    except Exception as exc:  # noqa: BLE001
        return f"Error during verse lookup: {exc}"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    transport = os.environ.get("TRANSPORT", "http").lower()

    if transport == "stdio":
        mcp.run(transport="stdio")
    else:
        host = os.environ.get("HOST", "0.0.0.0")
        port = int(os.environ.get("PORT", 8000))

        if API_KEY:
            # Wrap the ASGI app with simple bearer-token middleware
            from starlette.middleware.base import BaseHTTPMiddleware
            from starlette.responses import JSONResponse

            class BearerAuthMiddleware(BaseHTTPMiddleware):
                async def dispatch(self, request, call_next):
                    auth = request.headers.get("Authorization", "")
                    if auth != f"Bearer {API_KEY}":
                        return JSONResponse(
                            {"error": "Unauthorized"}, status_code=401
                        )
                    return await call_next(request)

            app = mcp.streamable_http_app()
            app.add_middleware(BearerAuthMiddleware)

            import uvicorn
            print(f"Starting KJV MCP server on {host}:{port} (auth enabled)")
            uvicorn.run(app, host=host, port=port)
        else:
            print(
                f"Starting KJV MCP server on {host}:{port} "
                "(no API_KEY set — open access)"
            )
            mcp.run(
                transport="streamable-http",
                host=host,
                port=port,
            )
