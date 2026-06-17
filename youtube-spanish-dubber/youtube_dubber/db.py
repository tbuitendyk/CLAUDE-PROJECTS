"""Tiny SQLite-backed job queue.

A real message broker would be overkill for a single-VPS service that
processes one dubbing job at a time. SQLite gives us durability (jobs survive
restarts) and atomic "claim the next pending job" semantics for free.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from . import naming
from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    target_language TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'dub',
    status TEXT NOT NULL,
    stage TEXT,
    progress TEXT,
    progress_pct REAL,
    error TEXT,
    result TEXT,
    transcript_overrides TEXT,
    thumbnail_override TEXT,
    transcript TEXT,
    title TEXT,
    youtube_video_id TEXT,
    youtube_video_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

# The dub-projects library: ONE row per (source video, target language), ever.
# It accumulates everything a project needs to be re-opened or redubbed: the
# clean source/target video IDs, the language + voice used, the immutable
# source-language rows, the current (editable) bilingual rows, the pristine
# acquired rows ("Revert to default"), the saved thumbnail and the cached
# speech-removed music/SFX bed. `state` walks draft -> published ->
# published_pending (a published entry with unapplied edits = redub in
# progress) -> published.
PROJECTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    source_video_id TEXT NOT NULL,
    target_language TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'draft',
    source_title TEXT,
    title TEXT,
    target_video_id TEXT,
    voice TEXT,
    privacy TEXT,
    source_rows TEXT,
    acquired_rows TEXT,
    rows TEXT,
    dubbed_rows TEXT,
    thumbnail TEXT,
    thumbnail_edit TEXT,
    bed_path TEXT,
    master_path TEXT,
    description TEXT,
    intro_id TEXT,
    intro_duration REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_fingerprint TEXT,
    UNIQUE (source_video_id, target_language)
);
"""

# Recorded intro clips: short bumpers the operator uploads (unlisted) to YouTube
# and supplies by link. We fetch the media once (yt-dlp), measure its exact
# duration, and cache it on disk keyed by `id`; a project can then have one
# prepended to its pre-intro master and be republished as a new video. The
# duration is the load-bearing bit: it's stored on the project (intro_duration)
# so removal/replacement never disturbs the transcript's anchored timeline.
INTROS_SCHEMA = """
CREATE TABLE IF NOT EXISTS intros (
    id TEXT PRIMARY KEY,
    name TEXT,
    source_url TEXT NOT NULL,
    youtube_id TEXT,
    file_path TEXT NOT NULL,
    duration REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

# The permanent, append-only action log: one timestamped line per user
# operation (and per pipeline milestone), with the video title when known.
# Never carries transcript content.
EVENTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    action TEXT NOT NULL,
    video_title TEXT,
    project_id TEXT,
    job_id TEXT,
    detail TEXT
);
"""

# One-shot flags (e.g. "the legacy jobs -> projects migration already ran") so
# best-effort backfills don't resurrect rows the operator since deleted.
META_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

# Columns added after the initial release. CREATE TABLE IF NOT EXISTS won't
# retrofit them onto an existing database, so add any that are missing.
_MIGRATIONS = (
    "ALTER TABLE jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'dub'",
    "ALTER TABLE jobs ADD COLUMN result TEXT",
    "ALTER TABLE jobs ADD COLUMN transcript_overrides TEXT",
    "ALTER TABLE jobs ADD COLUMN progress_pct REAL",
    "ALTER TABLE jobs ADD COLUMN thumbnail_override TEXT",
    # The finished dub's timestamped transcript (original + target text) and the
    # generated video title -- retained for the transcripts library + redub.
    "ALTER TABLE jobs ADD COLUMN transcript TEXT",
    "ALTER TABLE jobs ADD COLUMN title TEXT",
    # Per-job upload privacy (public/unlisted), TTS voice, and the library
    # project the job belongs to.
    "ALTER TABLE jobs ADD COLUMN privacy TEXT",
    "ALTER TABLE jobs ADD COLUMN voice TEXT",
    "ALTER TABLE jobs ADD COLUMN project_id TEXT",
)

PROJECT_STATES = {"draft", "published", "published_pending"}
PRIVACY_VALUES = {"public", "unlisted", "private"}

# Lifecycle: queued -> running -> done
#                            \-> failed
#            queued -> cancelled  (operator cancelled it before it was claimed)
TERMINAL_STATUSES = {"done", "failed", "cancelled"}

