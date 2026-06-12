"""Tests for the worker's library bookkeeping on job completion: a publish
updates THE entry (no duplicates), restores the source-language column on
redub rows, and a finished preview lands as the entry's draft transcript."""
from __future__ import annotations

import json
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
