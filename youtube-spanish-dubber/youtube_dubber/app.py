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
                     precisely what was approved.
GET  /jobs           list recent jobs
GET  /jobs/{id}      fetch a single job's status/progress/result
DELETE /jobs/{id}    cancel a still-queued job (a job that's already running
                     can't be cancelled here -- restart the service for that)
GET  /healthz        liveness check
"""
from __future__ import annotations

import logging
import re
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

    @field_validator("url")
    @classmethod
    def _validate_url(cls, value: str) -> str:
        value = value.strip()
        if not _YOUTUBE_URL_RE.match(value):
            raise ValueError("Must be a youtube.com or youtu.be video URL")
        return value

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, value: str) -> str:
        if value not in db.JOB_MODES:
            raise ValueError(f"mode must be one of {sorted(db.JOB_MODES)}")
        return value


@app.on_event("startup")
def _on_startup() -> None:
    db.init_db()
    worker.start_background()
    log.info("Service ready on http://%s:%s", settings.host, settings.port)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.post("/jobs", status_code=201)
def create_job(payload: JobCreateRequest) -> dict:
    overrides = [line.model_dump() for line in payload.transcript_overrides] if payload.transcript_overrides else None
    job = db.create_job(payload.url, payload.target_language, mode=payload.mode, transcript_overrides=overrides)
    return job.to_dict()


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
