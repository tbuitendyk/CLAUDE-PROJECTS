"""Tests for the worker's library bookkeeping on job completion: a publish
updates THE entry (no duplicates), restores the source-language column on
redub rows, and a finished preview lands as the entry's draft transcript."""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

worker = pytest.importorskip("youtube_dubber.worker")

from youtube_dubber import db  # noqa: E402


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
    db.init_db()
    return fake


SRC_URL = "https://www.youtube.com/watch?v=srcVID00001"


def _bilingual_rows():
    return [
        {"start": 0.0, "end": 2.0, "original_text": "Hello", "translated_text": "Hola"},
        {"start": 2.0, "end": 4.0, "original_text": "World", "translated_text": "Mundo"},
    ]


def test_finish_dub_publishes_the_entry(fresh_db):
    project = db.upsert_project("srcVID00001", "es")
    job = db.create_job(SRC_URL, "es", project_id=project.id, privacy="unlisted")
    result = {
        "youtube_video_id": "dubVID00001",
        "youtube_video_url": "https://youtu.be/dubVID00001",
        "title": "[ES] Hola (Hello World)",
        "source_title": "Hello World",
        "voice": "es-ES-AlvaroNeural",
        "transcript": _bilingual_rows(),
        "bed_source_path": None,
    }
    worker._finish_dub(job, project, result)

    entry = db.get_project(project.id)
    assert entry.state == "published"
    assert entry.target_video_id == "dubVID00001"
    assert entry.source_title == "Hello World"
    assert entry.privacy == "unlisted"
    assert [r["text"] for r in entry.source_rows_list()] == ["Hello", "World"]
    assert db.get_job(job.id).status == "done"
    assert db.list_events()[0]["action"] == "Published"


def test_finish_dub_restores_source_column_on_redub_rows(fresh_db):
    project = db.upsert_project("srcVID00001", "es")
    db.mark_project_published(project.id, "dubVID00001", "t", _bilingual_rows(), None, None, None)

    # The redub ran from overrides, so its result rows are target-only.
    job = db.create_job(SRC_URL, "es", project_id=project.id)
    result = {
        "youtube_video_id": "dubVID00002",
        "youtube_video_url": "https://youtu.be/dubVID00002",
        "title": "[ES] Hola (Hello World)",
        "source_title": "Hello World",
        "voice": None,
        "transcript": [
            {"start": 0.0, "end": 2.0, "original_text": None, "translated_text": "Hola v2"},
            {"start": 2.0, "end": 4.0, "original_text": None, "translated_text": "Mundo v2"},
        ],
        "bed_source_path": None,
    }
    worker._finish_dub(job, project, result)

    entry = db.get_project(project.id)
    assert entry.target_video_id == "dubVID00002"  # the entry moved; still one entry
    assert len(db.list_projects()) == 1
    rows = entry.rows_list()
    assert [r["original_text"] for r in rows] == ["Hello", "World"]
    assert [r["translated_text"] for r in rows] == ["Hola v2", "Mundo v2"]
    # The stored job transcript is the repaired (bilingual) set too.
    assert json.loads(db.get_job(job.id).transcript)[0]["original_text"] == "Hello"


def test_finish_dub_records_the_dubbed_baseline(fresh_db):
    # A finished dub snapshots the rows it baked into the master, so later edits
    # derive "pending dub" (green) against it -- and that survives a re-open.
    project = db.upsert_project("srcVID00001", "es")
    job = db.create_job(SRC_URL, "es", project_id=project.id)
    result = {
        "youtube_video_id": "dubVID00001",
        "youtube_video_url": "https://youtu.be/dubVID00001",
        "title": "t", "source_title": "Hello World", "voice": None,
        "transcript": _bilingual_rows(), "bed_source_path": None,
    }
    worker._finish_dub(job, project, result)

    entry = db.get_project(project.id)
    assert entry.dubbed_rows_list() == _bilingual_rows()
    assert entry.pending_dub() is False

    edited = _bilingual_rows()
    edited[0]["translated_text"] = "Hola v2"
    db.set_project_transcript(entry.id, edited)
    assert db.get_project(entry.id).pending_dub() is True


