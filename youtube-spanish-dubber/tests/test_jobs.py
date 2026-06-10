"""Tests for the job queue's cancel path (db + HTTP API).

Each test gets its own throwaway SQLite database by swapping out the module's
`settings` object, so nothing touches the real data directory.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from youtube_dubber import db


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """Point the db module at an isolated, empty SQLite file."""
    fake = SimpleNamespace(
        db_path=str(tmp_path / "jobs.sqlite3"),
        data_dir=tmp_path,
        target_language="es",
        ensure_dirs=lambda: None,
    )
    monkeypatch.setattr(db, "settings", fake)
    db.init_db()
    return fake


def test_cancel_queued_job_marks_it_cancelled(fresh_db):
    job = db.create_job("https://youtu.be/abc123", "es")
    assert job.status == "queued"

    assert db.cancel_queued_job(job.id) is True

    reloaded = db.get_job(job.id)
    assert reloaded.status == "cancelled"
    assert reloaded.stage == "cancelled"
    assert reloaded.progress == "Cancelled by operator"


def test_cancel_is_a_noop_once_running(fresh_db):
    job = db.create_job("https://youtu.be/abc123", "es")
    db.update_job(job.id, status="running")

    # A running job is mid-pipeline: the conditional update must not fire.
    assert db.cancel_queued_job(job.id) is False
    assert db.get_job(job.id).status == "running"


def test_cancel_unknown_job_returns_false(fresh_db):
    assert db.cancel_queued_job("does-not-exist") is False


def test_claim_skips_a_cancelled_job(fresh_db):
    cancelled = db.create_job("https://youtu.be/first", "es")
    db.cancel_queued_job(cancelled.id)
    live = db.create_job("https://youtu.be/second", "es")

    claimed = db.claim_next_job()
    assert claimed is not None
    assert claimed.id == live.id  # the cancelled one is never picked up


def test_cancelled_is_terminal():
    assert "cancelled" in db.TERMINAL_STATUSES


def test_reset_orphaned_running_jobs(fresh_db):
    # A job left 'running' by a previous crash/restart, plus a healthy queued one.
    orphan = db.create_job("https://youtu.be/orphan", "es")
    db.update_job(orphan.id, status="running", stage="muxing")
    queued = db.create_job("https://youtu.be/queued", "es")

    reset = db.reset_orphaned_running_jobs()
    assert reset == 1

    reloaded = db.get_job(orphan.id)
    assert reloaded.status == "failed"
    assert reloaded.stage == "interrupted"
    assert "Interrupted" in (reloaded.error or "")
    # The queued job is untouched and still claimable.
    assert db.get_job(queued.id).status == "queued"


def test_reset_orphaned_running_jobs_noop_when_none(fresh_db):
    db.create_job("https://youtu.be/queued", "es")
    assert db.reset_orphaned_running_jobs() == 0


# --- HTTP layer ------------------------------------------------------------
def test_delete_endpoint_cancels_then_409s(fresh_db, monkeypatch):
    fastapi_testclient = pytest.importorskip("fastapi.testclient")
    # Importing the app drags in the full pipeline (yt-dlp, whisper, ...). In a
    # lean CI without those, skip -- the cancel logic itself is covered above.
    app_module = pytest.importorskip("youtube_dubber.app")

    # The app imports its own `db` reference; it's the same module object, so
    # the fresh_db monkeypatch already applies. Avoid spawning the worker.
    monkeypatch.setattr(app_module.worker, "start_background", lambda: None)
    client = fastapi_testclient.TestClient(app_module.app)

    created = client.post("/jobs", json={"url": "https://youtu.be/abc123", "target_language": "es"})
    assert created.status_code == 201
    job_id = created.json()["id"]

    # First cancel succeeds.
    ok = client.delete(f"/jobs/{job_id}")
    assert ok.status_code == 200
    assert ok.json()["status"] == "cancelled"

    # Second cancel: it's already cancelled (not queued) -> 409.
    again = client.delete(f"/jobs/{job_id}")
    assert again.status_code == 409

    # Unknown id -> 404.
    missing = client.delete("/jobs/nope")
    assert missing.status_code == 404


def test_admin_restart_endpoint(fresh_db, monkeypatch):
    fastapi_testclient = pytest.importorskip("fastapi.testclient")
    app_module = pytest.importorskip("youtube_dubber.app")

    monkeypatch.setattr(app_module.worker, "start_background", lambda: None)
    # Don't actually tear the test process down -- just record that a restart
    # was scheduled.
    called = {}
    monkeypatch.setattr(app_module, "_schedule_self_exit", lambda *a, **k: called.setdefault("hit", True))
    client = fastapi_testclient.TestClient(app_module.app)

    res = client.post("/admin/restart")
    assert res.status_code == 200
    assert res.json()["status"] == "restarting"
    assert called.get("hit") is True
