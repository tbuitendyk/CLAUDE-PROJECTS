"""Central configuration, loaded from environment variables / a .env file.

Every setting has a sane free-tier default so the service can run with only
a handful of required values (mainly the YouTube OAuth client secret path).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _path(name: str, default: str) -> Path:
    return Path(os.getenv(name, default)).expanduser().resolve()


@dataclass(frozen=True)
class Settings:
    # --- Service ---
    host: str = os.getenv("DUBBER_HOST", "127.0.0.1")
    port: int = int(os.getenv("DUBBER_PORT", "8088"))

    # --- Storage ---
    data_dir: Path = field(default_factory=lambda: _path("DUBBER_DATA_DIR", "./data"))
    db_path: Path = field(default_factory=lambda: _path("DUBBER_DB_PATH", "./data/jobs.sqlite3"))

    # --- Dubbing language ---
    target_language: str = os.getenv("DUBBER_TARGET_LANGUAGE", "es")
    # Codes yt-dlp/YouTube use for "Spanish" captions, checked in priority order.
    spanish_caption_codes: tuple[str, ...] = (
        "es", "es-ES", "es-419", "es-US", "es-MX", "es-AR", "es-orig",
    )

    # --- Text-to-speech (edge-tts: free Microsoft neural voices, no API key) ---
    tts_voice: str = os.getenv("DUBBER_TTS_VOICE", "es-ES-AlvaroNeural")
    # Base synthesis rate. Tuned by ear against the anchored timeline; -5%
    # reads more naturally than the default pace for this voice.
    tts_rate: str = os.getenv("DUBBER_TTS_RATE", "-5%")
    # Cap on post-synthesis speed-up for a line that would otherwise overrun the
    # gap before the next line (1.0 = never speed up). Past ~1.3 speech sounds
    # rushed; anything that still won't fit is absorbed by the timeline's
    # catch-up (see tts.synthesize_track) rather than chipmunked.
    tts_max_tempo: float = float(os.getenv("DUBBER_TTS_MAX_TEMPO", "1.25"))

    # --- Speech-to-text fallback (faster-whisper: free, runs locally) ---
    whisper_model_size: str = os.getenv("DUBBER_WHISPER_MODEL", "small")
    whisper_device: str = os.getenv("DUBBER_WHISPER_DEVICE", "cpu")
    whisper_compute_type: str = os.getenv("DUBBER_WHISPER_COMPUTE_TYPE", "int8")
    # faster-whisper decodes the *entire* audio file into RAM before it starts,
    # so a long video's waveform alone can blow the memory budget. Transcribe in
    # time-windows of at most this many seconds (each extracted to a temp file
    # and released before the next) so the resident audio stays bounded no matter
    # the video length. 0 disables windowing (always single-pass).
    whisper_chunk_seconds: int = int(os.getenv("DUBBER_WHISPER_CHUNK_SECONDS", "600"))

    # --- Grammar-based punctuation restoration (rechunker.py) ---
    # A CPU ONNX model (no torch) that restores punctuation/casing on run-on,
    # unpunctuated transcripts so chunks can break at real sentence/clause
    # boundaries. Optional: if disabled or the model can't load, the rechunker
    # falls back to the pause/discourse-opener heuristic. Default model is the
    # English-only one (~smaller); override the repo for other languages.
    punctuation_model_enabled: bool = _bool("DUBBER_PUNCTUATION_MODEL_ENABLED", True)
    punctuation_model_repo: str = os.getenv("DUBBER_PUNCTUATION_MODEL_REPO", "1-800-BAD-CODE/punct_cap_seg_en")
    punctuation_model_spe: str = os.getenv("DUBBER_PUNCTUATION_MODEL_SPE", "spe_32k_lc_en.model")
    punctuation_model_onnx: str = os.getenv("DUBBER_PUNCTUATION_MODEL_ONNX", "punct_cap_seg_en.onnx")

    # --- Dubbing mix ---
    # "duck": keep the original audio as a music/ambience bed under the Spanish
    #   narration -- it sidechain-ducks under speech and swells back up in the
    #   pauses the anchored timeline preserves (documentary/telenovela style).
    # "replace": the new Spanish track replaces the original audio entirely.
    audio_mode: str = os.getenv("DUBBER_AUDIO_MODE", "duck")
    # Baseline level of that bed (its volume in the pauses, before ducking).
    duck_original_volume: float = float(os.getenv("DUBBER_DUCK_VOLUME", "0.40"))

    # --- YouTube upload ---
    youtube_client_secrets_file: Path = field(
        default_factory=lambda: _path(
            "DUBBER_YT_CLIENT_SECRETS", "./secrets/client_secret.json"
        )
    )
    youtube_token_file: Path = field(
        default_factory=lambda: _path("DUBBER_YT_TOKEN_FILE", "./secrets/token.json")
    )
    # Cookies (Netscape "cookies.txt" format) for yt-dlp's *download* side.
    # OFF by default: with the PO-token provider running, the token is the trust
    # signal, and supplying a *throwaway* account's cookies actively backfires --
    # yt-dlp routes to authenticated clients (web_creator) that return only
    # storyboards for videos that account doesn't own ("Requested format is not
    # available"). Enable only if you have cookies from an account that should be
    # used for extraction (e.g. to reach age-restricted/members content); the
    # provider alone handles ordinary bot-checks. Distinct from the OAuth upload
    # token above; yt-dlp can't use OAuth for extraction.
    youtube_use_cookies: bool = _bool("DUBBER_YT_USE_COOKIES", False)
    youtube_cookies_file: Path = field(
        default_factory=lambda: _path("DUBBER_YT_COOKIES_FILE", "./secrets/youtube_cookies.txt")
    )
    # Path to the standalone yt-dlp binary. We invoke yt-dlp as a separate
    # process -- the self-contained yt-dlp_linux release that bundles its own
    # Python -- so extraction stays current independent of this service's Python.
    # deploy/install.sh drops the latest at <install>/bin/yt-dlp each deploy.
    ytdlp_bin: Path = field(default_factory=lambda: _path("DUBBER_YTDLP_BIN", "./bin/yt-dlp"))
    # Directory holding the yt-dlp PO-token provider plugin (its `yt_dlp_plugins`
    # package). 2026 YouTube needs a Proof-of-Origin token for most formats; the
    # plugin fetches one from the local bgutil provider (bgutil-pot.service) so
    # downloads don't 403 / return no formats. install.sh populates this.
    ytdlp_plugin_dirs: Path = field(
        default_factory=lambda: _path("DUBBER_YTDLP_PLUGIN_DIRS", "./yt-dlp-plugins")
    )
    # Optional comma-separated YouTube player_client list to restrict yt-dlp to.
    # Left empty by default: with the PO-token provider up, yt-dlp's default
    # clients return the full ladder and download cleanly. Set it only to pin a
    # specific client for debugging.
    ytdlp_player_clients: str = os.getenv("DUBBER_YTDLP_PLAYER_CLIENTS", "")
    upload_privacy_status: str = os.getenv("DUBBER_UPLOAD_PRIVACY", "unlisted")
    upload_category_id: str = os.getenv("DUBBER_UPLOAD_CATEGORY", "22")
    title_prefix: str = os.getenv("DUBBER_TITLE_PREFIX", "[ES] ")
    description_suffix: str = os.getenv(
        "DUBBER_DESCRIPTION_SUFFIX",
        "\n\n---\nVoz en español generada automáticamente a partir del video original.",
    )

    # --- Thumbnail branding ---
    # Reuse the source video's own thumbnail for the dub (so the re-upload is
    # visually recognisable as the same video) with a small, consistent banner
    # overlaid. The branded image is applied via the YouTube API after upload.
    # Note: custom thumbnails require a phone-verified YouTube channel; if that
    # call fails the dub still publishes, just with YouTube's auto-thumbnail.
    thumbnail_enabled: bool = _bool("DUBBER_THUMBNAIL_ENABLED", True)
    thumbnail_banner_text: str = os.getenv("DUBBER_THUMBNAIL_BANNER_TEXT", "Versión Español")
    # Optional explicit TrueType font for the banner; empty = autodetect DejaVu
    # (installed by deploy/install.sh) or fall back to skipping the banner.
    thumbnail_font: str = os.getenv("DUBBER_THUMBNAIL_FONT", "")
    # In-place text localisation: detect the (English/source-language) text baked
    # into the thumbnail image, translate it and re-render the Spanish in place
    # -- *then* the banner above is still overlaid on top ("keep both"). Needs
    # the ONNX OCR stack (rapidocr-onnxruntime + opencv, see pipeline/ocr_onnx.py
    # + image_text.py). Fully optional and best-effort: if the stack is missing
    # or no text is found, the thumbnail just keeps its original text + banner.
    thumbnail_translate_text_enabled: bool = _bool("DUBBER_THUMBNAIL_TRANSLATE_TEXT", True)
    # Ignore detected regions the recognizer is less sure about than this (0..1);
    # low-confidence boxes are usually logos/textures, not real text to translate.
    thumbnail_ocr_min_confidence: float = float(os.getenv("DUBBER_THUMBNAIL_OCR_MIN_CONFIDENCE", "0.5"))
    # Font for re-rendered in-image text. Empty = autodetect a serif/"Roman" face
    # (DejaVuSerif), a closer match to stylized thumbnail titles than sans. Point
    # it at a .ttf to use a specific display font.
    thumbnail_text_font: str = os.getenv("DUBBER_THUMBNAIL_TEXT_FONT", "")
    # Serif-vs-sans is detected from the source glyphs' stroke-width modulation
    # (image_text). Clean sans renders ~0.15 and serif ~0.5, but real thumbnail
    # text (scene background, outlines, JPEG) inflates sans up toward ~0.55 --
    # overlapping serif -- so this cut sits above that observed sans ceiling to
    # bias toward sans (the common thumbnail face); only clearly-modulated text
    # reads serif. Raise it to lean more sans, lower to catch more serif.
    thumbnail_serif_threshold: float = float(os.getenv("DUBBER_THUMBNAIL_SERIF_THRESHOLD", "0.62"))

    # --- Worker ---
    poll_interval_seconds: float = float(os.getenv("DUBBER_POLL_INTERVAL", "5"))
    keep_work_dirs: bool = _bool("DUBBER_KEEP_WORK_DIRS", False)
    # Free the heavy ML models (Whisper / Argos / ONNX punctuation) once the
    # queue drains, so an idle service doesn't sit on hundreds of MB of resident
    # model memory (and its CTranslate2/onnxruntime thread pools) indefinitely.
    # They reload lazily on the next job.
    release_models_when_idle: bool = _bool("DUBBER_RELEASE_MODELS_WHEN_IDLE", True)

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        (self.data_dir / "jobs").mkdir(parents=True, exist_ok=True)
        self.youtube_client_secrets_file.parent.mkdir(parents=True, exist_ok=True)


settings = Settings()
