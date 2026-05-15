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
            try:
                _app = mcp.streamable_http_app(stateless_http=True)
            except TypeError:
                _app = mcp.streamable_http_app()
            config = _uvi.Config(
                _app,
                host="127.0.0.1",
                port=INTERNAL_PORT,
                log_level="warning",
            )
            asyncio.run(_uvi.Server(config).serve())

        mcp_thread = threading.Thread(target=_run_mcp, daemon=True)
        mcp_thread.start()

        time.sleep(2)  # Give internal MCP server time to start
        print("Internal MCP server ready", flush=True)

        BASE_URL = os.environ.get("BASE_URL", "").rstrip("/")

        # ── Public-facing ASGI proxy ────────────────────────────────────────
        async def _send_json(send, body: dict, status: int = 200):
            raw = json.dumps(body).encode()
            await send({"type": "http.response.start", "status": status,
                        "headers": [[b"content-type", b"application/json"],
                                    [b"content-length", str(len(raw)).encode()]]})
            await send({"type": "http.response.body", "body": raw})

        async def _send_redirect(send, location: str):
            loc = location.encode()
            await send({"type": "http.response.start", "status": 302,
                        "headers": [[b"location", loc],
                                    [b"content-length", b"0"]]})
            await send({"type": "http.response.body", "body": b""})

        def _lookup_page(q: str, n: int, result: str) -> str:
            q_esc = q.replace('"', "&quot;")
            if result:
                lines = result.split("\n\n")
                reference = lines[-1] if lines else ""
                verses = lines[:-1]
                body = "".join(f"<p>{v}</p>" for v in verses if v.strip())
                body += f'<p class="ref">{reference}</p>'
            else:
                body = ""
            return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KJV Bible Verse Lookup</title>
<style>
  body {{ font-family: Georgia, serif; max-width: 700px; margin: 2rem auto; padding: 0 1rem; background: #fdf6e3; color: #333; }}
  h1 {{ font-size: 1.4rem; color: #5a3e1b; }}
  form {{ display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1.5rem; }}
  input[name=q] {{ flex: 1; min-width: 200px; padding: .4rem .6rem; font-size: 1rem; border: 1px solid #ccc; border-radius: 4px; }}
  select {{ padding: .4rem; border: 1px solid #ccc; border-radius: 4px; }}
  button {{ padding: .4rem 1rem; background: #5a3e1b; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }}
  p {{ line-height: 1.7; margin: .6rem 0; }}
  p.ref {{ font-style: italic; color: #5a3e1b; margin-top: 1rem; font-size: .95rem; }}
</style>
</head>
<body>
<h1>KJV Bible Verse Lookup</h1>
<form method="get" action="/lookup">
  <input name="q" type="text" placeholder="Enter a verse snippet…" value="{q_esc}" required>
  <select name="n">
    {''.join(f'<option value="{i}"{"selected" if i==n else ""}>{i} verses context</option>' for i in range(0,11))}
  </select>
  <button type="submit">Look up</button>
</form>
{body}
</body>
</html>"""

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
                method = scope.get("method", "GET")
                qs_raw = scope.get("query_string", b"").decode()

                # CORS preflight
                if method == "OPTIONS":
                    await send({"type": "http.response.start", "status": 204,
                                "headers": [[b"access-control-allow-origin", b"*"],
                                            [b"access-control-allow-methods", b"GET, POST, OPTIONS"],
                                            [b"access-control-allow-headers", b"*"]]})
                    await send({"type": "http.response.body", "body": b""})
                    return

                # Health probe — no auth
                if path == "/health":
                    await _send_json(send, {"status": "ok"})
                    return

                # ── Browser-friendly verse lookup ───────────────────────────
                if path == "/lookup":
                    import urllib.parse as _up
                    params = dict(_up.parse_qsl(qs_raw))
                    q = params.get("q", "").strip()
                    try:
                        n = max(0, min(int(params.get("n", "3")), 20))
                    except ValueError:
                        n = 3

                    if not q:
                        html = _lookup_page("", n, "")
                    else:
                        try:
                            idx = bible_data.find_verse_index(q)
                            passage = bible_data.get_passage(idx, n)
                            result = bible_data.format_passage(passage)
                        except Exception as exc:
                            result = f"Error: {exc}"
                        html = _lookup_page(q, n, result)

                    raw = html.encode()
                    await send({"type": "http.response.start", "status": 200,
                                "headers": [[b"content-type", b"text/html; charset=utf-8"],
                                            [b"content-length", str(len(raw)).encode()]]})
                    await send({"type": "http.response.body", "body": raw})
                    return

                # ── Minimal OAuth 2.0 server (for Claude.ai connector) ──────
                if path == "/.well-known/oauth-authorization-server":
                    issuer = BASE_URL or f"http://localhost:{PUBLIC_PORT}"
                    await _send_json(send, {
                        "issuer": issuer,
                        "authorization_endpoint": f"{issuer}/authorize",
                        "token_endpoint": f"{issuer}/token",
                        "response_types_supported": ["code"],
                        "grant_types_supported": ["authorization_code"],
                        "code_challenge_methods_supported": ["S256", "plain"],
                    })
                    return

                if path == "/authorize":
                    import urllib.parse as _up
                    params = dict(_up.parse_qsl(qs_raw))
                    redirect_uri = params.get("redirect_uri", "")
                    state = params.get("state", "")
                    # Use the API_KEY itself as the authorization code
                    code = API_KEY if API_KEY else "open"
                    sep = "&" if "?" in redirect_uri else "?"
                    location = f"{redirect_uri}{sep}code={_up.quote(code, safe='')}"
                    if state:
                        location += f"&state={_up.quote(state, safe='')}"
                    await _send_redirect(send, location)
                    return

                if path == "/token" and method == "POST":
                    # Exchange any code for our static bearer token
                    await _send_json(send, {
                        "access_token": API_KEY if API_KEY else "open",
                        "token_type": "bearer",
                        "expires_in": 315360000,  # ~10 years
                    })
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

                url = f"http://127.0.0.1:{INTERNAL_PORT}{path}"
                if qs_raw:
                    url += f"?{qs_raw}"

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
