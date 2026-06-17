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
from pathlib import Path

from . import db, memory, naming, progress
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


def _make_progress_fn(job_id: str, mode: str = "dub"):
    # Intro-republish jobs get their own progress bands (mux then upload) so the
    # bar starts near 0 instead of inheriting a dub's near-done "muxing" band.
    bands = progress.INTRO_STAGE_BANDS if mode == "intro" else None

    def on_progress(stage: str, message: str, fraction: float | None = None) -> None:
        log.info("[job %s] (%s) %s", job_id, stage, message)
        fields = {"stage": stage, "progress": message}
        pct = progress.overall_percent(stage, fraction, bands=bands)
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


def _materialize_thumbnail_override(raw: str | None, work_dir):
    """Decode a job's approved thumbnail (base64 data-URI) to a JPEG in the work
    dir and return its path, or None if there's nothing usable. The image was
    finalised in the preview (translated text + banner already baked in), so the
    pipeline uses it as-is."""
    if not raw:
        return None
    try:
        from .pipeline import thumbnail_preview

        image = thumbnail_preview.data_uri_to_image(raw)
        path = work_dir / "thumbnail_override.jpg"
        image.save(path, "JPEG", quality=90)
        return path
    except Exception as exc:  # noqa: BLE001 -- a bad override just falls back to auto
        log.warning("Ignoring unusable thumbnail_override (%s)", exc)
        return None


def _job_project(job: db.Job) -> db.Project | None:
    """The library entry a job belongs to: the one it was created against, or
    (legacy jobs / direct API calls) THE entry for its source video + language."""
    if job.project_id:
        project = db.get_project(job.project_id)
        if project is not None:
            return project
    source_id = naming.extract_video_id(job.source_url)
    if source_id is None:
        return None
    project = db.upsert_project(source_id, job.target_language)
    db.update_job(job.id, project_id=project.id)
    return project


def _cache_bed(project: db.Project, bed_source: str | None) -> None:
    """Compress a freshly separated bed into the project's permanent cache (so
    separation never runs again for this project). Best-effort: a dub that
    already published must not fail over its cache."""
    if not bed_source or not Path(bed_source).exists():
        return
    try:
        from .pipeline import ffmpeg_utils

        dst = ffmpeg_utils.encode_bed_cache(Path(bed_source), db.project_bed_path(project.id))
        db.update_project(project.id, bed_path=str(dst))
        log.info("Cached the music/SFX bed for project %s at %s", project.id, dst)
    except Exception as exc:  # noqa: BLE001
        log.warning("Couldn't cache the separated bed for project %s (%s)", project.id, exc)


def _cache_master(project: db.Project, dubbed_path: str | None) -> None:
    """Persist the finished dub as the project's pre-intro master, so an intro can
    be attached/removed/swapped later without re-dubbing. Best-effort: a dub that
    already published must not fail over its master cache."""
    if not dubbed_path or not Path(dubbed_path).exists():
        return
    try:
        dst = db.project_master_path(project.id)
        shutil.copy2(dubbed_path, dst)
        db.set_project_master(project.id, dst)
        log.info("Saved pre-intro master for project %s at %s", project.id, dst)
    except Exception as exc:  # noqa: BLE001
        log.warning("Couldn't save the pre-intro master for project %s (%s)", project.id, exc)