def test_finish_remaster_caches_master_without_publishing(fresh_db, tmp_path):
    # "Dub" / "Redub" with no publish: the master + baseline are saved, working
    # rows are seeded, but nothing is uploaded and the entry stays a draft.
    project = db.upsert_project("srcVID00001", "es")
    job = db.create_job(SRC_URL, "es", mode="remaster", project_id=project.id)
    dubbed = tmp_path / "dubbed.mp4"
    dubbed.write_bytes(b"video")
    result = {
        "youtube_video_id": None, "youtube_video_url": None,
        "title": "[ES] Hola (Hello World)", "description": "Hola desc\n\nVídeo original: x",
        "source_title": "Hello World", "voice": "es-ES-AlvaroNeural",
        "transcript": _bilingual_rows(), "dubbed_path": str(dubbed),
        "bed_source_path": None, "thumbnail_path": None,
    }
    worker._finish_remaster(job, project, result)

    entry = db.get_project(project.id)
    assert entry.target_video_id is None and entry.state == "draft"   # not published
    assert Path(entry.master_path).exists()                            # master cached
    assert entry.rows_list() == _bilingual_rows()                      # working rows seeded
    assert entry.dubbed_rows_list() == _bilingual_rows()
    assert entry.pending_dub() is False                                # just dubbed -> in sync
    assert entry.description.startswith("Hola desc")
    assert entry.source_title == "Hello World"
    assert db.get_job(job.id).status == "done"
    assert db.list_events()[0]["action"] == "Dub prepared (not published)"


def test_remaster_redub_clears_green_but_keeps_published_video(fresh_db, tmp_path):
    # A no-publish redub catches the master up to the edits (green clears) without
    # touching the live video -- which then correctly reads "not yet published".
    project = db.upsert_project("srcVID00001", "es")
    db.mark_project_published(project.id, "LIVEvid0001", "t", _bilingual_rows(), None, None, "unlisted")
    db.set_project_dubbed_rows(project.id, _bilingual_rows())
    edited = _bilingual_rows()
    edited[0]["translated_text"] = "Hola v2"
    db.set_project_transcript(project.id, edited)
    assert db.get_project(project.id).pending_dub() is True

    dubbed = tmp_path / "d.mp4"
    dubbed.write_bytes(b"v2")
    job = db.create_job(SRC_URL, "es", mode="remaster", project_id=project.id)
    result = {
        "youtube_video_id": None, "youtube_video_url": None,
        "title": "t", "description": "d", "source_title": "Hello World", "voice": None,
        "transcript": [
            {"start": 0.0, "end": 2.0, "original_text": None, "translated_text": "Hola v2"},
            {"start": 2.0, "end": 4.0, "original_text": None, "translated_text": "Mundo"},
        ],
        "dubbed_path": str(dubbed), "bed_source_path": None, "thumbnail_path": None,
    }
    worker._finish_remaster(job, db.get_project(project.id), result)

    entry = db.get_project(project.id)
    assert entry.target_video_id == "LIVEvid0001"     # published video unchanged
    assert entry.pending_dub() is False               # green cleared (master caught up)
    assert [r["translated_text"] for r in entry.dubbed_rows_list()] == ["Hola v2", "Mundo"]
    assert entry.state == "published_pending"          # ...but still not republished


def test_process_remaster_runs_pipeline_without_uploading(fresh_db, monkeypatch, tmp_path):
    from youtube_dubber.pipeline import runner

    project = db.upsert_project("srcVID00001", "es")
    job = db.create_job(SRC_URL, "es", mode="remaster", project_id=project.id)
    dubbed = tmp_path / "dub.mp4"
    dubbed.write_bytes(b"v")
    captured: dict = {}

    def fake_run(*args, publish=True, **kwargs):
        captured["publish"] = publish
        return {
            "youtube_video_id": None, "youtube_video_url": None,
            "title": "[ES] t", "description": "d", "source_title": "Hello World",
            "voice": "es-ES-AlvaroNeural", "transcript": _bilingual_rows(),
            "dubbed_path": str(dubbed), "bed_source_path": None, "thumbnail_path": None,
        }

    monkeypatch.setattr(runner, "run", fake_run)
    worker._process(job)

    assert captured["publish"] is False               # dispatched as a no-upload run
    entry = db.get_project(project.id)
    assert entry.target_video_id is None
    assert Path(entry.master_path).exists()
    assert entry.dubbed_rows_list() == _bilingual_rows()
    assert db.get_job(job.id).status == "done"


