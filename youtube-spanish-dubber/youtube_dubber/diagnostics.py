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
_MAX_VERBOSE_CHARS = 20000


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


def verbose_probe(url: str, client: str | None = None, timeout: int = 200) -> str:
    """Full ``yt-dlp -v -J --skip-download`` output (stdout+stderr) for `url`
    using the effective (or given) player client -- the complete trace of an
    extraction attempt. Capped to the last ~20k chars."""
    chosen = client if client is not None else downloader._effective_client()
    cmd = downloader._base_cmd(client=chosen) + ["-v", "-J", "--skip-download", "--ignore-no-formats-error", url]
    try:
        result = subprocess.run(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout
        )
        out = result.stdout or ""
    except subprocess.TimeoutExpired:
        out = f"(diagnostic probe timed out after {timeout}s)"
    except Exception as exc:  # noqa: BLE001
        out = f"(diagnostic probe failed to run: {exc})"
    return out[-_MAX_VERBOSE_CHARS:]


def report(url: str | None = None) -> dict:
    """Assemble + persist the extraction diagnostic. Returns a dict with the
    structured fields and a ready-to-read `report` text (also written to
    data/diagnostics/last.txt for GET /diagnostics/last)."""
    url = url or SAMPLE_URL
    cookies_enabled = bool(getattr(settings, "youtube_use_cookies", False))
    cookies_present = bool(cookies_enabled and Path(settings.youtube_cookies_file).exists())
    pin = (settings.ytdlp_player_clients or "").strip()
    per_client = downloader.probe_client_formats(url)
    working = next((c for c, n in per_client if n > 0), None)
    verbose = verbose_probe(url)

    lines = [
        f"=== extraction diagnostic ===",
        f"url:               {url}",
        f"yt-dlp:            {_yt_dlp_version()}",
        f"cookies enabled:   {cookies_enabled}" + (
            "" if not cookies_enabled else f" (file present: {cookies_present})"),
        f"hard-pinned client: {pin or '(none — auto-resolve)'}",
        f"client ladder:     {', '.join(downloader.client_ladder())}",
        "",
        "per-client real (non-storyboard) format counts:",
    ]
    for client, count in per_client:
        lines.append(f"  {client or 'default':14s} -> {count}")
    lines.append("")
    lines.append(
        f"=> WORKING client: {working or 'default'}" if working is not None
        else "=> NO client returned real formats."
    )
    lines.append("")
    lines.append(f"--- full verbose trace ({'effective client' if not pin else pin}) ---")
    lines.append(verbose)
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
        "pinned_client": pin or None,
        "working_client": working,
        "per_client": [{"client": c or "default", "real_formats": n} for c, n in per_client],
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
