"""YouTube downloading via the standalone yt-dlp binary.

We invoke yt-dlp as a *separate process* -- the self-contained ``yt-dlp_linux``
release, which bundles its own Python -- rather than importing it as a library.
yt-dlp must be kept current to track YouTube's constant changes, but its recent
releases need a newer Python than this service runs on (yt-dlp dropped Python
3.9 after that version reached end-of-life). Shelling out to the standalone
binary decouples the two, so extraction can always be the newest build.
``deploy/install.sh`` drops the latest binary at ``<install>/bin/yt-dlp`` on
every deploy.
"""
from __future__ import annotations

import json
import logging
import re
import subprocess
from pathlib import Path
from typing import Callable, Optional

from ..config import settings
from .models import ThumbnailSource, VideoInfo

log = logging.getLogger(__name__)

# Thumbnail extensions yt-dlp may save (it picks whatever the site serves).
_THUMBNAIL_EXTS = (".jpg", ".jpeg", ".png", ".webp")

_PERCENT_RE = re.compile(r"\[download\]\s+([0-9.]+)%")


class DownloadError(RuntimeError):
    """A yt-dlp invocation failed; carries a trimmed reason for the caller."""


# The yt-dlp player client to use is resolved ONCE per process (see
# ensure_working_client): YouTube binds the provider's PO token to a specific
# client, and the default client set periodically stops yielding real formats
# ("Sign in to confirm you're not a bot" / storyboards-only). Rather than pin a
# client that will itself go stale, we try a ladder and cache the first that
# returns real formats. `None` = not resolved yet; "" = use yt-dlp's default.
_UNSET = object()
_resolved_client: Optional[str] = None
_resolve_attempted = False


def _binary() -> str:
    """The yt-dlp binary to invoke: the configured standalone build if present,
    else whatever ``yt-dlp`` is on PATH."""
    configured = Path(settings.ytdlp_bin)
    return str(configured) if configured.exists() else "yt-dlp"


def _client_extractor_args(client: str) -> list[str]:
    """`--extractor-args` to pin a yt-dlp player client, or [] for the default.
    "" / "default" mean "don't pin -- use yt-dlp's own client set"."""
    name = (client or "").strip()
    if not name or name.lower() == "default":
        return []
    return ["--extractor-args", f"youtube:player_client={name}"]


def _effective_client() -> str:
    """The player client a normal call should use: an operator hard-pin
    (DUBBER_YTDLP_PLAYER_CLIENTS) wins; otherwise the resolved working client;
    otherwise "" (yt-dlp default)."""
    pin = (settings.ytdlp_player_clients or "").strip()
    if pin:
        return pin
    return _resolved_client or ""


def _base_cmd(client=_UNSET) -> list[str]:
    """yt-dlp plus the args every call shares: terse output, our plugin directory
    (the PO-token provider plugin), the player-client pin, and -- only when
    explicitly enabled -- a cookies file.

    The provider mints Proof-of-Origin tokens; YouTube binds them to a specific
    player client, so we pin the resolved working client (see
    ensure_working_client) rather than let yt-dlp roam its default set, where the
    token may not be attached. Cookies stay OFF by default: a throwaway account's
    cookies push yt-dlp onto authenticated clients that return storyboards-only
    for videos that account doesn't own. Pass `client` to force a specific one
    (the resolver does this while probing the ladder)."""
    cmd = [_binary(), "--no-warnings", "--no-playlist"]
    proxy = (getattr(settings, "ytdlp_proxy", "") or "").strip()
    if proxy:  # route extraction through a clean/residential egress
        cmd += ["--proxy", proxy]
    plugin_dirs = settings.ytdlp_plugin_dirs
    if plugin_dirs and Path(plugin_dirs).exists():
        cmd += ["--plugin-dirs", str(plugin_dirs)]
    chosen = _effective_client() if client is _UNSET else client
    cmd += _client_extractor_args(chosen)
    if getattr(settings, "ytdlp_include_missing_pot", False):
        # Surface PO-token-gated formats even without a validated token.
        cmd += ["--extractor-args", "youtube:formats=missing_pot"]
    if settings.youtube_use_cookies:
        cookies = settings.youtube_cookies_file
        if cookies and Path(cookies).exists():
            cmd += ["--cookies", str(cookies)]
    return cmd


def count_real_formats(info: dict) -> int:
    """Number of real (non-storyboard) formats in a yt-dlp info dict -- a format
    with an actual audio or video codec. 0 means the extraction came back
    storyboards-only (the bot-check / stale-token symptom)."""
    return sum(
        1 for fmt in (info.get("formats") or [])
        if fmt.get("vcodec") not in (None, "none") or fmt.get("acodec") not in (None, "none")
    )