def _finish_dub(job: db.Job, project: db.Project | None, result: dict,
                applied_intro: "db.Intro | None" = None) -> None:
    """Persist a successful publish on both the job row and the library entry.

    `applied_intro` is the intro that was prepended to this publish (the
    "Dub & publish with an intro" path); None means the master was uploaded
    bare, which clears any previously-attached intro since it no longer
    describes the new video."""
    rows = result.get("transcript") or []
    if project is not None:
        # Re-fetch: the entry may have gained rows/edits since the job started
        # (the job ran from its own snapshot; the entry kept living).
        project = db.get_project(project.id) or project
        # A redub's override rows carry only the narrated text; restore the
        # immutable source-language column from the entry so the library never
        # holds a target-only transcript.
        donor = project.source_rows_list() or project.rows_list()
        if donor and not all(r.get("original_text") for r in rows):
            rows = db.fill_original_texts(rows, donor)
        _cache_bed(project, result.get("bed_source_path"))
        _cache_master(project, result.get("dubbed_path"))
        if result.get("source_title") and not project.source_title:
            db.update_project(project.id, source_title=result["source_title"])
        db.mark_project_published(
            project.id,
            target_video_id=result["youtube_video_id"],
            title=result.get("title") or "",
            rows=rows,
            thumbnail=job.thumbnail_override,
            voice=result.get("voice"),
            privacy=job.privacy,
        )
        # Record the intro this publish actually carried: an intro the operator
        # chose for "Dub & publish" stays attached, while a bare upload clears any
        # previously-attached intro (it no longer describes the new master). Keep
        # the published description for a later intro-republish. `dubbed_rows`
        # snapshots the transcript just baked into the master: the baseline later
        # edits derive "pending dub" (green) against, so that colouring persists
        # across a close/re-open rather than resetting.
        db.update_project(
            project.id,
            description=result.get("description"),
            intro_id=applied_intro.id if applied_intro else None,
            intro_duration=applied_intro.duration if applied_intro else 0.0,
            dubbed_rows=json.dumps(rows),
        )
    db.update_job(
        job.id,
        status="done",
        stage="done",
        progress=f"Published: {result['youtube_video_url']}",
        progress_pct=100.0,
        youtube_video_id=result["youtube_video_id"],
        youtube_video_url=result["youtube_video_url"],
        # Retain the timestamped transcript + generated title for the
        # transcripts library and redub.
        transcript=json.dumps(rows) if rows else None,
        title=result.get("title"),
        error=None,
    )
    db.record_event(
        "Published",
        video_title=result.get("title") or result.get("source_title"),
        project_id=project.id if project else None,
        job_id=job.id,
        detail=result["youtube_video_url"],
    )


def _finish_remaster(job: db.Job, project: db.Project | None, result: dict) -> None:
    """Persist a prepared-but-unpublished dub: cache its master + bed and record
    the transcript it was dubbed from (so edits afterward green correctly), but
    do NOT upload or move the entry's published video. The entry keeps pointing
    at whatever is live (if anything); the refreshed master sits ready for a
    later "publish current cut"."""
    rows = result.get("transcript") or []
    if project is not None:
        project = db.get_project(project.id) or project
        # A redub's override rows are target-only; restore the source column.
        donor = project.source_rows_list() or project.rows_list()
        if donor and not all(r.get("original_text") for r in rows):
            rows = db.fill_original_texts(rows, donor)
        _cache_bed(project, result.get("bed_source_path"))
        _cache_master(project, result.get("dubbed_path"))
        # A first dub (no prior transcript) seeds the entry's working/pristine
        # rows; a redub already has them and store_acquired_transcript won't
        # clobber the edits we just dubbed.
        if rows:
            db.store_acquired_transcript(project.id, rows)
        # The master was just dubbed from `rows`: that's the green baseline.
        db.set_project_dubbed_rows(project.id, rows)
        updates: dict = {}
        if result.get("description"):
            updates["description"] = result["description"]
        if result.get("title") and not project.title:
            updates["title"] = result["title"]
        if result.get("source_title") and not project.source_title:
            updates["source_title"] = result["source_title"]
        if result.get("voice") and not project.voice:
            updates["voice"] = result["voice"]
        if updates:
            db.update_project(project.id, **updates)
    db.update_job(
        job.id,
        status="done",
        stage="done",
        progress="Master prepared (not published).",
        progress_pct=100.0,
        transcript=json.dumps(rows) if rows else None,
        title=result.get("title"),
        error=None,
    )
    db.record_event(
        "Dub prepared (not published)",
        video_title=(project.source_title or project.title) if project else None,
        project_id=project.id if project else None,
        job_id=job.id,
    )


def _finish_preview(job: db.Job, project: db.Project | None, result: dict) -> None:
    """A finished transcript preview becomes the entry's draft transcript (the
    library is the home of every transcript, drafts included)."""
    if project is not None:
        if result.get("title") and not project.source_title:
            db.update_project(project.id, source_title=result["title"])
        if result.get("rows"):
            db.store_acquired_transcript(project.id, result["rows"])
    db.update_job(
        job.id,
        status="done",
        stage="done",
        progress=f"Transcript preview ready via: {result['transcript_source']}",
        progress_pct=100.0,
        result=json.dumps(result),
        error=None,
    )
    db.record_event(
        "Transcript preview ready",
        video_title=result.get("title"),
        project_id=project.id if project else None,
        job_id=job.id,
        detail=result.get("transcript_source"),
    )