# What a job does once claimed: "dub" runs the full pipeline and publishes to
# YouTube; "preview" stops after acquiring/translating the transcript so the
# original-language and Spanish text can be compared without the slow
# synthesis/mux/upload stages.
JOB_MODES = {"dub", "preview", "intro"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Job:
    id: str
    source_url: str
    target_language: str
    mode: str = "dub"
    status: str = "queued"
    stage: Optional[str] = None
    progress: Optional[str] = None
    progress_pct: Optional[float] = None
    error: Optional[str] = None
    result: Optional[str] = None
    transcript_overrides: Optional[str] = None
    # An approved/edited final thumbnail image (base64 data-URI) to use verbatim
    # for the upload instead of auto-generating one -- the thumbnail analogue of
    # transcript_overrides. Stored but kept out of API listings (see to_dict).
    thumbnail_override: Optional[str] = None
    # The finished dub's timestamped transcript (JSON: rows of start/end/
    # original_text/translated_text) and the generated video title. Retained on
    # every dub for the transcripts library + redub. Big, so kept out of listings.
    transcript: Optional[str] = None
    title: Optional[str] = None
    # Per-job upload privacy ("public"/"unlisted"; None -> the global setting),
    # TTS voice (None -> the global setting) and the library project this job
    # belongs to.
    privacy: Optional[str] = None
    voice: Optional[str] = None
    project_id: Optional[str] = None
    youtube_video_id: Optional[str] = None
    youtube_video_url: Optional[str] = None
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Job":
        return cls(**{key: row[key] for key in row.keys()})

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        # `result`/`transcript_overrides` are stored as JSON strings; hand
        # callers real objects.
        for key in ("result", "transcript_overrides"):
            if data[key]:
                try:
                    data[key] = json.loads(data[key])
                except ValueError:
                    pass
        # The thumbnail override is a full base64 image -- too big to splash
        # through every job listing. Expose only whether one is set.
        data["has_thumbnail_override"] = bool(data.pop("thumbnail_override", None))
        # The transcript is large (every line); keep it out of job listings and
        # expose only whether one exists. The transcripts API serves it in full.
        data["has_transcript"] = bool(data.pop("transcript", None))
        return data


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(settings.db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    settings.ensure_dirs()
    with _connect() as conn:
        conn.execute(SCHEMA)
        conn.execute(PROJECTS_SCHEMA)
        conn.execute(INTROS_SCHEMA)
        conn.execute(EVENTS_SCHEMA)
        conn.execute(META_SCHEMA)
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(jobs)")}
        for migration in _MIGRATIONS:
            column = migration.split("ADD COLUMN ")[1].split()[0]
            if column not in existing:
                conn.execute(migration)
        _ensure_project_columns(conn)
    migrate_legacy_projects()
    backfill_original_transcripts()


def create_job(
    source_url: str,
    target_language: str | None = None,
    mode: str = "dub",
    transcript_overrides: list[dict] | None = None,
    thumbnail_override: str | None = None,
    privacy: str | None = None,
    voice: str | None = None,
    project_id: str | None = None,
) -> Job:
    job = Job(
        id=uuid.uuid4().hex[:12],
        source_url=source_url,
        target_language=target_language or settings.target_language,
        mode=mode,
        transcript_overrides=json.dumps(transcript_overrides) if transcript_overrides else None,
        thumbnail_override=thumbnail_override,
        privacy=privacy,
        voice=voice,
        project_id=project_id,
    )
    with _connect() as conn:
        conn.execute(
            """INSERT INTO jobs
               (id, source_url, target_language, mode, status, stage, progress, error, result,
                transcript_overrides, thumbnail_override, privacy, voice, project_id,
                youtube_video_id, youtube_video_url, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                job.id, job.source_url, job.target_language, job.mode, job.status, job.stage,
                job.progress, job.error, job.result, job.transcript_overrides, job.thumbnail_override,
                job.privacy, job.voice, job.project_id,
                job.youtube_video_id, job.youtube_video_url, job.created_at, job.updated_at,
            ),
        )
    return job


def get_job(job_id: str) -> Optional[Job]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return Job.from_row(row) if row else None


def list_jobs(limit: int = 50) -> list[Job]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [Job.from_row(row) for row in rows]


def list_transcripts(limit: int = 100) -> list[dict[str, Any]]:
    """Lightweight listing for the transcripts library: jobs that have a stored
    transcript, newest first, with the generated video name + line count (not the
    full transcript text)."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, title, target_language, youtube_video_url, transcript, created_at "
            "FROM jobs WHERE transcript IS NOT NULL ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        try:
            line_count = len(json.loads(row["transcript"]))
        except (ValueError, TypeError):
            line_count = 0
        out.append({
            "id": row["id"],
            "title": row["title"] or row["youtube_video_url"] or row["id"],
            "target_language": row["target_language"],
            "youtube_video_url": row["youtube_video_url"],
            "line_count": line_count,
            "created_at": row["created_at"],
        })
    return out


def get_transcript(job_id: str) -> Optional[dict[str, Any]]:
    """Full transcript (rows + metadata) for one job, or None if it has none."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, title, target_language, youtube_video_url, source_url, transcript "
            "FROM jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
    if not row or not row["transcript"]:
        return None
    try:
        rows = json.loads(row["transcript"])
    except ValueError:
        rows = []
    return {
        "id": row["id"],
        "title": row["title"] or row["id"],
        "target_language": row["target_language"],
        "youtube_video_url": row["youtube_video_url"],
        "source_url": row["source_url"],
        "rows": rows,
    }


def set_transcript(job_id: str, rows: list[dict]) -> bool:
    """Replace a job's stored transcript (the library's edit/fix). Returns False
    if the job doesn't exist."""
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE jobs SET transcript = ?, updated_at = ? WHERE id = ?",
            (json.dumps(rows), _now(), job_id),
        )
        return cur.rowcount > 0


def update_job(job_id: str, **fields: Any) -> None:
    if not fields:
        return
    fields["updated_at"] = _now()
    columns = ", ".join(f"{key} = ?" for key in fields)
    values = [*fields.values(), job_id]
    with _connect() as conn:
        conn.execute(f"UPDATE jobs SET {columns} WHERE id = ?", values)


def cancel_queued_job(job_id: str) -> bool:
    """Atomically cancel a job *iff* it's still queued.

    Returns True if it was cancelled, False if it wasn't in a cancellable
    state (already running, done, failed or already cancelled). The
    `AND status = 'queued'` guard makes this safe against the race where the
    worker claims the job between the caller's status check and this update --
    only one of the two writes can win.
    """
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE jobs SET status = 'cancelled', stage = 'cancelled', "
            "progress = 'Cancelled by operator', updated_at = ? "
            "WHERE id = ? AND status = 'queued'",
            (_now(), job_id),
        )
        return cur.rowcount > 0


