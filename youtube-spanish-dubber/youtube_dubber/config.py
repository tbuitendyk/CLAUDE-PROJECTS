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
    tts_rate: str = os.getenv("DUBBER_TTS_RATE", "+0%")

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
    # "replace": new Spanish track replaces the original audio entirely.
    # "duck": original audio is kept underneath at low volume (telenovela style).
    audio_mode: str = os.getenv("DUBBER_AUDIO_MODE", "replace")
    duck_original_volume: float = float(os.getenv("DUBBER_DUCK_VOLUME", "0.12"))

    # --- YouTube upload ---
    youtube_client_secrets_file: Path = field(
        default_factory=lambda: _path(
            "DUBBER_YT_CLIENT_SECRETS", "./secrets/client_secret.json"
        )
    )
    youtube_token_file: Path = field(
        default_factory=lambda: _path("DUBBER_YT_TOKEN_FILE", "./secrets/token.json")
    )
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