_PUBLISHED_METADATA_FLAG = "published_metadata_backfilled"


def _fetch_published_metadata(video_id: str) -> tuple[str | None, str | None]:
    """Fetch a published video's current title and thumbnail (as a data-URI)
    from YouTube. Module-level so tests can stub it. Lazy imports keep yt-dlp /
    PIL out of the lean import path."""
    import tempfile
    from pathlib import Path

    from PIL import Image

    from . import naming
    from .pipeline import downloader, thumbnail_preview as tp

    with tempfile.TemporaryDirectory() as tmp:
        source = downloader.fetch_thumbnail(naming.watch_url(video_id), Path(tmp))
        if source is None:
            return None, None
        thumbnail = None
        if source.thumbnail_path:
            with Image.open(source.thumbnail_path) as image:
                thumbnail = tp.image_to_data_uri(image.convert("RGB"))
        return (source.title or None), thumbnail


def backfill_published_metadata() -> int:
    """One-time fix: load the live published title + thumbnail onto library
    entries that are published but missing either. Runs once (meta-flag guarded),
    best-effort per entry; a transient YouTube failure leaves the flag unset so
    the remaining entries are retried on the next restart. Returns how many
    entries were filled."""
    if db.get_meta(_PUBLISHED_METADATA_FLAG):
        return 0
    targets = [
        p for p in db.list_projects()
        if p.target_video_id and (not p.title or not p.thumbnail)
    ]
    if not targets:
        db.set_meta(_PUBLISHED_METADATA_FLAG)
        return 0

    filled = 0
    failures = 0
    for project in targets:
        try:
            title, thumbnail = _fetch_published_metadata(project.target_video_id)
            if not title and not thumbnail:
                log.warning("Published video %s returned no title/thumbnail; skipping",
                            project.target_video_id)
                failures += 1
                continue
            db.set_published_metadata(
                project.id,
                title=title if not project.title else None,
                thumbnail=thumbnail if not project.thumbnail else None,
            )
            db.record_event(
                "Library repaired: loaded published title & thumbnail",
                video_title=title or project.title, project_id=project.id,
            )
            filled += 1
        except Exception as exc:  # noqa: BLE001 -- best effort; retried next restart
            log.warning("Couldn't load published metadata for %s (%s)",
                        project.target_video_id, exc)
            failures += 1

    if failures == 0:
        db.set_meta(_PUBLISHED_METADATA_FLAG)
    log.info("Backfilled published title/thumbnail onto %d entr(ies); %d failed",
             filled, failures)
    return filled


def _apply_thumbnail(video_id: str, thumbnail, work_dir) -> None:
    """Set a video's thumbnail from either a ready JPEG path (a freshly branded
    dub) or a stored data-URI (an entry's saved thumbnail). Best-effort: a
    publish stands even if the channel can't take a custom thumbnail."""
    if not thumbnail:
        return
    from .pipeline import uploader

    try:
        thumb_path = thumbnail if isinstance(thumbnail, Path) else _materialize_thumbnail_override(thumbnail, work_dir)
        if thumb_path is not None:
            uploader.set_thumbnail(video_id, thumb_path)
    except Exception as exc:  # noqa: BLE001
        log.warning("Couldn't set the thumbnail on publish %s (%s)", video_id, exc)


def _publish_master(
    *, master_path, title, description, thumbnail, intro,
    source_video_id, target_language, privacy, work_dir, on_progress,
) -> dict:
    """Publish a pre-intro master as a NEW YouTube video (YouTube has no
    replace-media API -- a new id every time), optionally prepending `intro`
    first. Shared by the intro-republish path (metadata from the entry) and the
    dub-and-publish path (metadata fresh from the pipeline)."""
    from .pipeline import ffmpeg_utils, uploader

    master = Path(master_path)
    if not master.exists():
        raise RuntimeError(
            "This project has no saved pre-intro master to publish from. Re-dub it "
            "once (so the master is stored) before adding or changing an intro."
        )

    if intro is not None:
        intro_file = Path(intro.file_path)
        if not intro_file.exists():
            raise RuntimeError("The selected intro's media is missing on the server; re-add it.")
        upload_file = work_dir / "with_intro.mp4"
        ffmpeg_utils.prepend_intro(
            intro_file, master, upload_file,
            on_progress=lambda msg, frac=None: on_progress("muxing", msg, fraction=frac),
        )
    else:
        on_progress("muxing", "Preparing the video without an intro…")
        upload_file = master

    # Ensure the "Original video: <link>" credit is on the description (idempotent
    # -- a freshly composed dub description already carries it; an older stored
    # one may not).
    description = description or ""
    credit = naming.original_video_credit(target_language, source_video_id)
    if credit not in description:
        description = f"{description}\n\n{credit}".strip()

    on_progress("uploading", "Uploading the new video to YouTube…")
    video_id = uploader.upload_video(
        upload_file,
        title=title or "",
        description=description,
        privacy_status=privacy,
        on_progress=lambda f: on_progress("uploading", f"Uploading to YouTube… {int(f * 100)}%", fraction=f),
    )
    _apply_thumbnail(video_id, thumbnail, work_dir)

    return {
        "youtube_video_id": video_id,
        "youtube_video_url": f"https://youtu.be/{video_id}",
        "had_intro": intro is not None,
    }