def test_finish_preview_stores_draft_transcript(fresh_db):
    project = db.upsert_project("srcVID00001", "es")
    job = db.create_job(SRC_URL, "es", mode="preview", project_id=project.id)
    result = {
        "title": "Hello World",
        "source_video_id": "srcVID00001",
        "transcript_source": "whisper (en) + translated",
        "original_language": "en",
        "rows": _bilingual_rows(),
    }
    worker._finish_preview(job, project, result)

    entry = db.get_project(project.id)
    assert entry.state == "draft"
    assert entry.source_title == "Hello World"
    assert entry.rows_list() == _bilingual_rows()
    assert entry.acquired_rows_list() == _bilingual_rows()  # the revert target
    assert db.list_events()[0]["action"] == "Transcript preview ready"


# --- One-time published-metadata backfill -----------------------------------

def test_backfill_published_metadata_loads_title_and_thumbnail(fresh_db, monkeypatch):
    project = db.upsert_project("srcVID00001", "es")
    # Published, but the legacy entry has no title and no thumbnail.
    db.mark_project_published(project.id, "dubVID00001", "", _bilingual_rows(), None, None, None)
    assert not db.get_project(project.id).title
    assert not db.get_project(project.id).thumbnail

    monkeypatch.setattr(worker, "_fetch_published_metadata",
                        lambda vid: ("[ES] Hola (Hello World)", "data:image/jpeg;base64,xyz"))

    assert worker.backfill_published_metadata() == 1

    repaired = db.get_project(project.id)
    assert repaired.title == "[ES] Hola (Hello World)"
    assert repaired.thumbnail == "data:image/jpeg;base64,xyz"
    # Loading the live thumbnail is a repair, not an edit -> still published.
    assert repaired.state == "published"
    assert any(e["action"].startswith("Library repaired: loaded published") for e in db.list_events())


def test_backfill_published_metadata_runs_once(fresh_db, monkeypatch):
    project = db.upsert_project("srcVID00001", "es")
    db.mark_project_published(project.id, "dubVID00001", "", _bilingual_rows(), None, None, None)
    monkeypatch.setattr(worker, "_fetch_published_metadata", lambda vid: ("T", "data:x"))
    assert worker.backfill_published_metadata() == 1
    assert db.get_meta(worker._PUBLISHED_METADATA_FLAG)
    assert worker.backfill_published_metadata() == 0  # flag-guarded


def test_backfill_retries_when_fetch_fails(fresh_db, monkeypatch):
    project = db.upsert_project("srcVID00001", "es")
    db.mark_project_published(project.id, "dubVID00001", "", _bilingual_rows(), None, None, None)

    def boom(vid):
        raise RuntimeError("bot check")
    monkeypatch.setattr(worker, "_fetch_published_metadata", boom)

    assert worker.backfill_published_metadata() == 0
    # No flag set -> a later restart retries.
    assert db.get_meta(worker._PUBLISHED_METADATA_FLAG) is None


def test_backfill_skips_entries_that_already_have_both(fresh_db, monkeypatch):
    project = db.upsert_project("srcVID00001", "es")
    db.mark_project_published(project.id, "dubVID00001", "Has title",
                              _bilingual_rows(), "data:image/jpeg;base64,have", None, None)
    called = []
    monkeypatch.setattr(worker, "_fetch_published_metadata",
                        lambda vid: called.append(vid) or ("x", "y"))
    assert worker.backfill_published_metadata() == 0
    assert called == []  # nothing was missing, so YouTube was never hit
    assert db.get_meta(worker._PUBLISHED_METADATA_FLAG)


# --- Friendly error surfacing -----------------------------------------------

def test_friendly_error_maps_bot_check():
    msg = worker._friendly_error(RuntimeError(
        "[youtube] Vp7bRixUFak: Sign in to confirm you're not a bot. Use --cookies"))
    assert "bot-check" in msg.lower()
    assert "redeploy" in msg.lower() or "cookies" in msg.lower()


def test_friendly_error_maps_no_formats():
    msg = worker._friendly_error(RuntimeError("ERROR: Requested format is not available"))
    assert "no downloadable formats" in msg.lower()


def test_friendly_error_passes_through_unknown_first_line():
    msg = worker._friendly_error(RuntimeError("Some other failure\nwith a second line"))
    assert msg == "Some other failure"
