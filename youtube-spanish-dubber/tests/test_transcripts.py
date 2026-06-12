"""Tests for the transcripts-library db helpers (list / get / edit) + the job
summary that keeps the full transcript out of listings."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from youtube_dubber import db


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    fake = SimpleNamespace(
        db_path=str(tmp_path / "jobs.sqlite3"),
        data_dir=tmp_path,
        target_language="es",
        ensure_dirs=lambda: None,
    )
    monkeypatch.setattr(db, "settings", fake)
    db.init_db()
    return fake


def _rows():
    return [
        {"start": 0.0, "end": 2.0, "original_text": "Hello", "translated_text": "Hola"},
        {"start": 2.0, "end": 4.0, "original_text": "World", "translated_text": "Mundo"},
    ]


def _finished_dub_with_transcript(url="https://youtu.be/abc123", title="[ES] Hola (Hello)"):
    job = db.create_job(url, "es")
    db.update_job(
        job.id, status="done", title=title,
        youtube_video_url="https://youtu.be/xyz", transcript=json.dumps(_rows()),
    )
    return job


def test_completed_dub_with_transcript_appears_in_library(fresh_db):
    job = _finished_dub_with_transcript()
    lib = db.list_transcripts()
    assert len(lib) == 1
    entry = lib[0]
    assert entry["id"] == job.id
    assert entry["title"] == "[ES] Hola (Hello)"
    assert entry["line_count"] == 2
    assert entry["youtube_video_url"] == "https://youtu.be/xyz"


def test_job_without_transcript_is_not_listed(fresh_db):
    db.create_job("https://youtu.be/none", "es")  # queued, no transcript
    assert db.list_transcripts() == []


def test_get_transcript_returns_rows_and_metadata(fresh_db):
    job = _finished_dub_with_transcript()
    data = db.get_transcript(job.id)
    assert data["id"] == job.id
    assert data["target_language"] == "es"
    assert [r["translated_text"] for r in data["rows"]] == ["Hola", "Mundo"]


def test_get_transcript_none_when_absent(fresh_db):
    job = db.create_job("https://youtu.be/abc123", "es")
    assert db.get_transcript(job.id) is None
    assert db.get_transcript("nonexistent") is None


def test_set_transcript_replaces_rows(fresh_db):
    job = _finished_dub_with_transcript()
    fixed = [{"start": 0.0, "end": 2.0, "original_text": "Hello", "translated_text": "Hola corregido"}]
    assert db.set_transcript(job.id, fixed) is True
    assert db.get_transcript(job.id)["rows"][0]["translated_text"] == "Hola corregido"
    assert db.set_transcript("nonexistent", fixed) is False


def test_to_dict_summarizes_transcript_not_full_text(fresh_db):
    job = _finished_dub_with_transcript()
    data = db.get_job(job.id).to_dict()
    assert data["has_transcript"] is True
    assert "transcript" not in data
    assert data["title"] == "[ES] Hola (Hello)"