def reset_orphaned_running_jobs() -> int:
    """Mark any jobs still flagged `running` as failed/interrupted.

    The worker processes one job at a time, in-process, so on a fresh start
    nothing is actually running -- any surviving `running` row is the residue
    of a job that a restart or crash cut off mid-pipeline. Reconciling them on
    startup keeps the queue honest and stops abandoned jobs from showing as
    perpetually 'running' (the "stuck jobs" seen after a restart). Returns the
    number of rows reset.
    """
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE jobs SET status = 'failed', stage = 'interrupted', "
            "progress = 'Interrupted by a service restart', "
            "error = 'Interrupted by a service restart before it finished.', "
            "updated_at = ? WHERE status = 'running'",
            (_now(),),
        )
        return cur.rowcount


def claim_next_job() -> Optional[Job]:
    """Atomically pick the oldest queued job and mark it running."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
        ).fetchone()
        if not row:
            return None
        job = Job.from_row(row)
        conn.execute(
            "UPDATE jobs SET status = 'running', stage = 'starting', updated_at = ? WHERE id = ?",
            (_now(), job.id),
        )
    job.status = "running"
    job.stage = "starting"
    return job


def job_work_dir(job_id: str) -> Path:
    path = settings.data_dir / "jobs" / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


# --------------------------------------------------------------------------
# Dub-projects library
# --------------------------------------------------------------------------

def _dub_signature(rows: list[dict] | None) -> list[tuple]:
    """The narration-affecting shape of a transcript: each line's timing and the
    text that gets spoken. Two transcripts with the same signature dub
    identically, so this is what "has this been re-dubbed since?" compares (it
    ignores the source-language column, which never changes the narration)."""
    return [
        (round(float(row.get("start", 0.0)), 2),
         round(float(row.get("end", 0.0)), 2),
         str(row.get("translated_text") or "").strip())
        for row in (rows or [])
    ]


def _fingerprint(rows: list[dict] | None, thumbnail: str | None) -> str:
    """A stable digest of an entry's publishable content (transcript + thumbnail).
    The entry's state is derived by comparing this against the fingerprint taken
    at its last publish -- so manually undoing an edit returns a published entry
    to 'published' instead of leaving a stale 'pending edits' flag."""
    import hashlib

    payload = json.dumps({"rows": rows or [], "thumbnail": thumbnail or ""}, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass
class Project:
    """One library entry: a dub project for (source video, target language)."""

    id: str
    source_video_id: str
    target_language: str
    state: str = "draft"
    source_title: Optional[str] = None
    title: Optional[str] = None
    target_video_id: Optional[str] = None
    voice: Optional[str] = None
    privacy: Optional[str] = None
    # JSON columns: `source_rows` is the immutable source-language transcript
    # ([{start, end, text}], write-once); `acquired_rows` is the pristine
    # machine-acquired bilingual set ("Revert to default" restores it);
    # `rows` is the current working bilingual set.
    source_rows: Optional[str] = None
    acquired_rows: Optional[str] = None
    rows: Optional[str] = None
    # The transcript baked into the current master (`master_path`): a snapshot of
    # `rows` taken every time a (re)dub renders the master. Edits move `rows`
    # ahead of this until the next dub, which is exactly the "edited but not yet
    # dubbed" set the UI greens -- persisted here so that colouring survives a
    # close/re-open instead of living only in the browser session.
    dubbed_rows: Optional[str] = None
    thumbnail: Optional[str] = None
    # The thumbnail editor's saved state (JSON): the source image, banner text,
    # the overlay-preserve flag and the per-region edits (translation, font,
    # colour) -- so re-opening restores the exact editable interface, not a fresh
    # auto-conversion. None when no custom thumbnail / a legacy auto one.
    thumbnail_edit: Optional[str] = None
    bed_path: Optional[str] = None
    # The pre-intro master: the finished dub video before any intro is prepended,
    # persisted past the job's work dir so an intro can be attached/removed/swapped
    # later without re-dubbing. `description` is the published description, kept so
    # an intro-republish re-uploads with the same metadata. `intro_id` is the
    # currently-attached intro (-> intros table) or None; `intro_duration` is its
    # exact length in seconds (0 when no intro), so removal/replacement leaves the
    # transcript's anchored timeline -- which is relative to the master -- untouched.
    master_path: Optional[str] = None
    description: Optional[str] = None
    intro_id: Optional[str] = None
    intro_duration: Optional[float] = None
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    # Digest of (rows, thumbnail) as of the last successful publish; `state`
    # derives from comparing it to the current content (see _derive_state).
    published_fingerprint: Optional[str] = None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Project":
        return cls(**{key: row[key] for key in row.keys()})

    def rows_list(self) -> list[dict]:
        try:
            return json.loads(self.rows) if self.rows else []
        except ValueError:
            return []

    def source_rows_list(self) -> list[dict]:
        try:
            return json.loads(self.source_rows) if self.source_rows else []
        except ValueError:
            return []

    def acquired_rows_list(self) -> list[dict]:
        try:
            return json.loads(self.acquired_rows) if self.acquired_rows else []
        except ValueError:
            return []

    def dubbed_rows_list(self) -> list[dict]:
        try:
            return json.loads(self.dubbed_rows) if self.dubbed_rows else []
        except ValueError:
            return []

    def pending_dub(self) -> bool:
        """True when the working transcript holds narration that the current
        master hasn't been dubbed with yet -- i.e. there are edits the UI should
        green. Compared line-by-line against the stored dubbed baseline; when
        that baseline is absent (never dubbed, or a legacy entry from before it
        was recorded) we fall back to the publish state, so an in-sync published
        entry isn't falsely flagged and a draft/pending one still is."""
        rows = self.rows_list()
        if not rows:
            return False
        dubbed = self.dubbed_rows_list()
        if dubbed:
            return _dub_signature(rows) != _dub_signature(dubbed)
        return self.state != "published"

    def summary(self) -> dict[str, Any]:
        """Listing shape: everything but the big payloads (rows, thumbnail)."""
        return {
            "id": self.id,
            "source_video_id": self.source_video_id,
            "source_url": naming.watch_url(self.source_video_id),
            "target_video_id": self.target_video_id,
            "target_url": naming.watch_url(self.target_video_id) if self.target_video_id else None,
            "target_language": self.target_language,
            "state": self.state,
            "source_title": self.source_title,
            "title": self.title,
            "voice": self.voice,
            "privacy": self.privacy,
            "line_count": len(self.rows_list()),
            # Whether the working transcript has edits not yet dubbed into the
            # master -- the list-level "pending dub" (green) flag.
            "pending_dub": self.pending_dub(),
            "has_thumbnail": bool(self.thumbnail),
            "has_bed": bool(self.bed_path),
            "has_master": bool(self.master_path),
            "intro_id": self.intro_id,
            "intro_duration": self.intro_duration or 0.0,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def full(self) -> dict[str, Any]:
        data = self.summary()
        data["rows"] = self.rows_list()
        data["source_rows"] = self.source_rows_list()
        # The transcript the current master was dubbed from: the editor greens
        # each working row whose narration differs from its baseline here.
        data["dubbed_rows"] = self.dubbed_rows_list()
        data["thumbnail"] = self.thumbnail
        try:
            data["thumbnail_edit"] = json.loads(self.thumbnail_edit) if self.thumbnail_edit else None
        except ValueError:
            data["thumbnail_edit"] = None
        return data


_PROJECT_COLUMNS = (
    "id", "source_video_id", "target_language", "state", "source_title", "title",
    "target_video_id", "voice", "privacy", "source_rows", "acquired_rows", "rows",
    "dubbed_rows", "thumbnail", "thumbnail_edit", "bed_path", "master_path", "description",
    "intro_id", "intro_duration", "created_at", "updated_at", "published_fingerprint",
)

# Columns added after the projects table's first release. CREATE TABLE IF NOT
# EXISTS won't retrofit them, so add any missing on startup (same pattern as the
# jobs table). published_fingerprint is repeated harmlessly for old databases.
_PROJECT_MIGRATIONS = (
    "ALTER TABLE projects ADD COLUMN published_fingerprint TEXT",
    "ALTER TABLE projects ADD COLUMN thumbnail_edit TEXT",
    "ALTER TABLE projects ADD COLUMN master_path TEXT",
    "ALTER TABLE projects ADD COLUMN description TEXT",
    "ALTER TABLE projects ADD COLUMN intro_id TEXT",
    "ALTER TABLE projects ADD COLUMN intro_duration REAL",
    # The transcript baked into the current pre-intro master -- the baseline the
    # UI greens edited-but-not-yet-dubbed lines against, persisted so that
    # "pending dub" colouring survives closing and re-opening a project.
    "ALTER TABLE projects ADD COLUMN dubbed_rows TEXT",
)


def _ensure_project_columns(conn: sqlite3.Connection) -> None:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(projects)")}
    for migration in _PROJECT_MIGRATIONS:
        column = migration.split("ADD COLUMN ")[1].split()[0]
        if column not in existing:
            conn.execute(migration)


def _derive_state(project: Project) -> str:
    """draft until first publish; then published vs published_pending by
    comparing the current content fingerprint to the one taken at publish."""
    if not project.target_video_id:
        return "draft"
    current = _fingerprint(project.rows_list(), project.thumbnail)
    return "published" if current == (project.published_fingerprint or "") else "published_pending"


def upsert_project(
    source_video_id: str,
    target_language: str,
    source_title: str | None = None,
    voice: str | None = None,
) -> Project:
    """Get-or-create THE entry for (source video, language). Never duplicates;
    a later call can only fill in a missing source title / voice."""
    with _connect() as conn:
        _ensure_project_columns(conn)
        row = conn.execute(
            "SELECT * FROM projects WHERE source_video_id = ? AND target_language = ?",
            (source_video_id, target_language),
        ).fetchone()
        if row:
            project = Project.from_row(row)
            updates: dict[str, Any] = {}
            if source_title and not project.source_title:
                updates["source_title"] = source_title
            if voice and not project.voice:
                updates["voice"] = voice
            if updates:
                updates["updated_at"] = _now()
                columns = ", ".join(f"{key} = ?" for key in updates)
                conn.execute(f"UPDATE projects SET {columns} WHERE id = ?", [*updates.values(), project.id])
                for key, value in updates.items():
                    setattr(project, key, value)
            return project
        project = Project(
            id=uuid.uuid4().hex[:12],
            source_video_id=source_video_id,
            target_language=target_language,
            source_title=source_title,
            voice=voice,
        )
        conn.execute(
            f"INSERT INTO projects ({', '.join(_PROJECT_COLUMNS)}) "
            f"VALUES ({', '.join('?' for _ in _PROJECT_COLUMNS)})",
            tuple(getattr(project, column) for column in _PROJECT_COLUMNS),
        )
    return project


def get_project(project_id: str) -> Optional[Project]:
    with _connect() as conn:
        _ensure_project_columns(conn)
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    return Project.from_row(row) if row else None


def find_project(source_video_id: str, target_language: str) -> Optional[Project]:
    with _connect() as conn:
        _ensure_project_columns(conn)
        row = conn.execute(
            "SELECT * FROM projects WHERE source_video_id = ? AND target_language = ?",
            (source_video_id, target_language),
        ).fetchone()
    return Project.from_row(row) if row else None


def list_projects() -> list[Project]:
    with _connect() as conn:
        _ensure_project_columns(conn)
        rows = conn.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
    return [Project.from_row(row) for row in rows]


def update_project(project_id: str, **fields: Any) -> Optional[Project]:
    """Set columns, then re-derive `state` from content vs the published
    fingerprint (callers never write `state` directly)."""
    project = get_project(project_id)
    if project is None:
        return None
    for key, value in fields.items():
        setattr(project, key, value)
    project.state = _derive_state(project)
    project.updated_at = _now()
    fields = dict(fields, state=project.state, updated_at=project.updated_at)
    columns = ", ".join(f"{key} = ?" for key in fields)
    with _connect() as conn:
        conn.execute(f"UPDATE projects SET {columns} WHERE id = ?", [*fields.values(), project_id])
    return project


def fill_original_texts(rows: list[dict], donor_rows: list[dict]) -> list[dict]:
    """Restore the source-language column on rows that lost it (a redub override
    carries only the narrated text). Donor rows are matched by start time --
    redub overrides inherit their times from the library rows, so this is exact
    in practice. When the sets are the same length, rows still missing after
    time-matching fall back to position (the timings may have been nudged in an
    edit); odd-sized leftovers just stay target-only."""
    by_start: dict[float, str] = {}

    def donor_text(donor: dict) -> str | None:
        return donor.get("original_text") if "original_text" in donor else donor.get("text")

    for donor in donor_rows:
        text = donor_text(donor)
        if text:
            by_start[round(float(donor.get("start", 0.0)), 2)] = text
    out = []
    for index, row in enumerate(rows):
        row = dict(row)
        if not row.get("original_text"):
            match = by_start.get(round(float(row.get("start", 0.0)), 2))
            if match is None and len(rows) == len(donor_rows):
                match = donor_text(donor_rows[index])
            if match:
                row["original_text"] = match
        out.append(row)
    return out


def set_project_transcript(project_id: str, rows: list[dict]) -> Optional[Project]:
    """Save edited rows into the entry (the uniform "Save"). Edits only ever
    touch the target side: the stored rows' original_text always wins over
    whatever the client echoed back, so the source language is preserved no
    matter what. A published entry with changed content derives to
    published_pending (= redub in progress)."""
    project = get_project(project_id)
    if project is None:
        return None
    merged = fill_original_texts(
        [
            {
                "start": float(row.get("start", 0.0)),
                "end": float(row.get("end", 0.0)),
                "original_text": None,  # repopulated from the stored rows below
                "translated_text": str(row.get("translated_text") or ""),
            }
            for row in rows
        ],
        project.rows_list() or project.source_rows_list(),
    )
    return update_project(project_id, rows=json.dumps(merged))


def revert_project_transcript(project_id: str) -> Optional[Project]:
    """"Revert to default": the working rows go back to the pristine
    machine-acquired set."""
    project = get_project(project_id)
    if project is None or not project.acquired_rows:
        return project
    return update_project(project_id, rows=project.acquired_rows)


def set_project_thumbnail(
    project_id: str, thumbnail: str | None, edit_state: dict | None = None,
    as_published: bool = False,
) -> Optional[Project]:
    """Save (or, with None, revert-to-default) the entry's thumbnail. `edit_state`
    is the editor's saved state (source image, banner, overlay flag, per-region
    translation/font/colour) so re-opening restores the exact editable interface;
    it's cleared along with the thumbnail on a revert.

    `as_published`: the thumbnail was just pushed onto the LIVE video (the
    re-thumbnail tool), so it IS the published thumbnail -- move the publish
    fingerprint with it so the entry stays 'published' rather than deriving to a
    false 'redub in progress'. (A staged dub-flow Save leaves this False, which
    correctly flags pending until the next dub.)"""
    project = get_project(project_id)
    if project is None:
        return None
    fields: dict[str, Any] = {
        "thumbnail": thumbnail,
        "thumbnail_edit": json.dumps(edit_state) if (thumbnail and edit_state) else None,
    }
    if as_published and project.target_video_id:
        fields["published_fingerprint"] = _fingerprint(project.rows_list(), thumbnail)
    return update_project(project_id, **fields)


def mark_project_published(
    project_id: str,
    target_video_id: str,
    title: str,
    rows: list[dict],
    thumbnail: str | None,
    voice: str | None,
    privacy: str | None,
) -> Optional[Project]:
    """Record a successful publish: the entry now points at the new upload, the
    published content is fingerprinted (so state derives back to 'published'),
    and the immutable source-language rows are captured on first publish."""
    project = get_project(project_id)
    if project is None:
        return None
    fields: dict[str, Any] = {
        "target_video_id": target_video_id,
        "title": title,
        "rows": json.dumps(rows),
        "thumbnail": thumbnail,
        "published_fingerprint": _fingerprint(rows, thumbnail),
    }
    if voice:
        fields["voice"] = voice
    if privacy:
        fields["privacy"] = privacy
    if not project.acquired_rows:
        fields["acquired_rows"] = json.dumps(rows)
    if not project.source_rows:
        source_rows = [
            {"start": r.get("start"), "end": r.get("end"), "text": r["original_text"]}
            for r in rows
            if r.get("original_text")
        ]
        if source_rows:
            fields["source_rows"] = json.dumps(source_rows)
    return update_project(project_id, **fields)


def store_acquired_transcript(project_id: str, rows: list[dict]) -> Optional[Project]:
    """Keep a freshly machine-acquired bilingual transcript (a finished preview):
    it becomes the working rows -- and the write-once pristine/source copies --
    only where the entry doesn't already have them, so it never clobbers edits."""
    project = get_project(project_id)
    if project is None:
        return None
    fields: dict[str, Any] = {}
    if not project.acquired_rows:
        fields["acquired_rows"] = json.dumps(rows)
    if not project.rows:
        fields["rows"] = json.dumps(rows)
    if not project.source_rows:
        source_rows = [
            {"start": r.get("start"), "end": r.get("end"), "text": r["original_text"]}
            for r in rows
            if r.get("original_text")
        ]
        if source_rows:
            fields["source_rows"] = json.dumps(source_rows)
    if not fields:
        return project
    return update_project(project_id, **fields)


def set_published_metadata(project_id: str, title: str | None = None, thumbnail: str | None = None) -> Optional[Project]:
    """One-time repair: load a published video's real title and/or thumbnail onto
    its library entry, filling only what's missing. Loading the actual published
    thumbnail is a data repair, not a user edit, so a published entry stays
    published -- its publish fingerprint moves with the thumbnail rather than
    flagging a phantom redub-in-progress."""
    project = get_project(project_id)
    if project is None:
        return None
    fields: dict[str, Any] = {}
    if title and not project.title:
        fields["title"] = title
    if thumbnail and not project.thumbnail:
        fields["thumbnail"] = thumbnail
        if project.state == "published":
            fields["published_fingerprint"] = _fingerprint(project.rows_list(), thumbnail)
    if not fields:
        return project
    return update_project(project_id, **fields)


def delete_project(project_id: str) -> Optional[Project]:
    """Remove an entry (any state). Returns the deleted row so the caller can
    clean up its cached bed file."""
    project = get_project(project_id)
    if project is None:
        return None
    with _connect() as conn:
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    return project


# --------------------------------------------------------------------------
# Action log (permanent, append-only)
# --------------------------------------------------------------------------

def get_meta(key: str) -> Optional[str]:
    with _connect() as conn:
        row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(key: str, value: str | None = None) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, value or _now())
        )


