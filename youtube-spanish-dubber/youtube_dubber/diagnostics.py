"""Extraction diagnostics: capture exactly why a yt-dlp extraction fails.

When downloads start failing the YouTube bot-check, the trimmed one-line error
isn't enough to tell *where* it breaks (the player-API request, the GVS/stream
request, a cookie problem, a token problem). This module runs a full ``-v``
probe and assembles a single human-readable report -- cookies state, the
per-client real-format counts, and the complete verbose trace -- that the
operator endpoint / UI button returns and that the worker auto-captures on any
job failure.

No secrets leak: yt-dlp's ``-v`` prints the cookie file *path* and counts, never
the cookie values, and we never read or echo the cookie file ourselves.
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from .config import settings
from .pipeline import downloader

log = logging.getLogger(__name__)

SAMPLE_URL = "https://www.youtube.com/watch?v=Dj5OYkgDtHU"
_MAX_VERBOSE_CHARS = 16000

# High-signal substrings: the -v lines that actually explain a streaming/format
# failure (token attach, client downgrade, 403, sign-in wall, skipped formats).
_KEY_LINE_HINTS = (
    "po token", "pot ", "[pot", "gvs", "sign in", "not a bot", "403", "forbidden",
    "player api", "downgrad", "nsig", "n function", "visitor", "cookie", "drm",
    "formats", "skipping", "skipped", "no formats", "requested format", "warning", "error",
)


def _diag_dir() -> Path:
    path = settings.data_dir / "diagnostics"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _yt_dlp_version() -> str:
    try:
        out = subprocess.run(
            [downloader._binary(), "--version"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, timeout=30,
        )
        return out.stdout.strip() or "unknown"
    except Exception:  # noqa: BLE001
        return "unknown"


def _key_lines(debug: str) -> list[str]:
    """The high-signal -v lines (token/format/403/sign-in) pulled out of the
    full trace so the actual reason isn't buried."""
    out = []
    for line in debug.splitlines():
        low = line.lower()
        if any(hint in low for hint in _KEY_LINE_HINTS):
            out.append(line.strip())
    return out


def verbose_probe(url: str, client: str | None = None, timeout: int = 200) -> tuple[str, list[str]]:
    """Run ``yt-dlp -v -J --skip-download`` for `url` using the effective (or
    given) player client and return (debug_trace_tail, key_lines). The ``-v``
    debug goes to STDERR (the JSON result goes to stdout and is discarded here),
    so this captures the *reasons* -- token attach, client downgrade, 403,
    skipped formats -- not the giant metadata dump."""
    chosen = client if client is not None else downloader._effective_client()
    cmd = downloader._base_cmd(client=chosen) + ["-v", "-J", "--skip-download", "--ignore-no-formats-error", url]
    try:
        result = subprocess.run(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=timeout
        )
        debug = result.stderr or ""
    except subprocess.TimeoutExpired:
        return f"(diagnostic probe timed out after {timeout}s)", []
    except Exception as exc:  # noqa: BLE001
        return f"(diagnostic probe failed to run: {exc})", []
    return debug[-_MAX_VERBOSE_CHARS:], _key_lines(debug)


def report(url: str | None = None) -> dict:
    """Assemble + persist the extraction diagnostic. Returns a dict with the
    structured fields and a ready-to-read `report` text (also written to
    data/diagnostics/last.txt for GET /diagnostics/last)."""
    url = url or SAMPLE_URL
    cookies_enabled = bool(getattr(settings, "youtube_use_cookies", False))
    cookies_present = bool(cookies_enabled and Path(settings.youtube_cookies_file).exists())
    proxy = (getattr(settings, "ytdlp_proxy", "") or "").strip()
    pin = (settings.ytdlp_player_clients or "").strip()
    per_client = downloader.probe_client_formats(url)
    working = next((c for c, n in per_client if n > 0), None)
    debug, key_lines = verbose_probe(url)

    lines = [
        "=== extraction diagnostic ===",
        f"url:                {url}",
        f"yt-dlp:             {_yt_dlp_version()}",
        f"cookies enabled:    {cookies_enabled}" + (
            "" if not cookies_enabled else f" (file present: {cookies_present})"),
        f"proxy:              {proxy or '(none — direct)'}",
        f"hard-pinned client: {pin or '(none — auto-resolve)'}",
        f"client ladder:      {', '.join(downloader.client_ladder())}",
        "",
        "per-client real (non-storyboard) format counts:",
    ]
    for client, count in per_client:
        lines.append(f"  {client or 'default':14s} -> {count}")
    lines.append("")
    lines.append(
        f"=> WORKING client: {working or 'default'}" if working is not None
        else "=> NO client returned real formats (metadata may still extract; the "
             "media streams are the problem)."
    )
    lines.append("")
    lines.append("--- key trace lines (token / format / 403 / sign-in) ---")
    lines.extend(key_lines or ["(no high-signal lines matched)"])
    lines.append("")
    lines.append("--- full verbose trace (stderr tail) ---")
    lines.append(debug)
    text = "\n".join(lines)

    try:
        (_diag_dir() / "last.txt").write_text(text, encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        log.warning("Couldn't persist extraction diagnostic (%s)", exc)

    return {
        "url": url,
        "yt_dlp_version": _yt_dlp_version(),
        "cookies_enabled": cookies_enabled,
        "cookies_present": cookies_present,
        "proxy": proxy or None,
        "pinned_client": pin or None,
        "working_client": working,
        "per_client": [{"client": c or "default", "real_formats": n} for c, n in per_client],
        "key_lines": key_lines,
        "report": text,
    }


def capture_failure(url: str, job_id: str | None = None) -> str | None:
    """Best-effort: capture a diagnostic after a job's extraction failed, so the
    full trace is waiting in GET /diagnostics/last. Never raises into the worker."""
    try:
        data = report(url)
        if job_id:
            try:
                (_diag_dir() / f"job-{job_id}.txt").write_text(data["report"], encoding="utf-8")
            except Exception:  # noqa: BLE001
                pass
        return data["report"]
    except Exception as exc:  # noqa: BLE001
        log.warning("Extraction-failure diagnostic capture failed (%s)", exc)
        return None


def last_report() -> str | None:
    path = _diag_dir() / "last.txt"
    try:
        return path.read_text(encoding="utf-8") if path.exists() else None
    except Exception:  # noqa: BLE001
        return None