def _process_intro(job: db.Job, project: db.Project | None, work_dir, on_progress) -> dict:
    """(Re)publish a project from its saved pre-intro master, with the project's
    currently-attached intro prepended (or none) -- the "Publish current cut"
    path. Reuses the dub's transcript + thumbnail unchanged; only the intro and
    the resulting video id move."""
    if project is None or not project.master_path or not Path(project.master_path).exists():
        raise RuntimeError(
            "This project has no saved pre-intro master to publish from. Re-dub it "
            "once (so the master is stored) before adding or changing an intro."
        )
    intro = db.get_intro(project.intro_id) if project.intro_id else None
    if project.intro_id and intro is None:
        raise RuntimeError("The selected intro no longer exists.")

    return _publish_master(
        master_path=project.master_path,
        title=project.title or "",
        description=project.description or "",
        thumbnail=project.thumbnail,
        intro=intro,
        source_video_id=project.source_video_id,
        target_language=project.target_language,
        privacy=job.privacy or project.privacy,
        work_dir=work_dir,
        on_progress=on_progress,
    )


def _finish_intro(job: db.Job, project: db.Project | None, result: dict) -> None:
    """Point the library entry at the newly-published video (intro state already
    set by the endpoint; transcript + thumbnail unchanged)."""
    if project is not None:
        project = db.get_project(project.id) or project
        db.mark_project_published(
            project.id,
            target_video_id=result["youtube_video_id"],
            title=project.title or "",
            rows=project.rows_list(),
            thumbnail=project.thumbnail,
            voice=project.voice,
            privacy=job.privacy or project.privacy,
        )
    db.update_job(
        job.id,
        status="done",
        stage="done",
        progress=f"Published: {result['youtube_video_url']}",
        progress_pct=100.0,
        youtube_video_id=result["youtube_video_id"],
        youtube_video_url=result["youtube_video_url"],
        title=project.title if project else None,
        error=None,
    )
    db.record_event(
        "Intro added" if result.get("had_intro") else "Intro removed",
        video_title=(project.source_title or project.title) if project else None,
        project_id=project.id if project else None,
        job_id=job.id,
        detail=result["youtube_video_url"],
    )