def record_event(
    action: str,
    video_title: str | None = None,
    project_id: str | None = None,
    job_id: str | None = None,
    detail: str | None = None,
    created_at: str | None = None,
) -> None:
    """Append one line to the permanent action log. Best-effort by design: a
    log line must never break the user action it describes."""
    try:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO events (created_at, action, video_title, project_id, job_id, detail) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (created_at or _now(), action, video_title, project_id, job_id, detail),
            )
    except sqlite3.Error:
        logging.getLogger(__name__).warning("Couldn't record log event %r", action)


def list_events(limit: int = 200) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(row) for row in rows]


# --------------------------------------------------------------------------
# One-shot legacy migration: jobs -> projects (+ log backfill)
# --------------------------------------------------------------------------

def _legacy_source_title(title: str | None) -> str | None:
    """Best effort: the historical title format is "<tag> <translated> (<original>)",
    so the trailing parenthetical is the source title."""
    import re

    if not title:
        return None
    match = re.search(r"\(([^()]+)\)\s*$", title)
    return match.group(1).strip() if match else None


def _root_source_id(job: "Job", published_by_vid: dict[str, "Job"]) -> str | None:
    """Walk a redub-of-our-own-dub chain back to the TRUE source video: a job
    whose source URL points at another job's published video was a redub of
    that dub, so it belongs to the original's entry."""
    seen: set[str] = set()
    current = job
    while True:
        source_id = naming.extract_video_id(current.source_url)
        if source_id is None or source_id not in published_by_vid or source_id in seen:
            return source_id
        seen.add(source_id)
        current = published_by_vid[source_id]


