#!/usr/bin/env python3
"""
KJV Bible Verse Lookup — MCP Server

Transports:
  stdio  — local use with Claude Desktop / Claude Code (TRANSPORT=stdio)
  http   — remote use via proxy to internal MCP server (default)

Environment variables:
  TRANSPORT     stdio | http  (default: http)
  PORT          public port   (default: 8000)
  API_KEY       bearer token  (optional but recommended)
"""

import os
import sys
import json
import time
import threading
from pathlib import Path

from mcp.server.fastmcp import FastMCP
import bible_data

# ---------------------------------------------------------------------------
# Auto-download KJV data
# ---------------------------------------------------------------------------
if not Path(bible_data.DATA_FILE).exists():
    print("KJV data not found — downloading now...", flush=True)
    try:
        import download_kjv
        download_kjv.download()
    except SystemExit:
        print("ERROR: Could not download KJV data.", file=sys.stderr)
        sys.exit(1)

bible_data._load()
print(f"KJV data loaded ({len(bible_data._verses):,} verses)", flush=True)

# ---------------------------------------------------------------------------
# MCP server definition
# ---------------------------------------------------------------------------
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
        idx = bible_data.find_verse_index(snippet)
        passage = bible_data.get_passage(idx, context_verses)
        return bible_data.format_passage(passage)
    except Exception as exc:
        return f"Error during verse lookup: {exc}"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    transport = os.environ.get("TRANSPORT", "http").lower()

    if transport == "stdio":
        mcp.run(transport="stdio")

    else:
        import uvicorn
        import httpx

        PUBLIC_PORT = int(os.environ.get("PORT", 8000))
        INTERNAL_PORT = PUBLIC_PORT + 1  # e.g. 8001
        API_KEY = os.environ.get("API_KEY", "").strip()
        BEARER = f"Bearer {API_KEY}" if API_KEY else None

        # ── Start internal MCP server on localhost ──────────────────────────
        # Running on 127.0.0.1 means the MCP SDK's host security check sees
        # "localhost" as the Host header and accepts it.
        def _run_mcp():
            import asyncio
            import uvicorn as _uvi
            print(f"Internal MCP starting on port {INTERNAL_PORT}", flush=True)
            config = _uvi.Config(
                mcp.streamable_http_app(),
                host="127.0.0.1",
                port=INTERNAL_PORT,
                log_level="warning",
            )
            asyncio.run(_uvi.Server(config).serve())

        mcp_thread = threading.Thread(target=_run_mcp, daemon=True)
        mcp_thread.start()

        time.sleep(2)  # Give internal MCP server time to start
        print("Internal MCP server ready", flush=True)

        # ── Public-facing ASGI proxy ────────────────────────────────────────
        async def _send_json(send, body: dict, status: int = 200):
            raw = json.dumps(body).encode()
            await send({"type": "http.response.start", "status": status,
                        "headers": [[b"content-type", b"application/json"],
                                    [b"content-length", str(len(raw)).encode()]]})
            await send({"type": "http.response.body", "body": raw})

        class ProxyApp:
            """Auth + health wrapper that proxies to the internal MCP server."""

            async def __call__(self, scope, receive, send):
                if scope["type"] == "lifespan":
                    await receive()
                    await send({"type": "lifespan.startup.complete"})
                    await receive()
                    await send({"type": "lifespan.shutdown.complete"})
                    return

                if scope["type"] != "http":
                    return

                path = scope.get("path", "")

                # Health probe — no auth
                if path == "/health":
                    await _send_json(send, {"status": "ok"})
                    return

                # Bearer auth
                if BEARER:
                    hdrs = {k.lower(): v for k, v in scope.get("headers", [])}
                    auth = hdrs.get(b"authorization", b"").decode(errors="replace")
                    if auth != BEARER:
                        print(f"Auth failed: {repr(auth)}", flush=True)
                        await _send_json(send, {"error": "Unauthorized"}, 401)
                        return

                # Read request body
                body = b""
                while True:
                    msg = await receive()
                    body += msg.get("body", b"")
                    if not msg.get("more_body", False):
                        break

                # Forward headers, override Host so MCP security passes
                fwd_headers = {
                    k.decode(errors="replace"): v.decode(errors="replace")
                    for k, v in scope.get("headers", [])
                    if k.lower() not in (b"host", b"authorization")
                }
                fwd_headers["host"] = f"localhost:{INTERNAL_PORT}"  # must match MCP server's bound port
                fwd_headers.setdefault("accept", "application/json, text/event-stream")

                method = scope.get("method", "GET")
                qs = scope.get("query_string", b"").decode()
                url = f"http://127.0.0.1:{INTERNAL_PORT}{path}"
                if qs:
                    url += f"?{qs}"

                # Stream the response back
                async with httpx.AsyncClient(timeout=60.0) as client:
                    try:
                        async with client.stream(
                            method, url,
                            content=body,
                            headers=fwd_headers,
                        ) as resp:
                            await send({
                                "type": "http.response.start",
                                "status": resp.status_code,
                                "headers": [
                                    [k.lower().encode(), v.encode()]
                                    for k, v in resp.headers.items()
                                ],
                            })
                            async for chunk in resp.aiter_bytes():
                                await send({
                                    "type": "http.response.body",
                                    "body": chunk,
                                    "more_body": True,
                                })
                            await send({
                                "type": "http.response.body",
                                "body": b"",
                                "more_body": False,
                            })
                    except Exception as exc:
                        print(f"Proxy error: {exc}", flush=True)
                        await _send_json(send, {"error": "proxy error"}, 502)

        print(f"Starting public proxy on 0.0.0.0:{PUBLIC_PORT} "
              f"({'auth enabled' if BEARER else 'open'})", flush=True)

        uvicorn.run(ProxyApp(), host="0.0.0.0", port=PUBLIC_PORT,
                    proxy_headers=True, forwarded_allow_ips="*")
