"""Background worker: claims queued jobs and runs the dubbing pipeline.

Runs as a single sequential loop on purpose -- transcription, translation,
TTS and video encoding are all CPU/memory heavy, and a small VPS will do far
better processing one dub at a time than thrashing on several concurrently.
"""
from __future__ import annotations

import json
import logging
import shutil
import threading
import time
import traceback

from . import db
from .config import settings
from .pipeline import runner
from .pipeline.models import Segment

log = logging.getLogger(__name__)

_stop_event = threading.Event()


def _make_progress_fn(job_id: str):
    def on_progress(stage: str, message: str) -> None:
        log.info("[job %s] (%s) %s", job_id, stage, message)
        db.update_job(job_id, stage=stage, progress=message)
    return on_progress


def _load_transcript_override(raw: str | None) -> list[Segment] | None:
    """Decode a job's saved `transcript_overrides` JSON (start/end/text rows
    from a hand-edited preview) into Segments ready for the TTS stage, or
    None if there's nothing usable -- so a fresh transcript gets acquired."""
    if not raw:
        return None
    try:
        rows = json.loads(raw)
    except ValueError:
        log.warning("Job has malformed transcript_overrides JSON; ignoring it")
        return None
    segments = [
        Segment(start=float(row["start"]), end=float(row["end"]), text=text)
        for row in rows
        if (text := str(row.get("text") or "").strip())
    ]
    return segments or None


def _process(job: db.Job) -> None:
    work_dir = db.job_work_dir(job.id)
    on_progress = _make_progress_fn(job.id)
    try:
        if job.mode == "preview":
            result = runner.preview_transcript(job.source_url, job.target_language, work_dir, on_progress=on_progress)
            db.update_job(
                job.id,
                status="done",
                stage="done",
                progress=f"Transcript preview ready via: {result['transcript_source']}",
                result=json.dumps(result),
                error=None,
            )
        else:
            transcript_override = _load_transcript_override(job.transcript_overrides)
            result = runner.run(
                job.source_url, job.target_language, work_dir,
                on_progress=on_progress, transcript_override=transcript_override,
            )
            db.update_job(
                job.id,
                status="done",
                stage="done",
                progress=f"Published: {result['youtube_video_url']}",
                youtube_video_id=result["youtube_video_id"],
                youtube_video_url=result["youtube_video_url"],
                error=None,
            )
    except Exception as exc:  # noqa: BLE001 -- surface any failure on the job record
        log.exception("Job %s failed", job.id)
        db.update_job(
            job.id,
            status="failed",
            stage="failed",
            error=f"{exc}\n\n{traceback.format_exc()[-4000:]}",
        )
    finally:
        if not settings.keep_work_dirs:
            shutil.rmtree(work_dir, ignore_errors=True)


def loop() -> None:
    log.info("Dubbing worker started (poll interval: %ss)", settings.poll_interval_seconds)
    while not _stop_event.is_set():
        job = db.claim_next_job()
        if job is None:
            _stop_event.wait(settings.poll_interval_seconds)
            continue
        log.info("Claimed job %s for %s", job.id, job.source_url)
        _process(job)


def start_background() -> threading.Thread:
    thread = threading.Thread(target=loop, name="dubbing-worker", daemon=True)
    thread.start()
    return thread


def stop() -> None:
    _stop_event.set()