def migrate_legacy_projects() -> int:
    """Build the projects library + action log from the pre-library `jobs` rows.

    Runs once (a meta flag guards re-runs so deleted entries stay deleted).
    Redub chains are resolved to their true origin: a job whose source URL
    points at another job's *published* video was a redub of our own dub, so it
    belongs to the original source's entry -- that also lets us repair its
    target-only transcript by pulling the source-language column from its
    ancestor. Returns the number of entries created."""
    with _connect() as conn:
        if conn.execute("SELECT 1 FROM meta WHERE key = 'projects_migrated'").fetchone():
            return 0
        job_rows = conn.execute(
            "SELECT * FROM jobs WHERE mode = 'dub' ORDER BY created_at ASC"
        ).fetchall()
    jobs = [Job.from_row(row) for row in job_rows]
    published_by_vid = {j.youtube_video_id: j for j in jobs if j.youtube_video_id}

    groups: dict[tuple[str, str], list[Job]] = {}
    for job in jobs:
        source_id = _root_source_id(job, published_by_vid)
        if source_id:
            groups.setdefault((source_id, job.target_language), []).append(job)

    created = 0
    for (source_id, language), group in groups.items():
        done_jobs = [j for j in group if j.status == "done" and j.youtube_video_id]
        transcript_jobs = [j for j in group if j.transcript]
        if not done_jobs and not transcript_jobs:
            continue

        def rows_of(job: Job) -> list[dict]:
            try:
                return json.loads(job.transcript) if job.transcript else []
            except ValueError:
                return []

        newest_rows: list[dict] = rows_of(transcript_jobs[-1]) if transcript_jobs else []
        # The oldest transcript carrying the source-language column is the donor
        # for entries whose newest (redub) transcript is target-only.
        donor_rows: list[dict] = []
        for job in transcript_jobs:
            rows = rows_of(job)
            if any(r.get("original_text") for r in rows):
                donor_rows = rows
                break
        if newest_rows and donor_rows and not any(r.get("original_text") for r in newest_rows):
            newest_rows = fill_original_texts(newest_rows, donor_rows)

        newest_done = done_jobs[-1] if done_jobs else None
        title = (newest_done.title if newest_done else None) or (
            transcript_jobs[-1].title if transcript_jobs else None
        )
        project = upsert_project(
            source_id, language,
            source_title=_legacy_source_title(title),
            voice=getattr(settings, "tts_voice", None),
        )
        source_rows = [
            {"start": r.get("start"), "end": r.get("end"), "text": r["original_text"]}
            for r in (donor_rows or newest_rows)
            if r.get("original_text")
        ]
        update_project(
            project.id,
            title=title,
            target_video_id=newest_done.youtube_video_id if newest_done else None,
            rows=json.dumps(newest_rows) if newest_rows else None,
            acquired_rows=json.dumps(donor_rows or newest_rows) if (donor_rows or newest_rows) else None,
            source_rows=json.dumps(source_rows) if source_rows else None,
            privacy=newest_done.privacy if newest_done else None,
            # The migrated content IS the published content -- fingerprint it so
            # the entry derives to 'published', not a phantom 'pending edits'.
            published_fingerprint=_fingerprint(newest_rows, None) if newest_done else None,
        )
        created += 1
        # Tie the legacy jobs to their entry + backfill the action log with the
        # lifecycle we can still reconstruct, at the original timestamps.
        for job in group:
            update_job(job.id, project_id=project.id)
            label = title or job.title or job.source_url
            record_event("Dub started", video_title=label, project_id=project.id,
                         job_id=job.id, created_at=job.created_at)
            if job.status == "done" and job.youtube_video_url:
                record_event("Published", video_title=label, project_id=project.id, job_id=job.id,
                             detail=job.youtube_video_url, created_at=job.updated_at)
            elif job.status == "failed":
                record_event("Dub failed", video_title=label, project_id=project.id,
                             job_id=job.id, created_at=job.updated_at)
            elif job.status == "cancelled":
                record_event("Dub cancelled", video_title=label, project_id=project.id,
                             job_id=job.id, created_at=job.updated_at)

    with _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('projects_migrated', ?)", (_now(),)
        )
    return created