def client_ladder() -> list[str]:
    """The ordered player clients to try when resolving a working one.
    DUBBER_YTDLP_CLIENT_LADDER overrides; "web" leads because the bgutil
    provider's gvs PO token binds to it."""
    raw = (settings.ytdlp_client_ladder or "").strip()
    ladder = [c.strip() for c in raw.split(",") if c.strip()]
    return ladder or ["default"]


def _probe_formats(url: str, client: str) -> int:
    """Real-format count yt-dlp sees for `url` using `client` (0 on any failure:
    bot-check, no formats, timeout). The signal the resolver picks a client on."""
    cmd = _base_cmd(client=client) + ["-J", "--skip-download", "--ignore-no-formats-error", url]
    try:
        result = subprocess.run(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=150
        )
        if result.returncode != 0 or not result.stdout.strip():
            return 0
        return count_real_formats(json.loads(result.stdout))
    except Exception:  # noqa: BLE001 -- a failed probe just means "this client doesn't work"
        return 0


def probe_client_formats(url: str) -> list[tuple[str, int]]:
    """(client, real-format count) for every ladder client -- the diagnostic the
    deploy self-test / `cli check-extraction` prints."""
    return [(client, _probe_formats(url, client)) for client in client_ladder()]


def resolve_working_client(url: str) -> Optional[str]:
    """The first ladder client that returns real formats for `url`, or None if
    none do."""
    for client in client_ladder():
        if _probe_formats(url, client) > 0:
            return client
    return None


def ensure_working_client(url: str) -> None:
    """Resolve and cache the player client to use for the rest of this process,
    once. No-op if an operator pinned DUBBER_YTDLP_PLAYER_CLIENTS, or if already
    attempted. Best-effort: if nothing in the ladder works we leave the default
    in place and let the real call surface the error."""
    global _resolved_client, _resolve_attempted
    if (settings.ytdlp_player_clients or "").strip() or _resolve_attempted:
        return
    _resolve_attempted = True
    chosen = resolve_working_client(url)
    if chosen is not None:
        _resolved_client = chosen
        log.info("Resolved yt-dlp player client %r (it returns real formats)", chosen or "default")
    else:
        log.warning("No player client in the ladder returned formats for %s; using yt-dlp's default", url)


def reset_resolved_client() -> None:
    """Forget the cached client so the next extraction re-resolves (tests / a
    forced retry)."""
    global _resolved_client, _resolve_attempted
    _resolved_client = None
    _resolve_attempted = False


def _clean_error(text: str) -> str:
    """Pull the most useful line out of yt-dlp's stderr for surfacing to a user."""
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    errors = [ln for ln in lines if "ERROR" in ln.upper()]
    chosen = (errors or lines or [""])[-1]
    return chosen[len("ERROR:"):].strip() if chosen.upper().startswith("ERROR:") else chosen


def probe(url: str) -> dict:
    """Return yt-dlp's info dict (JSON) for `url` without downloading anything.

    Reads only metadata + caption availability, so format selection is told not
    to abort if a client returns no downloadable formats."""
    ensure_working_client(url)
    cmd = _base_cmd() + ["--dump-single-json", "--skip-download", "--ignore-no-formats-error", url]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0 or not result.stdout.strip():
        raise DownloadError(_clean_error(result.stderr) or "yt-dlp could not read that video")
    return json.loads(result.stdout)


def available_caption_language(info: dict, codes: tuple[str, ...], auto: bool) -> Optional[str]:
    """Return the first caption code (from `codes`, in priority order) that the
    video actually has, looking at either manual ("subtitles") or
    auto-generated ("automatic_captions") tracks."""
    bucket = info.get("automatic_captions" if auto else "subtitles") or {}
    for code in codes:
        if code in bucket and bucket[code]:
            return code
    # Fall back to a prefix match, e.g. requested "es" but video only lists "es-419".
    for code in codes:
        prefix = code.split("-")[0]
        for available in bucket:
            if available.split("-")[0] == prefix and bucket[available]:
                return available
    return None


def any_caption_language(info: dict, auto: bool) -> Optional[str]:
    bucket = info.get("automatic_captions" if auto else "subtitles") or {}
    # Prefer the original spoken language if yt-dlp identified one.
    original = info.get("language")
    if original and original in bucket and bucket[original]:
        return original
    for code in bucket:
        if bucket[code]:
            return code
    return None


