"""Tiny SQLite-backed job queue.

A real message broker would be overkill for a single-VPS service that
processes one dubbing job at a time. SQLite gives us durability (jobs survive
restarts) and atomic "claim the next pending job" semantics for free.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

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
    error TEXT,
    result TEXT,
    youtube_video_id TEXT,
    youtube_video_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

# Columns added after the initial release. CREATE TABLE IF NOT EXISTS won't
# retrofit them onto an existing database, so add any that are missing.
_MIGRATIONS = (
    "ALTER TABLE jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'dub'",
    "ALTER TABLE jobs ADD COLUMN result TEXT",
)

# Lifecycle: queued -> running -> done
#                            \-> failed
TERMINAL_STATUSES = {"done", "failed"}

# What a job does once claimed: "dub" runs the full pipeline and publishes to
# YouTube; "preview" stops after acquiring/translating the transcript so the
# original-language and Spanish text can be compared without the slow
# synthesis/mux/upload stages.
JOB_MODES = {"dub", "preview"}


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
    error: Optional[str] = None
    result: Optional[str] = None
    youtube_video_id: Optional[str] = None
    youtube_video_url: Optional[str] = None
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Job":
        return cls(**{key: row[key] for key in row.keys()})

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        # `result` is stored as a JSON string; hand callers a real object.
        if data["result"]:
            try:
                data["result"] = json.loads(data["result"])
            except ValueError:
                pass
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
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(jobs)")}
        for migration in _MIGRATIONS:
            column = migration.split("ADD COLUMN ")[1].split()[0]
            if column not in existing:
                conn.execute(migration)


def create_job(source_url: str, target_language: str | None = None, mode: str = "dub") -> Job:
    job = Job(
        id=uuid.uuid4().hex[:12],
        source_url=source_url,
        target_language=target_language or settings.target_language,
        mode=mode,
    )
    with _connect() as conn:
        conn.execute(
            """INSERT INTO jobs
               (id, source_url, target_language, mode, status, stage, progress, error, result,
                youtube_video_id, youtube_video_url, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                job.id, job.source_url, job.target_language, job.mode, job.status, job.stage,
                job.progress, job.error, job.result, job.youtube_video_id, job.youtube_video_url,
                job.created_at, job.updated_at,
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


def update_job(job_id: str, **fields: Any) -> None:
    if not fields:
        return
    fields["updated_at"] = _now()
    columns = ", ".join(f"{key} = ?" for key in fields)
    values = [*fields.values(), job_id]
    with _connect() as conn:
        conn.execute(f"UPDATE jobs SET {columns} WHERE id = ?", values)


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