def backfill_original_transcripts() -> int:
    """Second one-shot repair: restore the source-language column on library
    entries that came out of the legacy migration target-only.

    The first migration only mined *dub* jobs' stored transcripts for the
    original text -- but for a "preview first, edit, then dub" project the
    bilingual rows live in the PREVIEW job's result (the dub itself ran from
    Spanish-only overrides, and early dubs predate transcript retention). This
    pass mines those preview results (and any bilingual dub transcripts) as
    donors, fills `original_text` + the immutable `source_rows` (and the
    pristine `acquired_rows`, so Revert can't drop the English again), and
    recovers missing source titles. Published entries keep their state: a data
    repair is not a user edit, so the publish fingerprint is moved with the
    rows rather than flagging a phantom redub-in-progress. Returns the number
    of entries repaired."""
    with _connect() as conn:
        if conn.execute("SELECT 1 FROM meta WHERE key = 'originals_backfilled'").fetchone():
            return 0
        job_rows = conn.execute("SELECT * FROM jobs ORDER BY created_at ASC").fetchall()
    jobs = [Job.from_row(row) for row in job_rows]
    published_by_vid = {j.youtube_video_id: j for j in jobs if j.youtube_video_id}

    # donors[(source video, language)] -> oldest bilingual row set we can find;
    # titles[...] -> a source title recovered from a preview result.
    donors: dict[tuple[str, str], list[dict]] = {}
    titles: dict[tuple[str, str], str] = {}
    for job in jobs:
        rows: list[dict] = []
        title: str | None = None
        if job.transcript:
            try:
                rows = json.loads(job.transcript)
            except ValueError:
                rows = []
        elif job.mode == "preview" and job.result:
            try:
                result = json.loads(job.result)
                rows = result.get("rows") or []
                title = result.get("title")
            except ValueError:
                rows = []
        if not rows or not any(r.get("original_text") for r in rows):
            continue
        source_id = _root_source_id(job, published_by_vid)
        if not source_id:
            continue
        key = (source_id, job.target_language)
        donors.setdefault(key, rows)
        if title:
            titles.setdefault(key, title)

    repaired = 0
    for project in list_projects():
        key = (project.source_video_id, project.target_language)
        donor = donors.get(key)
        fields: dict[str, Any] = {}

        rows = project.rows_list()
        if donor and rows and not all(r.get("original_text") for r in rows):
            filled = fill_original_texts(rows, donor)
            if any(r.get("original_text") for r in filled):
                fields["rows"] = json.dumps(filled)
                rows = filled

        acquired = project.acquired_rows_list()
        if donor and acquired and not all(r.get("original_text") for r in acquired):
            filled = fill_original_texts(acquired, donor)
            if any(r.get("original_text") for r in filled):
                fields["acquired_rows"] = json.dumps(filled)

        if donor and not project.source_rows:
            source_rows = [
                {"start": r.get("start"), "end": r.get("end"), "text": r["original_text"]}
                for r in donor
                if r.get("original_text")
            ]
            if source_rows:
                fields["source_rows"] = json.dumps(source_rows)

        if not project.source_title and titles.get(key):
            fields["source_title"] = titles[key]

        if not fields:
            continue
        # Repairing data isn't a user edit: keep a published entry published by
        # moving its publish fingerprint along with the repaired rows.
        if "rows" in fields and project.state == "published":
            fields["published_fingerprint"] = _fingerprint(rows, project.thumbnail)
        update_project(project.id, **fields)
        repaired += 1
        record_event(
            "Library repaired: original-language transcript restored"
            if "rows" in fields or "source_rows" in fields
            else "Library repaired: source title restored",
            video_title=fields.get("source_title") or project.source_title or project.title,
            project_id=project.id,
        )

    with _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('originals_backfilled', ?)", (_now(),)
        )
    return repaired


