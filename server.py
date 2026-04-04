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

API_KEY = os.environ.get("API_KEY", "").strip()


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
        import json as _json
        import uvicorn

        host = os.environ.get("HOST", "0.0.0.0")
        port = int(os.environ.get("PORT", 8000))

        # Build the MCP ASGI app — try disabling host checking if supported
        try:
            mcp_asgi = mcp.streamable_http_app(allowed_hosts=["*"])
        except TypeError:
            mcp_asgi = mcp.streamable_http_app()

        _bearer = f"Bearer {API_KEY}" if API_KEY else None
        print(f"Starting KJV MCP server on {host}:{port} "
              f"({'auth enabled' if _bearer else 'open access'})", flush=True)

        async def _send_json(send, body: dict, status: int = 200):
            raw = _json.dumps(body).encode()
            await send({"type": "http.response.start", "status": status,
                        "headers": [[b"content-type", b"application/json"],
                                    [b"content-length", str(len(raw)).encode()]]})
            await send({"type": "http.response.body", "body": raw})

        class RootApp:
            """Pure-ASGI wrapper: handles /health, enforces bearer auth, proxies rest to MCP."""

            async def __call__(self, scope, receive, send):
                if scope["type"] == "lifespan":
                    await mcp_asgi(scope, receive, send)
                    return

                if scope["type"] != "http":
                    await mcp_asgi(scope, receive, send)
                    return

                path = scope.get("path", "")

                # Health probe — no auth required
                if path == "/health":
                    await _send_json(send, {"status": "ok"})
                    return

                # Bearer auth
                if _bearer:
                    headers = {k.lower(): v for k, v in scope.get("headers", [])}
                    auth = headers.get(b"authorization", b"").decode("utf-8", errors="replace")
                    if auth != _bearer:
                        print(f"Auth FAILED | received={repr(auth)} | expected={repr(_bearer)}", flush=True)
                        await _send_json(send, {"error": "Unauthorized"}, status=401)
                        return

                # Strip Host header down to bare hostname:port so FastMCP's
                # TrustedHostMiddleware doesn't reject Railway's proxy headers.
                clean_headers = [
                    (k, v) for k, v in scope.get("headers", [])
                    if k.lower() != b"host"
                ] + [(b"host", b"localhost")]
                await mcp_asgi({**scope, "headers": clean_headers}, receive, send)

        uvicorn.run(RootApp(), host=host, port=port,
                    proxy_headers=True, forwarded_allow_ips="*")
