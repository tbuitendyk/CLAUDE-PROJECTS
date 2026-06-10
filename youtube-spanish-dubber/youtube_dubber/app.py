"""HTTP service: submit YouTube URLs to be dubbed into Spanish and republished.

Endpoints
---------
POST /jobs           {"url": "<youtube url>", "target_language": "es", "mode": "dub",
                      "transcript_overrides": [{"start": 0.0, "end": 4.2, "text": "..."}]}
                     -> create a job. mode "dub" (default) runs the full
                     pipeline and publishes to YouTube; mode "preview" stops
                     after acquiring/translating the transcript and returns
                     the original-language and Spanish text side by side as
                     `result`, for diagnosing transcription vs. translation
                     quality without the slow synthesis/mux/upload stages.
                     `transcript_overrides` is optional and only consulted in
                     "dub" mode: when present, it replaces the normal
                     transcript-acquisition stage outright with these exact
                     timed lines -- e.g. a "preview transcript first" result
                     the user reviewed and hand-edited -- so the dub says
                     precisely what was approved. `thumbnail_override` (a
                     base64 data-URI) similarly carries an approved/edited
                     thumbnail to use verbatim instead of auto-generating one.
POST /thumbnail/preview  {"url": "<youtube url>", "target_language": "es"}
                     -> fetch ONLY the source thumbnail (no video) and return
                     it next to the generated (text-translated + branded)
                     version, with per-region translations as editable fields.
                     Cheap enough to run the moment a URL is pasted.
POST /thumbnail/render   {"original": "<data-uri>", "regions": [{"polygon":..,
                      "translation": ".."}], "banner_text": ".."}
                     -> re-render the thumbnail from edited translations (the
                     "edit the text" loop); returns the new generated image.
GET  /jobs           list recent jobs
GET  /jobs/{id}      fetch a single job's status/progress/result
DELETE /jobs/{id}    cancel a still-queued job (a job that's already running
                     can't be cancelled here -- restart the service for that)
POST /admin/restart  restart the service (frees model memory, kills a running
                     job): the process exits cleanly and systemd respawns it
GET  /healthz        liveness check
"""
from __future__ import annotations

import logging
import os
import re
import threading
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator

from . import db, worker
from .config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)

_YOUTUBE_URL_RE = re.compile(
    r"^https?://(www\.)?(youtube\.com/(watch\?v=|shorts/|live/)|youtu\.be/)[\w\-]+",
    re.IGNORECASE,
)

app = FastAPI(
    title="YouTube Spanish Dubber",
    description="Submit a YouTube URL; get back a Spanish-dubbed re-upload to your channel.",
    version="1.0.0",
)


def _require_youtube_url(value: str) -> str:
    value = value.strip()
    if not _YOUTUBE_URL_RE.match(value):
        raise ValueError("Must be a youtube.com or youtu.be video URL")
    return value


class TranscriptOverrideLine(BaseModel):
    """One hand-edited line from a "preview transcript first" pass, carried
    over verbatim into the dub so the narration says exactly what was
    reviewed (and possibly corrected) -- not a freshly re-acquired transcript
    that might land on different lines entirely."""
    start: float
    end: float
    text: str


class JobCreateRequest(BaseModel):
    url: str
    target_language: Optional[str] = None
    mode: str = "dub"
    transcript_overrides: Optional[list[TranscriptOverrideLine]] = None
    # A thumbnail the user previewed/edited and approved (base64 data-URI),
    # used verbatim for the upload instead of auto-generating one. Only
    # consulted in "dub" mode.
    thumbnail_override: Optional[str] = None

    @field_validator("url")
    @classmethod
    def _validate_url(cls, value: str) -> str:
        return _require_youtube_url(value)

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, value: str) -> str:
        if value not in db.JOB_MODES:
            raise ValueError(f"mode must be one of {sorted(db.JOB_MODES)}")
        return value


class ThumbnailPreviewRequest(BaseModel):
    """Ask for the side-by-side original-vs-generated thumbnail for a URL,
    before any dub is started -- cheap because only the thumbnail is fetched,
    not the video."""
    url: str
    target_language: Optional[str] = None

    @field_validator("url")
    @classmethod
    def _validate_url(cls, value: str) -> str:
        return _require_youtube_url(value)


class ThumbnailRegionEdit(BaseModel):
    """One text region echoed back from a preview, with the translation the
    user settled on. `polygon` locates it (from the preview's `regions`); the
    server re-renders that text in place rather than re-detecting."""
    polygon: list[list[float]]
    translation: str
    text: Optional[str] = None


class ThumbnailRenderRequest(BaseModel):
    """Re-render a thumbnail from edited regions (the "edit the text" loop).
    `original` is the unmodified source thumbnail (data-URI) echoed back so the
    server stays stateless between edits."""
    original: str
    regions: list[ThumbnailRegionEdit] = []
    banner_text: Optional[str] = None


@app.on_event("startup")
def _on_startup() -> None:
    db.init_db()
    # A fresh process can't have anything actually running -- reconcile any
    # `running` rows left over from a previous restart/crash so the queue
    # reflects reality (and abandoned jobs don't linger as "stuck").
    reset = db.reset_orphaned_running_jobs()
    if reset:
        log.info("Reset %d orphaned 'running' job(s) left over from a previous run", reset)
    worker.start_background()
    log.info("Service ready on http://%s:%s", settings.host, settings.port)