def confirm_published_state(project_id: str) -> Optional[Project]:
    """Maintenance helper: accept the entry's CURRENT content as its published
    content -- the publish fingerprint is re-taken from the rows + thumbnail as
    they stand, so the entry derives back to 'published' (no pending-edits
    flag). Draft entries (no published dub) are left untouched."""
    project = get_project(project_id)
    if project is None or not project.target_video_id:
        return project
    return update_project(
        project_id,
        published_fingerprint=_fingerprint(project.rows_list(), project.thumbnail),
    )


def project_bed_path(project_id: str) -> Path:
    """Where a project's cached speech-removed bed lives (encoded once, reused
    by every redub)."""
    beds = settings.data_dir / "beds"
    beds.mkdir(parents=True, exist_ok=True)
    return beds / f"{project_id}.opus"


def project_master_path(project_id: str) -> Path:
    """Where a project's pre-intro master video lives (the finished dub before any
    intro), kept so an intro can be attached/removed/swapped without re-dubbing."""
    masters = settings.data_dir / "masters"
    masters.mkdir(parents=True, exist_ok=True)
    return masters / f"{project_id}.mp4"


def intro_file_path(intro_id: str) -> Path:
    """Where a recorded intro clip's cached media lives (fetched once from its
    unlisted YouTube link)."""
    intros = settings.data_dir / "intros"
    intros.mkdir(parents=True, exist_ok=True)
    return intros / f"{intro_id}.mp4"


