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
from importlib import import_module

from . import db, memory, progress
from .config import settings
from .pipeline import runner
from .pipeline.models import Segment

log = logging.getLogger(__name__)

_stop_event = threading.Event()

# Heavy models are cached as process-lifetime singletons in these pipeline
# modules. Each exposes a release hook so the worker can drop them when idle.
# (The pipeline also releases them per-stage *within* a job -- see
# transcript.py -- so they don't stack; this is the catch-all for whatever is
# still resident once the queue drains.)
_RELEASE_HOOKS = (
    ("speech_to_text", "release_model"),  # faster-whisper / CTranslate2
    ("translator", "clear_cache"),        # Argos Translate (per-pair CTranslate2)
    ("punctuation_onnx", "release_model"),  # onnxruntime session
    ("ocr_onnx", "release_model"),        # onnxruntime OCR sessions (thumbnail)
    ("rechunker", "release_models"),      # spaCy NLP models
)


def release_idle_memory() -> None:
    """Free the cached ML models so an idle service doesn't sit on their RAM.

    Called when the queue drains. The models reload lazily on the next job (a
    few seconds' cost), which is a good trade against holding hundreds of MB
    resident for hours of idleness."""
    if not settings.release_models_when_idle:
        return
    for module_name, fn_name in _RELEASE_HOOKS:
        try:
            module = import_module(f".pipeline.{module_name}", __package__)
            getattr(module, fn_name)()
        except Exception as exc:  # noqa: BLE001 -- optional dep missing, etc.
            log.debug("Idle model release skipped for %s (%s)", module_name, exc)
    memory.release_to_os()
    log.info("Released cached models; service is idle.")


def _make_progress_fn(job_id: str):
    def on_progress(stage: str, message: str, fraction: float | None = None) -> None:
        log.info("[job %s] (%s) %s", job_id, stage, message)
        fields = {"stage": stage, "progress": message}
        pct = progress.overall_percent(stage, fraction)
        if pct is not None:
            fields["progress_pct"] = pct
        db.update_job(job_id, **fields)
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
                progress_pct=100.0,
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
                progress_pct=100.0,
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
    did_work = False
    while not _stop_event.is_set():
        job = db.claim_next_job()
        if job is None:
            # Queue just drained: release the heavy models once, then idle.
            if did_work:
                release_idle_memory()
                did_work = False
            _stop_event.wait(settings.poll_interval_seconds)
            continue
        log.info("Claimed job %s for %s", job.id, job.source_url)
        _process(job)
        did_work = True


def start_background() -> threading.Thread:
    thread = threading.Thread(target=loop, name="dubbing-worker", daemon=True)
    thread.start()
    return thread


def stop() -> None:
    _stop_event.set()