def _process(job: db.Job) -> None:
    work_dir = db.job_work_dir(job.id)
    on_progress = _make_progress_fn(job.id, job.mode)
    project = _job_project(job)
    try:
        if job.mode == "preview":
            result = runner.preview_transcript(job.source_url, job.target_language, work_dir, on_progress=on_progress)
            _finish_preview(job, project, result)
        elif job.mode == "intro":
            result = _process_intro(job, project, work_dir, on_progress)
            _finish_intro(job, project, result)
        else:
            # "dub" publishes the new master; "remaster" prepares it and stops.
            # A "dub" with an intro selected can't publish from inside the runner
            # (the intro must be prepended first), so it produces the master
            # unpublished here too, then publishes via the shared helper.
            publish = job.mode != "remaster"
            intro = db.get_intro(job.intro_id) if (publish and job.intro_id) else None
            if publish and job.intro_id and intro is None:
                raise RuntimeError("The selected intro no longer exists.")
            run_publishes = publish and intro is None  # bare publish stays inside runner
            transcript_override = _load_transcript_override(job.transcript_overrides)
            thumbnail_override = _materialize_thumbnail_override(job.thumbnail_override, work_dir)
            cached_bed = Path(project.bed_path) if project and project.bed_path else None
            result = runner.run(
                job.source_url, job.target_language, work_dir,
                on_progress=on_progress, transcript_override=transcript_override,
                thumbnail_override=thumbnail_override,
                privacy=job.privacy,
                voice=job.voice or (project.voice if project else None),
                cached_bed=cached_bed,
                publish=run_publishes,
            )
            if not publish:
                _finish_remaster(job, project, result)
            elif intro is None:
                _finish_dub(job, project, result)
            else:
                # Prepend the chosen intro to the just-built master and publish.
                published = _publish_master(
                    master_path=result["dubbed_path"],
                    title=result.get("title") or "",
                    description=result.get("description") or "",
                    thumbnail=Path(result["thumbnail_path"]) if result.get("thumbnail_path") else None,
                    intro=intro,
                    source_video_id=result.get("source_video_id") or naming.extract_video_id(job.source_url),
                    target_language=job.target_language,
                    privacy=job.privacy or (project.privacy if project else None),
                    work_dir=work_dir, on_progress=on_progress,
                )
                result["youtube_video_id"] = published["youtube_video_id"]
                result["youtube_video_url"] = published["youtube_video_url"]
                _finish_dub(job, project, result, applied_intro=intro)
    except Exception as exc:  # noqa: BLE001 -- surface any failure on the job record
        log.exception("Job %s failed", job.id)
        friendly = _friendly_error(exc)
        db.update_job(
            job.id,
            status="failed",
            stage="failed",
            error=f"{friendly}\n\n{exc}\n\n{traceback.format_exc()[-4000:]}",
        )
        db.record_event(
            {"preview": "Transcript preview failed", "intro": "Intro republish failed",
             "remaster": "Dub prep failed"}.get(job.mode, "Dub failed"),
            video_title=(project.source_title if project else None) or job.source_url,
            project_id=project.id if project else None,
            job_id=job.id,
            detail=friendly,
        )
        # Capture a full verbose extraction diagnostic so we can see exactly why
        # (served by GET /diagnostics/last). Best-effort; only for the bot-check /
        # no-formats family, where the trace is the whole answer.
        if settings.capture_extraction_diagnostics and _looks_like_extraction_failure(exc):
            try:
                from . import diagnostics

                diagnostics.capture_failure(job.source_url, job.id)
                log.info("Captured extraction diagnostic for failed job %s", job.id)
            except Exception:  # noqa: BLE001
                log.warning("Couldn't capture extraction diagnostic for job %s", job.id)
    finally:
        if not settings.keep_work_dirs:
            shutil.rmtree(work_dir, ignore_errors=True)


def _looks_like_extraction_failure(exc: Exception) -> bool:
    """True for the YouTube extraction failures whose verbose trace is worth
    auto-capturing (bot-check, no/unavailable formats, sign-in walls)."""
    low = str(exc).lower()
    return any(s in low for s in (
        "not a bot", "sign in to confirm", "requested format is not available",
        "no formats", "unable to download", "fetch that video", "po token", "extractor",
    ))


def _friendly_error(exc: Exception) -> str:
    """Turn a raw pipeline/yt-dlp error into a short, actionable line for the
    activity log and the job's headline error. Falls back to the first line of
    the original message for anything we don't specifically recognise."""
    message = str(exc)
    low = message.lower()
    if "not a bot" in low or "sign in to confirm" in low or "confirm you're not a bot" in low:
        return (
            "YouTube blocked the download with a bot-check. The Proof-of-Origin token "
            "provider isn't returning valid tokens — redeploy the dubber to rebuild it "
            "(it now tracks the latest provider), or enable cookies (DUBBER_YT_USE_COOKIES)."
        )
    if "requested format is not available" in low:
        return (
            "YouTube returned no downloadable formats (usually the token provider is "
            "stale or cookies are routing to the wrong client). Redeploy to rebuild the "
            "token provider."
        )
    return message.split("\n")[0][:300]


def loop() -> None:
    log.info("Dubbing worker started (poll interval: %ss)", settings.poll_interval_seconds)
    # One-shot, operator-directed library maintenance runs BEFORE the queue is
    # touched, so its heavy STT passes never overlap a dub job's memory use.
    # Flag-guarded inside; a failure just retries on the next restart.
    try:
        from . import maintenance

        maintenance.run_pending()
    except Exception:  # noqa: BLE001 -- the queue must start regardless
        log.exception("Library maintenance pass failed; it will retry on the next restart")
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