def set_project_master(project_id: str, path: str | Path) -> Optional[Project]:
    return update_project(project_id, master_path=str(path))


def set_project_dubbed_rows(project_id: str, rows: list[dict]) -> Optional[Project]:
    """Record the transcript a freshly rendered master was dubbed from, so later
    edits derive "pending dub" against it (and the UI can green just the changed
    lines). Called on every (re)dub that rebuilds the master."""
    return update_project(project_id, dubbed_rows=json.dumps(rows or []))


def set_project_intro(project_id: str, intro_id: str, duration: float) -> Optional[Project]:
    """Attach an intro to a project (its exact length is stored so removal /
    replacement never disturbs the master-relative transcript timeline)."""
    return update_project(project_id, intro_id=intro_id, intro_duration=float(duration or 0.0))


def clear_project_intro(project_id: str) -> Optional[Project]:
    return update_project(project_id, intro_id=None, intro_duration=0.0)


# --------------------------------------------------------------------------
# Recorded intro clips
# --------------------------------------------------------------------------

@dataclass
class Intro:
    id: str
    source_url: str
    file_path: str
    name: Optional[str] = None
    youtube_id: Optional[str] = None
    duration: float = 0.0
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Intro":
        return cls(**{key: row[key] for key in row.keys()})

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name or self.youtube_id or self.id,
            "source_url": self.source_url,
            "youtube_id": self.youtube_id,
            "duration": self.duration,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


_INTRO_COLUMNS = (
    "id", "name", "source_url", "youtube_id", "file_path", "duration", "created_at", "updated_at",
)


def create_intro(
    source_url: str, file_path: str | Path, duration: float,
    name: str | None = None, youtube_id: str | None = None, intro_id: str | None = None,
) -> Intro:
    intro = Intro(
        id=intro_id or uuid.uuid4().hex[:12],
        source_url=source_url,
        file_path=str(file_path),
        name=name,
        youtube_id=youtube_id,
        duration=float(duration or 0.0),
    )
    with _connect() as conn:
        conn.execute(INTROS_SCHEMA)
        conn.execute(
            f"INSERT INTO intros ({', '.join(_INTRO_COLUMNS)}) "
            f"VALUES ({', '.join('?' for _ in _INTRO_COLUMNS)})",
            tuple(getattr(intro, column) for column in _INTRO_COLUMNS),
        )
    return intro


def get_intro(intro_id: str) -> Optional[Intro]:
    with _connect() as conn:
        conn.execute(INTROS_SCHEMA)
        row = conn.execute("SELECT * FROM intros WHERE id = ?", (intro_id,)).fetchone()
    return Intro.from_row(row) if row else None


def list_intros() -> list[Intro]:
    with _connect() as conn:
        conn.execute(INTROS_SCHEMA)
        rows = conn.execute("SELECT * FROM intros ORDER BY created_at DESC").fetchall()
    return [Intro.from_row(row) for row in rows]


def delete_intro(intro_id: str) -> Optional[Intro]:
    """Remove an intro and detach it from any project currently using it. Returns
    the deleted row so the caller can unlink its cached media file."""
    intro = get_intro(intro_id)
    if intro is None:
        return None
    with _connect() as conn:
        conn.execute("DELETE FROM intros WHERE id = ?", (intro_id,))
        conn.execute(
            "UPDATE projects SET intro_id = NULL, intro_duration = 0, updated_at = ? "
            "WHERE intro_id = ?",
            (_now(), intro_id),
        )
    return intro


def _human_bytes(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{int(size)} B" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def library_usage() -> dict[str, Any]:
    """Disk used by the artefacts the library keeps forever -- pre-intro masters,
    cached music/SFX beds and intro clips -- for the 'space used' status line.
    Reclaimed by deleting projects/intros we'll never reuse."""
    def dir_usage(path: Path) -> tuple[int, int]:
        if not path.exists():
            return 0, 0
        total = count = 0
        for entry in path.glob("*"):
            if entry.is_file():
                total += entry.stat().st_size
                count += 1
        return total, count

    masters_bytes, masters_count = dir_usage(settings.data_dir / "masters")
    beds_bytes, beds_count = dir_usage(settings.data_dir / "beds")
    intros_bytes, intros_count = dir_usage(settings.data_dir / "intros")
    total = masters_bytes + beds_bytes + intros_bytes
    return {
        "total_bytes": total,
        "total_human": _human_bytes(total),
        "masters": {"bytes": masters_bytes, "count": masters_count},
        "beds": {"bytes": beds_bytes, "count": beds_count},
        "intros": {"bytes": intros_bytes, "count": intros_count},
    }
