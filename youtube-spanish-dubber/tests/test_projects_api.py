"""Tests for the projects/events API endpoints (called directly, like the
thumbnail-apply tests, so no service startup/worker is involved). Skips
cleanly when the heavy app deps aren't installed."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

app = pytest.importorskip("youtube_dubber.app")

from fastapi import HTTPException  # noqa: E402

from youtube_dubber import db  # noqa: E402

SRC_URL = "https://www.youtube.com/watch?v=srcVID00001&list=PLjunk&t=12s"


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


def _rows():
    return [
        app.TranscriptRow(start=0.0, end=2.0, original_text="Hello", translated_text="Hola"),
        app.TranscriptRow(start=2.0, end=4.0, original_text="World", translated_text="Mundo"),
    ]


def test_lookup_404_for_new_video_then_finds_entry(fresh_db):
    with pytest.raises(HTTPException) as exc:
        app.lookup_project(SRC_URL, "es")
    assert exc.value.status_code == 404

    created = app.upsert_project(app.ProjectUpsertRequest(url=SRC_URL, target_language="es"))
    assert created["source_video_id"] == "srcVID00001"  # extraneous URL data dropped

    found = app.lookup_project("https://youtu.be/srcVID00001?si=tracking", "es")
    assert found["id"] == created["id"]
    assert found["state"] == "draft"


def test_job_submission_picks_up_saved_draft_and_logs(fresh_db):
    entry = app.upsert_project(app.ProjectUpsertRequest(url=SRC_URL, target_language="es"))
    app.save_project_transcript(entry["id"], app.TranscriptUpdateRequest(rows=_rows()))

    job = app.create_job(app.JobCreateRequest(url=SRC_URL, target_language="es", privacy="unlisted"))
    assert job["project_id"] == entry["id"]
    assert job["privacy"] == "unlisted"
    # The saved draft rows were carried in as overrides automatically.
    assert [line["text"] for line in job["transcript_overrides"]] == ["Hola", "Mundo"]

    actions = [e["action"] for e in db.list_events()]
    assert actions[0] == "Dub started"
    assert "Transcript edits saved" in actions


def test_redub_endpoint_targets_the_original_source(fresh_db):
    entry = app.upsert_project(app.ProjectUpsertRequest(url=SRC_URL, target_language="es"))
    db.mark_project_published(entry["id"], "dubVID00001", "[ES] Hola (Hello)",
                              [r.model_dump() for r in _rows()], None, "voiceX", "public")

    job = app.redub_project(entry["id"], app.RedubRequest(privacy="unlisted"))
    # The redub dubs the SOURCE video again -- never the published dub.
    assert job["source_url"] == "https://www.youtube.com/watch?v=srcVID00001"
    assert job["voice"] == "voiceX"
    assert job["privacy"] == "unlisted"
    assert [line["text"] for line in job["transcript_overrides"]] == ["Hola", "Mundo"]
    assert db.list_events()[0]["action"] == "Redub started"


def test_redub_without_transcript_is_rejected(fresh_db):
    entry = app.upsert_project(app.ProjectUpsertRequest(url=SRC_URL, target_language="es"))
    with pytest.raises(HTTPException) as exc:
        app.redub_project(entry["id"], app.RedubRequest())
    assert exc.value.status_code == 422


def test_transcript_revert_endpoint(fresh_db):
    entry = app.upsert_project(app.ProjectUpsertRequest(url=SRC_URL, target_language="es"))
    db.store_acquired_transcript(entry["id"], [r.model_dump() for r in _rows()])
    edited = _rows()
    edited[0].translated_text = "Hola editado"
    app.save_project_transcript(entry["id"], app.TranscriptUpdateRequest(rows=edited))

    reverted = app.revert_project_transcript(entry["id"])
    assert reverted["rows"][0]["translated_text"] == "Hola"
    assert db.list_events()[0]["action"] == "Transcript reverted to default"


def test_delete_endpoint_removes_entry_and_bed(fresh_db, tmp_path):
    entry = app.upsert_project(app.ProjectUpsertRequest(url=SRC_URL, target_language="es"))
    bed = tmp_path / "beds" / "x.opus"
    bed.parent.mkdir(exist_ok=True)
    bed.write_bytes(b"fake")
    db.update_project(entry["id"], bed_path=str(bed))

    result = app.delete_project(entry["id"])
    assert result["deleted"] is True
    assert not bed.exists()
    with pytest.raises(HTTPException):
        app.get_project(entry["id"])


def test_client_side_events_endpoint(fresh_db):
    app.create_event(app.EventCreateRequest(action="Thumbnail preview closed", video_title="Hello"))
    events = app.get_events()
    assert events[0]["action"] == "Thumbnail preview closed"
    assert events[0]["video_title"] == "Hello"


def test_privacy_validation(fresh_db):
    with pytest.raises(ValueError):
        app.JobCreateRequest(url=SRC_URL, privacy="secret")