def _schedule_self_exit(delay: float = 0.4) -> None:
    """Exit the process shortly after returning the HTTP response; the systemd
    unit (Restart=always) respawns it. Isolated into its own function so tests
    can stub it out instead of actually tearing the process down."""
    threading.Timer(delay, lambda: os._exit(0)).start()


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


def _validated_thumbnail_override(raw: Optional[str]) -> Optional[str]:
    """Accept an approved-thumbnail data-URI only if it actually decodes to an
    image, so a malformed override is rejected up front rather than silently
    dropped deep in the pipeline."""
    if not raw:
        return None
    from .pipeline import thumbnail_preview

    try:
        thumbnail_preview.data_uri_to_image(raw)
    except Exception as exc:  # noqa: BLE001 -- surface as a 422 to the caller
        raise HTTPException(status_code=422, detail="thumbnail_override is not a valid image") from exc
    return raw


@app.post("/jobs", status_code=201)
def create_job(payload: JobCreateRequest) -> dict:
    overrides = [line.model_dump() for line in payload.transcript_overrides] if payload.transcript_overrides else None
    thumbnail_override = _validated_thumbnail_override(payload.thumbnail_override)
    job = db.create_job(
        payload.url, payload.target_language, mode=payload.mode,
        transcript_overrides=overrides, thumbnail_override=thumbnail_override,
    )
    return job.to_dict()


@app.post("/thumbnail/preview")
def thumbnail_preview(payload: ThumbnailPreviewRequest) -> dict:
    """Fetch just the source thumbnail and return it alongside the generated
    (translated + branded) version, plus the per-region translations as
    editable fields. Fast: no video is downloaded. The client then either
    approves `generated` (submitting it back as `thumbnail_override` on POST
    /jobs) or edits the regions and calls POST /thumbnail/render."""
    import tempfile
    from pathlib import Path

    from PIL import Image

    from .pipeline import downloader, thumbnail_preview as tp

    target = payload.target_language or settings.target_language
    with tempfile.TemporaryDirectory() as tmp:
        source = downloader.fetch_thumbnail(payload.url, Path(tmp))
        if source is None:
            raise HTTPException(status_code=422, detail="Couldn't fetch a thumbnail for that video")
        with Image.open(source.thumbnail_path) as opened:
            original = opened.convert("RGB")
        generated, regions = tp.generate_preview(
            original,
            from_code=(source.original_language or "en"),
            to_code=target,
            min_confidence=settings.thumbnail_ocr_min_confidence,
            banner_text=settings.thumbnail_banner_text,
            font=settings.thumbnail_font,
        )
        result = {
            "video_id": source.video_id,
            "title": source.title,
            "source_language": source.original_language or "en",
            "banner_text": settings.thumbnail_banner_text,
            "original": tp.image_to_data_uri(original),
            "generated": tp.image_to_data_uri(generated),
            "regions": regions,
        }
    return result


@app.post("/thumbnail/render")
def thumbnail_render(payload: ThumbnailRenderRequest) -> dict:
    """Re-render a thumbnail from edited region translations and return the new
    generated image -- the live update behind the "edit the text" controls."""
    from .pipeline import thumbnail_preview as tp

    try:
        image = tp.data_uri_to_image(payload.original)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail="`original` is not a valid image") from exc

    banner = settings.thumbnail_banner_text if payload.banner_text is None else payload.banner_text
    generated = tp.render_edited(
        image,
        [region.model_dump() for region in payload.regions],
        banner_text=banner,
        font=settings.thumbnail_font,
    )
    return {"generated": tp.image_to_data_uri(generated)}


@app.get("/jobs")
def get_jobs(limit: int = 50) -> list[dict]:
    return [job.to_dict() for job in db.list_jobs(limit=limit)]


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.to_dict()


@app.delete("/jobs/{job_id}")
def cancel_job(job_id: str) -> dict:
    """Cancel a job that's still waiting in the queue.

    Only `queued` jobs can be cancelled: the worker processes one job at a
    time, so a `running` job is already mid-pipeline and would need the
    service restarted to stop. We return 409 in that case rather than
    pretending to cancel something we can't actually interrupt.
    """
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if db.cancel_queued_job(job_id):
        cancelled = db.get_job(job_id)
        return cancelled.to_dict() if cancelled else job.to_dict()
    # The conditional update didn't fire: the job left the queue first.
    raise HTTPException(
        status_code=409,
        detail=(
            f"Job is '{job.status}' and can no longer be cancelled. "
            "A job that's already running must be stopped by restarting the service."
        ),
    )


@app.post("/admin/restart")
def restart_service() -> dict:
    """Restart the dubber service.

    The single in-process worker keeps the heavy ML models (Whisper / Argos /
    ONNX) resident, and a wedged job can only be stopped by tearing the process
    down -- so "restart" is the operator's catch-all reset: it frees that
    memory and kills any running job. We exit cleanly and let systemd
    (Restart=always) respawn us; on the way back up, startup reconciles any
    job that was mid-flight (see `_on_startup`).
    """
    log.warning("Restart requested via /admin/restart; exiting for systemd to respawn.")
    _schedule_self_exit()
    return {"status": "restarting"}
