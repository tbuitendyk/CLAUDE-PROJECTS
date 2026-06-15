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
POST /thumbnail/apply    {"target_url": "<youtube url>", "thumbnail": "<data-uri>"}
                     -> push an approved thumbnail (from the preview/render
                     loop) onto an EXISTING video on the connected channel.
                     Standalone re-thumbnail tool, independent of dubbing; the
                     target must be a video the authorized channel owns, on a
                     phone-verified account.
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

from . import db, naming, worker
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


def _extract_video_id(url: str) -> str:
    """Pull the clean video ID from an (already URL-validated) YouTube link."""
    video_id = naming.extract_video_id(url)
    if not video_id:
        raise HTTPException(status_code=422, detail="Couldn't find a video ID in that URL")
    return video_id


def _youtube_fetch_detail(exc: Exception) -> str:
    """Trim yt-dlp's error into something a user can act on -- it's the only
    window we have into *why* an extraction failed (a bot check, an unavailable
    video, an aged-out extractor, ...), so surface it instead of a blank 'no
    thumbnail'."""
    msg = " ".join(str(exc).split())
    if msg.upper().startswith("ERROR:"):
        msg = msg[len("ERROR:"):].strip()
    if len(msg) > 300:
        msg = msg[:300] + "…"
    return f"Couldn't fetch that video from YouTube: {msg}" if msg else "Couldn't fetch that video from YouTube."


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
    # Per-job upload privacy ("public"/"unlisted"/"private"; None -> the global
    # DUBBER_UPLOAD_PRIVACY setting) and TTS voice (None -> the project's voice,
    # then the global setting).
    privacy: Optional[str] = None
    voice: Optional[str] = None

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

    @field_validator("privacy")
    @classmethod
    def _validate_privacy(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in db.PRIVACY_VALUES:
            raise ValueError(f"privacy must be one of {sorted(db.PRIVACY_VALUES)}")
        return value


class ThumbnailPreviewRequest(BaseModel):
    """Ask for the side-by-side original-vs-generated thumbnail for a URL,
    before any dub is started -- cheap because only the thumbnail is fetched,
    not the video."""
    url: str
    target_language: Optional[str] = None
    # Restore graphics the text wipe removed (strikethroughs, slashes, stickers).
    preserve_overlays: bool = False

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
    # Optional per-region overrides from the preview UI's pickers. `font_family`
    # is "serif"/"sans" (anything else -> auto-detect); `fill_color` is a
    # "#rrggbb" hex string (absent/invalid -> auto-detect the source colour).
    font_family: Optional[str] = None
    fill_color: Optional[str] = None


class ThumbnailRenderRequest(BaseModel):
    """Re-render a thumbnail from edited regions (the "edit the text" loop).
    `original` is the unmodified source thumbnail (data-URI) echoed back so the
    server stays stateless between edits."""
    original: str
    regions: list[ThumbnailRegionEdit] = []
    banner_text: Optional[str] = None
    # The "Auto-preserve original graphics" toggle: restore strikethroughs/
    # slashes/stickers the text wipe removed.
    preserve_overlays: bool = False


class ThumbnailApplyRequest(BaseModel):
    """Push an approved thumbnail (data-URI from the preview/render loop) onto an
    existing video on the connected channel. `target_url` is the video to
    re-thumbnail; it must belong to the authorized channel."""
    target_url: str
    thumbnail: str

    @field_validator("target_url")
    @classmethod
    def _validate_url(cls, value: str) -> str:
        return _require_youtube_url(value)


class TranscriptRow(BaseModel):
    """One timestamped transcript line. `original_text` is the source-language
    text (None for already-target captions / overrides); `translated_text` is
    what gets narrated."""
    start: float
    end: float
    original_text: Optional[str] = None
    translated_text: str


class TranscriptUpdateRequest(BaseModel):
    """A hand-fixed transcript saved back to the library before a redub."""
    rows: list[TranscriptRow]


class ProjectUpsertRequest(BaseModel):
    """Get-or-create THE library entry for (source video, language) -- the UI
    calls this before its first draft save for a new video."""
    url: str
    target_language: Optional[str] = None

    @field_validator("url")
    @classmethod
    def _validate_url(cls, value: str) -> str:
        return _require_youtube_url(value)


class ProjectThumbnailRequest(BaseModel):
    """Save (or, with null, revert-to-default) an entry's thumbnail. `edit_state`
    is the editor's full saved state (source image, banner text, overlay flag,
    per-region translation/font/colour) so re-opening restores it exactly.
    `as_published` marks it as the LIVE thumbnail (the re-thumbnail tool pushed
    it to YouTube) so the entry stays 'published', not falsely pending."""
    thumbnail: Optional[str] = None
    edit_state: Optional[dict] = None
    as_published: bool = False


class RedubRequest(BaseModel):
    """Re-dub a library entry from its saved transcript: new upload from the
    ORIGINAL source video, reusing the entry's voice, thumbnail and cached
    music/SFX bed."""
    privacy: Optional[str] = None

    @field_validator("privacy")
    @classmethod
    def _validate_privacy(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in db.PRIVACY_VALUES:
            raise ValueError(f"privacy must be one of {sorted(db.PRIVACY_VALUES)}")
        return value


class EventCreateRequest(BaseModel):
    """A client-side-only button press recorded into the permanent action log
    (server-backed actions log themselves)."""
    action: str
    video_title: Optional[str] = None
    project_id: Optional[str] = None
    detail: Optional[str] = None

    @field_validator("action")
    @classmethod
    def _validate_action(cls, value: str) -> str:
        value = value.strip()
        if not value or len(value) > 120:
            raise ValueError("action must be 1-120 characters")
        return value


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
    # One-time fix: load live published title/thumbnail onto entries missing
    # them. Runs in the background (it hits YouTube) so it never delays
    # readiness, and is meta-flag guarded so it only does real work once.
    threading.Thread(
        target=worker.backfill_published_metadata, name="published-metadata-backfill", daemon=True
    ).start()
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

    # Every job belongs to THE library entry for its (source video, language).
    # A dub with no explicit overrides picks up the entry's saved draft --
    # transcript and thumbnail -- automatically, so saved edits survive page
    # reloads and "Start dubbing" always speaks what the library holds.
    # (A URL we can't pull a clean 11-char ID from still dubs -- it just isn't
    # tracked in the library.)
    language = payload.target_language or settings.target_language
    video_id = naming.extract_video_id(payload.url)
    project = db.upsert_project(video_id, language) if video_id else None
    used_draft = []
    if payload.mode == "dub" and project is not None:
        if overrides is None:
            saved_rows = project.rows_list()
            if saved_rows:
                overrides = [
                    {"start": r["start"], "end": r["end"], "text": r["translated_text"]}
                    for r in saved_rows
                    if (r.get("translated_text") or "").strip()
                ] or None
                if overrides:
                    used_draft.append("transcript")
        if thumbnail_override is None and project.thumbnail:
            thumbnail_override = project.thumbnail
            used_draft.append("thumbnail")

    job = db.create_job(
        payload.url, language, mode=payload.mode,
        transcript_overrides=overrides, thumbnail_override=thumbnail_override,
        privacy=payload.privacy, voice=payload.voice,
        project_id=project.id if project else None,
    )

    label = (project.source_title or project.title if project else None) or payload.url
    project_id = project.id if project else None
    if payload.mode == "preview":
        db.record_event("Transcript preview started", video_title=label,
                        project_id=project_id, job_id=job.id)
    else:
        action = "Redub started" if project and project.target_video_id else "Dub started"
        detail_bits = [f"privacy: {payload.privacy}" if payload.privacy else None,
                       f"using saved {' + '.join(used_draft)}" if used_draft else None]
        db.record_event(action, video_title=label, project_id=project_id, job_id=job.id,
                        detail=", ".join(bit for bit in detail_bits if bit) or None)
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
        try:
            source = downloader.fetch_thumbnail(payload.url, Path(tmp))
        except Exception as exc:  # noqa: BLE001 -- surface the real upstream reason
            raise HTTPException(status_code=502, detail=_youtube_fetch_detail(exc)) from exc
        if source is None:
            raise HTTPException(status_code=422, detail="That video has no thumbnail image to fetch.")
        with Image.open(source.thumbnail_path) as opened:
            original = opened.convert("RGB")
        generated, regions = tp.generate_preview(
            original,
            from_code=(source.original_language or "en"),
            to_code=target,
            min_confidence=settings.thumbnail_ocr_min_confidence,
            banner_text=settings.thumbnail_banner_text,
            font=settings.thumbnail_font,
            preserve_overlays=payload.preserve_overlays,
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
        preserve_overlays=payload.preserve_overlays,
    )
    return {"generated": tp.image_to_data_uri(generated)}


@app.post("/thumbnail/apply")
def thumbnail_apply(payload: ThumbnailApplyRequest) -> dict:
    """Push an approved thumbnail onto an existing video on the connected
    channel -- the standalone "re-thumbnail a published video" action.

    The image is whatever the client approved from the /thumbnail/preview +
    /thumbnail/render loop (same data-URI shape as `thumbnail_override`). The
    target must be a video the authorized channel owns, on a phone-verified
    account; we surface YouTube's refusal reason rather than failing silently.
    """
    import tempfile
    from pathlib import Path

    from google.auth.exceptions import RefreshError
    from googleapiclient.errors import HttpError

    from .pipeline import thumbnail_preview as tp, uploader

    video_id = _extract_video_id(payload.target_url)
    try:
        image = tp.data_uri_to_image(payload.thumbnail).convert("RGB")
    except Exception as exc:  # noqa: BLE001 -- surface as a 422 to the caller
        raise HTTPException(status_code=422, detail="`thumbnail` is not a valid image") from exc

    with tempfile.TemporaryDirectory() as tmp:
        thumb_path = Path(tmp) / "thumbnail.jpg"
        image.save(thumb_path, "JPEG", quality=95)
        try:
            uploader.set_thumbnail(video_id, thumb_path, raise_on_error=True)
        except HttpError as exc:
            status = getattr(getattr(exc, "resp", None), "status", None)
            if status == 403:
                detail = (
                    "YouTube refused the thumbnail. Custom thumbnails need a phone-verified "
                    "channel, and you can only set one on a video your connected channel owns."
                )
            elif status == 404:
                detail = "No video with that ID was found on your connected channel."
            else:
                detail = f"YouTube rejected the thumbnail (HTTP {status})."
            raise HTTPException(status_code=502, detail=detail) from exc
        except RefreshError as exc:
            # invalid_grant: the saved OAuth token expired or was revoked -- the
            # whole YouTube connection is down (uploads fail too), not just this.
            # Tokens expire after 7 days while the OAuth consent screen is in
            # "Testing"; re-authorize, and set it to "In production" to stop it.
            raise HTTPException(
                status_code=502,
                detail="YouTube authorization has expired or been revoked. Re-run the one-time "
                       "'authorize' step on the server, and set the OAuth consent screen to "
                       "'In production' (Testing-mode tokens expire after 7 days).",
            ) from exc
        except Exception as exc:  # noqa: BLE001 -- e.g. missing/expired credentials
            raise HTTPException(
                status_code=502, detail="Couldn't set the thumbnail; check the service logs."
            ) from exc

    db.record_event("Thumbnail applied", video_title=payload.target_url,
                    detail=f"https://youtu.be/{video_id}")
    return {"video_id": video_id, "video_url": f"https://youtu.be/{video_id}", "status": "updated"}


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
        db.record_event("Job cancelled", video_title=job.title or job.source_url,
                        project_id=job.project_id, job_id=job.id)
        return cancelled.to_dict() if cancelled else job.to_dict()
    # The conditional update didn't fire: the job left the queue first.
    raise HTTPException(
        status_code=409,
        detail=(
            f"Job is '{job.status}' and can no longer be cancelled. "
            "A job that's already running must be stopped by restarting the service."
        ),
    )


@app.get("/transcripts")
def list_transcripts(limit: int = 100) -> list[dict]:
    """The transcripts library: finished dubs that retained a transcript, newest
    first, by generated video name (no full text -- see /transcripts/{id})."""
    return db.list_transcripts(limit=limit)


@app.get("/transcripts/{job_id}")
def get_transcript(job_id: str) -> dict:
    """The full timestamped transcript (rows + metadata) for one job."""
    data = db.get_transcript(job_id)
    if data is None:
        raise HTTPException(status_code=404, detail="No transcript stored for that job")
    return data


@app.put("/transcripts/{job_id}")
def update_transcript(job_id: str, payload: TranscriptUpdateRequest) -> dict:
    """Save a hand-fixed transcript back to the library (used before a redub)."""
    rows = [row.model_dump() for row in payload.rows]
    if not db.set_transcript(job_id, rows):
        raise HTTPException(status_code=404, detail="Job not found")
    return {"id": job_id, "rows": rows, "saved": True}


# --------------------------------------------------------------------------
# Dub-projects library + permanent action log
# --------------------------------------------------------------------------

@app.get("/projects")
def list_projects() -> list[dict]:
    """The library: every dub project regardless of state (draft / published /
    published with pending edits), newest activity first. Summaries only -- the
    big payloads (rows, thumbnail) come from GET /projects/{id}."""
    return [project.summary() for project in db.list_projects()]


@app.get("/projects/lookup")
def lookup_project(url: str, target_language: Optional[str] = None) -> dict:
    """THE entry for a (video, language) -- how a re-entered URL is recognised
    server-side, surviving page reloads. 404 when the video is new."""
    video_id = naming.extract_video_id(url)
    if not video_id:
        raise HTTPException(status_code=422, detail="Couldn't find a video ID in that URL")
    project = db.find_project(video_id, target_language or settings.target_language)
    if project is None:
        raise HTTPException(status_code=404, detail="No project for that video and language")
    return project.summary()


@app.post("/projects", status_code=201)
def upsert_project(payload: ProjectUpsertRequest) -> dict:
    project = db.upsert_project(
        _extract_video_id(payload.url), payload.target_language or settings.target_language
    )
    return project.full()


@app.get("/projects/{project_id}")
def get_project(project_id: str) -> dict:
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project.full()


@app.put("/projects/{project_id}/transcript")
def save_project_transcript(project_id: str, payload: TranscriptUpdateRequest) -> dict:
    """The uniform transcript "Save": edited rows become the entry's working
    set (a draft, or pending edits on a published entry = redub in progress).
    Only the target side is writable; the stored source language always wins."""
    project = db.set_project_transcript(project_id, [row.model_dump() for row in payload.rows])
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    db.record_event("Transcript edits saved", video_title=project.source_title or project.title,
                    project_id=project.id)
    return project.full()


@app.post("/projects/{project_id}/transcript/revert")
def revert_project_transcript(project_id: str) -> dict:
    """"Revert to default": the working rows go back to the pristine
    machine-acquired transcript."""
    project = db.revert_project_transcript(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    db.record_event("Transcript reverted to default",
                    video_title=project.source_title or project.title, project_id=project.id)
    return project.full()


@app.put("/projects/{project_id}/thumbnail")
def save_project_thumbnail(project_id: str, payload: ProjectThumbnailRequest) -> dict:
    """Save an approved thumbnail into the entry -- or, with thumbnail=null,
    revert to default (the pipeline auto-generates one again)."""
    thumbnail = _validated_thumbnail_override(payload.thumbnail)
    project = db.set_project_thumbnail(
        project_id, thumbnail, edit_state=payload.edit_state, as_published=payload.as_published)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    db.record_event(
        "Thumbnail saved" if thumbnail else "Thumbnail reverted to default",
        video_title=project.source_title or project.title, project_id=project.id,
    )
    return project.summary()


@app.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    """Remove a library entry in any state (a perfect-forever transcript, or a
    video gone from the channel), along with its cached audio bed. Published
    videos themselves are never touched -- channel cleanup stays manual."""
    project = db.delete_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.bed_path:
        from pathlib import Path

        Path(project.bed_path).unlink(missing_ok=True)
    db.record_event("Library entry deleted", video_title=project.source_title or project.title,
                    project_id=project.id)
    return {"id": project.id, "deleted": True}


@app.post("/projects/{project_id}/redub", status_code=201)
def redub_project(project_id: str, payload: RedubRequest) -> dict:
    """Redub from the library entry: a fresh upload built from the ORIGINAL
    source video, narrating the entry's current transcript, reusing its voice,
    saved thumbnail and cached music/SFX bed. The entry itself never
    duplicates -- on success its target link moves to the new upload."""
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    rows = project.rows_list()
    overrides = [
        {"start": r["start"], "end": r["end"], "text": r["translated_text"]}
        for r in rows
        if (r.get("translated_text") or "").strip()
    ]
    if not overrides:
        raise HTTPException(status_code=422, detail="This project has no transcript to redub from")
    job = db.create_job(
        naming.watch_url(project.source_video_id), project.target_language, mode="dub",
        transcript_overrides=overrides, thumbnail_override=project.thumbnail,
        privacy=payload.privacy, voice=project.voice, project_id=project.id,
    )
    db.record_event(
        "Redub started", video_title=project.source_title or project.title,
        project_id=project.id, job_id=job.id,
        detail=f"privacy: {payload.privacy}" if payload.privacy else None,
    )
    return job.to_dict()


@app.get("/events")
def get_events(limit: int = 200) -> list[dict]:
    """The permanent, append-only action log: one timestamped line per user
    operation, with the video title when known -- and never any transcript
    content. Publishing stops a video's new lines; it never removes old ones."""
    return db.list_events(limit=limit)


@app.post("/events", status_code=201)
def create_event(payload: EventCreateRequest) -> dict:
    db.record_event(payload.action, video_title=payload.video_title,
                    project_id=payload.project_id, detail=payload.detail)
    return {"recorded": True}


@app.get("/diagnostics/extraction")
def diagnostics_extraction(url: Optional[str] = None) -> dict:
    """Run a full verbose extraction probe NOW and return the diagnostic: cookies
    state, per-client real-format counts, and the complete yt-dlp -v trace. The
    operator's window into exactly why downloads are failing the bot-check.
    Operator-gated by the same Basic Auth as the rest of /dubber/api/."""
    from . import diagnostics

    return diagnostics.report(url)


@app.get("/diagnostics/last")
def diagnostics_last() -> dict:
    """The most recently captured extraction diagnostic (a fresh probe via
    /diagnostics/extraction, or the auto-capture from the last failed job)."""
    from . import diagnostics

    text = diagnostics.last_report()
    if text is None:
        raise HTTPException(status_code=404, detail="No extraction diagnostic captured yet")
    return {"report": text}


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
    db.record_event("Service restarted")
    _schedule_self_exit()
    return {"status": "restarting"}