def download_video(
    url: str, work_dir: Path, on_progress: "Optional[Callable[[float], None]]" = None
) -> VideoInfo:
    """Download the best available muxed (or mux-able) video+audio as MP4, plus
    the source thumbnail (so the dub can reuse/brand it) and the metadata sidecar.
    `on_progress`, if given, receives the download completion fraction (0..1)."""
    ensure_working_client(url)
    cmd = _base_cmd() + [
        "--format", "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b[ext=mp4]/b",
        "--merge-output-format", "mp4",
        "--write-thumbnail",
        "--write-info-json",
        "--no-part",
        "--newline",
        "--output", str(work_dir / "source.%(ext)s"),
        url,
    ]
    _download_with_progress(cmd, on_progress)

    info_path = work_dir / "source.info.json"
    if not info_path.exists():
        raise DownloadError("yt-dlp produced no metadata for the download")
    info = json.loads(info_path.read_text(encoding="utf-8"))
    video_path = _find_output_video(work_dir)
    if video_path is None:
        raise DownloadError("yt-dlp did not produce a video file")

    return VideoInfo(
        id=info["id"],
        title=info.get("title") or info["id"],
        description=info.get("description") or "",
        duration=float(info.get("duration") or 0.0),
        original_language=info.get("language"),
        video_path=str(video_path),
        thumbnail_path=_find_thumbnail(work_dir, video_path),
    )


def _download_with_progress(cmd: list[str], on_progress: "Optional[Callable[[float], None]]") -> None:
    """Run a yt-dlp download, streaming its `[download] NN.N%` lines to
    `on_progress`. Raises DownloadError (with the tail of the output) on failure."""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    tail: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        tail.append(line)
        if len(tail) > 50:
            del tail[0]
        if on_progress is not None:
            match = _PERCENT_RE.search(line)
            if match:
                try:
                    on_progress(min(0.99, float(match.group(1)) / 100.0))
                except Exception:  # noqa: BLE001 -- progress is best-effort
                    pass
    if proc.wait() != 0:
        raise DownloadError(_clean_error("".join(tail)) or "yt-dlp download failed")


def _find_output_video(work_dir: Path) -> Optional[Path]:
    """Locate the muxed video yt-dlp wrote (source.mp4, or .mkv/.webm if a merge
    fell back), ignoring the thumbnail and info-json sidecars."""
    for ext in (".mp4", ".mkv", ".webm"):
        candidate = work_dir / f"source{ext}"
        if candidate.exists():
            return candidate
    for candidate in sorted(work_dir.glob("source.*")):
        if candidate.suffix.lower() in _THUMBNAIL_EXTS or candidate.name.endswith(".info.json"):
            continue
        return candidate
    return None


def fetch_thumbnail(url: str, work_dir: Path) -> Optional[ThumbnailSource]:
    """Download only the source video's thumbnail (no video/audio) plus the bit
    of metadata the preview needs. Returns None when extraction succeeded but the
    video had no thumbnail; raises DownloadError on a fetch failure (bot check,
    unavailable video, ...) so the caller can report the real reason."""
    ensure_working_client(url)
    cmd = _base_cmd() + [
        "--skip-download", "--write-thumbnail", "--write-info-json",
        # We only want the thumbnail image + a little metadata, never a stream,
        # so don't let format selection abort when a client returns no formats.
        "--ignore-no-formats-error",
        "--output", str(work_dir / "thumb.%(ext)s"),
        url,
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        message = _clean_error(result.stderr) or "thumbnail fetch failed"
        log.warning("Thumbnail fetch failed for %s: %s", url, message)
        raise DownloadError(message)

    thumb = next(
        (str(p) for p in sorted(work_dir.glob("thumb.*")) if p.suffix.lower() in _THUMBNAIL_EXTS),
        None,
    )
    if thumb is None:
        return None
    info_path = work_dir / "thumb.info.json"
    info = json.loads(info_path.read_text(encoding="utf-8")) if info_path.exists() else {}
    return ThumbnailSource(
        thumbnail_path=thumb,
        title=info.get("title") or info.get("id") or "",
        original_language=info.get("language"),
        video_id=info.get("id") or "",
    )


def _find_thumbnail(work_dir: Path, video_path: Path) -> Optional[str]:
    """Locate the thumbnail yt-dlp saved next to the video (e.g. `source.webp`),
    ignoring the video file and the info-json. Returns its path, or None."""
    for candidate in sorted(work_dir.glob("source.*")):
        if candidate == video_path or candidate.name.endswith(".info.json"):
            continue
        if candidate.suffix.lower() in _THUMBNAIL_EXTS:
            return str(candidate)
    return None


def download_caption(url: str, lang: str, work_dir: Path, auto: bool) -> Optional[Path]:
    """Download a single caption track as VTT. Returns the file path, or None if
    the track doesn't exist -- or the download fails (a transient error). Callers
    treat both the same: fall back to the next-best transcript source rather than
    failing the whole job over one caption track."""
    cmd = _base_cmd() + [
        "--skip-download",
        "--write-auto-subs" if auto else "--write-subs",
        "--sub-langs", lang,
        "--sub-format", "vtt",
        "--ignore-no-formats-error",
        "--output", str(work_dir / "captions.%(ext)s"),
        url,
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        log.warning(
            "Caption download failed (lang=%s, auto=%s): %s", lang, auto, _clean_error(result.stderr)
        )
        return None
    for candidate in work_dir.glob("captions*.vtt"):
        return candidate
    return None
