"""Tests for the one-shot jobs -> projects migration: redub chains resolve to
their true source, target-only redub transcripts get their source-language
column restored from the ancestor, the log is backfilled, and the migration
never runs twice (deleted entries stay deleted)."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from youtube_dubber import db

SRC = "srcVID00001"   # the original English video
DUB1 = "dubVID00001"  # first published dub
DUB2 = "dubVID00002"  # redub (made FROM dub1 -- the legacy bug)


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    fake = SimpleNamespace(
        db_path=str(tmp_path / "jobs.sqlite3"),
        data_dir=tmp_path,
        target_language="es",
        tts_voice="es-ES-AlvaroNeural",
        ensure_dirs=lambda: None,
    )
    monkeypatch.setattr(db, "settings", fake)
    # init_db() triggers the migration; build the legacy rows first, so create
    # bare tables without migrating by initialising, then clearing the flag.
    db.init_db()
    with db._connect() as conn:
        conn.execute("DELETE FROM meta WHERE key = 'projects_migrated'")
    return fake


def _legacy_dub(url, video_id, rows, title, created_at):
    job = db.create_job(url, "es")
    db.update_job(
        job.id, status="done", title=title,
        youtube_video_id=video_id, youtube_video_url=f"https://youtu.be/{video_id}",
        transcript=json.dumps(rows),
    )
    # update_job always stamps updated_at with "now"; legacy rows need their
    # original timestamps, so write them directly.
    with db._connect() as conn:
        conn.execute("UPDATE jobs SET created_at = ?, updated_at = ? WHERE id = ?",
                     (created_at, created_at, job.id))
    return job


def _bilingual_rows():
    return [
        {"start": 0.0, "end": 2.0, "original_text": "Hello", "translated_text": "Hola"},
        {"start": 2.0, "end": 4.0, "original_text": "World", "translated_text": "Mundo"},
    ]


def _target_only_rows():
    return [
        {"start": 0.0, "end": 2.0, "original_text": None, "translated_text": "Hola v2"},
        {"start": 2.0, "end": 4.0, "original_text": None, "translated_text": "Mundo v2"},
    ]


def test_redub_chain_collapses_into_one_entry(fresh_db):
    _legacy_dub(f"https://www.youtube.com/watch?v={SRC}", DUB1,
                _bilingual_rows(), "[ES] Hola (Hello World)", "2026-01-01T00:00:00+00:00")
    # The legacy redub: source URL points at OUR OWN first dub, transcript is
    # target-only, and the title got double-tagged.
    _legacy_dub(f"https://www.youtube.com/watch?v={DUB1}", DUB2,
                _target_only_rows(), "[ES] [ES] Hola (Hello World)", "2026-02-01T00:00:00+00:00")

    created = db.migrate_legacy_projects()
    assert created == 1

    projects = db.list_projects()
    assert len(projects) == 1
    project = projects[0]
    # Chain resolved: the entry belongs to the TRUE source, not the dub.
    assert project.source_video_id == SRC
    # The entry's target is the NEWEST upload.
    assert project.target_video_id == DUB2
    assert project.state == "published"
    # The redub's target-only rows were repaired from the ancestor.
    rows = project.rows_list()
    assert [r["original_text"] for r in rows] == ["Hello", "World"]
    assert [r["translated_text"] for r in rows] == ["Hola v2", "Mundo v2"]
    # The immutable source-language transcript was captured.
    assert [r["text"] for r in project.source_rows_list()] == ["Hello", "World"]


def test_jobs_get_linked_and_log_backfilled(fresh_db):
    job1 = _legacy_dub(f"https://www.youtube.com/watch?v={SRC}", DUB1,
                       _bilingual_rows(), "[ES] Hola (Hello)", "2026-01-01T00:00:00+00:00")
    db.migrate_legacy_projects()

    project = db.list_projects()[0]
    assert db.get_job(job1.id).project_id == project.id

    events = db.list_events()
    actions = [e["action"] for e in events]
    assert "Dub started" in actions and "Published" in actions
    published = next(e for e in events if e["action"] == "Published")
    assert published["created_at"] == "2026-01-01T00:00:00+00:00"  # original timestamp
    assert published["detail"] == f"https://youtu.be/{DUB1}"


def test_migration_runs_once_so_deletions_stick(fresh_db):
    _legacy_dub(f"https://www.youtube.com/watch?v={SRC}", DUB1,
                _bilingual_rows(), "[ES] Hola (Hello)", "2026-01-01T00:00:00+00:00")
    assert db.migrate_legacy_projects() == 1
    db.delete_project(db.list_projects()[0].id)

    assert db.migrate_legacy_projects() == 0  # guarded by the meta flag
    assert db.list_projects() == []


def test_source_title_recovered_from_legacy_title(fresh_db):
    _legacy_dub(f"https://www.youtube.com/watch?v={SRC}", DUB1,
                _bilingual_rows(), "[ES] Hola Mundo (Hello World)", "2026-01-01T00:00:00+00:00")
    db.migrate_legacy_projects()
    assert db.list_projects()[0].source_title == "Hello World"


def test_failed_only_videos_do_not_become_entries(fresh_db):
    job = db.create_job(f"https://www.youtube.com/watch?v={SRC}", "es")
    db.update_job(job.id, status="failed", error="boom")
    assert db.migrate_legacy_projects() == 0
    assert db.list_projects() == []
