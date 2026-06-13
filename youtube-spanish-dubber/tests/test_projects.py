"""Tests for the dub-projects library: one entry per (video, language), the
draft -> published -> published_pending state machine, transcript saves that
preserve the source language, revert-to-default, and the action log."""
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
        tts_voice="es-ES-AlvaroNeural",
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


def test_upsert_is_one_entry_per_video_and_language(fresh_db):
    first = db.upsert_project("dQw4w9WgXcQ", "es", source_title="Hello")
    again = db.upsert_project("dQw4w9WgXcQ", "es")
    other_lang = db.upsert_project("dQw4w9WgXcQ", "fr")
    assert first.id == again.id
    assert again.source_title == "Hello"  # kept from the first call
    assert other_lang.id != first.id
    assert len(db.list_projects()) == 2


def test_new_entry_is_a_draft_with_source_only(fresh_db):
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    data = project.summary()
    assert data["state"] == "draft"
    assert data["source_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert data["target_video_id"] is None
    assert data["target_url"] is None


def test_publish_sets_target_and_state(fresh_db):
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    db.mark_project_published(
        project.id, target_video_id="tgt12345678", title="[ES] Hola (Hello)",
        rows=_rows(), thumbnail=None, voice="es-ES-AlvaroNeural", privacy="unlisted",
    )
    reloaded = db.get_project(project.id)
    assert reloaded.state == "published"
    assert reloaded.target_video_id == "tgt12345678"
    assert reloaded.summary()["target_url"] == "https://www.youtube.com/watch?v=tgt12345678"
    # First publish captures the immutable source rows + the pristine copy.
    assert [r["text"] for r in reloaded.source_rows_list()] == ["Hello", "World"]
    assert reloaded.acquired_rows_list() == _rows()


def test_edits_on_published_entry_mean_redub_in_progress(fresh_db):
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    db.mark_project_published(project.id, "tgt12345678", "t", _rows(), None, None, None)

    edited = _rows()
    edited[0]["translated_text"] = "Hola corregido"
    db.set_project_transcript(project.id, edited)
    assert db.get_project(project.id).state == "published_pending"

    # Manually undoing the edit derives the entry straight back to published.
    db.set_project_transcript(project.id, _rows())
    assert db.get_project(project.id).state == "published"


def test_save_preserves_the_source_language_column(fresh_db):
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    db.mark_project_published(project.id, "tgt12345678", "t", _rows(), None, None, None)

    # The client echoes rows WITHOUT original_text (a redub override shape).
    db.set_project_transcript(project.id, [
        {"start": 0.0, "end": 2.0, "translated_text": "Hola arreglado"},
        {"start": 2.0, "end": 4.0, "translated_text": "Mundo arreglado"},
    ])
    rows = db.get_project(project.id).rows_list()
    assert [r["original_text"] for r in rows] == ["Hello", "World"]
    assert [r["translated_text"] for r in rows] == ["Hola arreglado", "Mundo arreglado"]


def test_revert_to_default_restores_acquired_rows(fresh_db):
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    db.store_acquired_transcript(project.id, _rows())
    edited = _rows()
    edited[0]["translated_text"] = "Hola editado"
    db.set_project_transcript(project.id, edited)
    assert db.get_project(project.id).rows_list()[0]["translated_text"] == "Hola editado"

    db.revert_project_transcript(project.id)
    assert db.get_project(project.id).rows_list() == _rows()


def test_acquired_transcript_never_clobbers_edits(fresh_db):
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    edited = _rows()
    edited[0]["translated_text"] = "Hola editado"
    db.set_project_transcript(project.id, edited)

    db.store_acquired_transcript(project.id, _rows())  # a later preview
    assert db.get_project(project.id).rows_list()[0]["translated_text"] == "Hola editado"
    # ... but it does fill the pristine copy for revert.
    assert db.get_project(project.id).acquired_rows_list() == _rows()


def test_thumbnail_save_and_revert(fresh_db):
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    db.mark_project_published(project.id, "tgt12345678", "t", _rows(), None, None, None)

    db.set_project_thumbnail(project.id, "data:image/jpeg;base64,xyz")
    assert db.get_project(project.id).state == "published_pending"
    assert db.get_project(project.id).summary()["has_thumbnail"] is True

    db.set_project_thumbnail(project.id, None)  # revert to default
    assert db.get_project(project.id).state == "published"
    assert db.get_project(project.id).summary()["has_thumbnail"] is False


def test_redub_publish_moves_target_and_clears_pending(fresh_db):
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    db.mark_project_published(project.id, "tgt00000001", "t", _rows(), None, None, None)
    edited = _rows()
    edited[1]["translated_text"] = "Mundo v2"
    db.set_project_transcript(project.id, edited)
    assert db.get_project(project.id).state == "published_pending"

    db.mark_project_published(project.id, "tgt00000002", "t v2",
                              db.get_project(project.id).rows_list(), None, None, None)
    reloaded = db.get_project(project.id)
    assert reloaded.state == "published"
    assert reloaded.target_video_id == "tgt00000002"  # the entry moved, no duplicate
    assert len(db.list_projects()) == 1


def test_delete_project(fresh_db):
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    deleted = db.delete_project(project.id)
    assert deleted.id == project.id
    assert db.get_project(project.id) is None
    assert db.delete_project("nonexistent") is None


def test_events_are_append_only_and_newest_first(fresh_db):
    db.record_event("Dub started", video_title="Hello")
    db.record_event("Published", video_title="Hello", detail="https://youtu.be/x")
    events = db.list_events()
    assert [e["action"] for e in events] == ["Published", "Dub started"]
    assert all(e["created_at"] for e in events)
    assert events[0]["video_title"] == "Hello"


def test_summary_keeps_big_payloads_out(fresh_db):
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    db.set_project_transcript(project.id, _rows())
    db.set_project_thumbnail(project.id, "data:image/jpeg;base64,xyz")
    summary = db.get_project(project.id).summary()
    assert "rows" not in summary and "thumbnail" not in summary
    assert summary["line_count"] == 2
    full = db.get_project(project.id).full()
    assert len(full["rows"]) == 2 and full["thumbnail"].startswith("data:")


def test_thumbnail_edit_state_round_trips(fresh_db):
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    edit = {
        "original": "data:image/jpeg;base64,SRC",
        "banner_text": "Versión Español",
        "preserve_overlays": True,
        "regions": [
            {"polygon": [[0, 0], [10, 0], [10, 5], [0, 5]], "text": "Always Saved",
             "translation": "Siempre Salvo", "font_family": "serif", "fill_color": "#ff0000"},
        ],
    }
    db.set_project_thumbnail(project.id, "data:image/jpeg;base64,GEN", edit_state=edit)

    full = db.get_project(project.id).full()
    assert full["thumbnail"] == "data:image/jpeg;base64,GEN"
    assert full["thumbnail_edit"]["preserve_overlays"] is True
    assert full["thumbnail_edit"]["regions"][0]["fill_color"] == "#ff0000"
    assert full["thumbnail_edit"]["regions"][0]["translation"] == "Siempre Salvo"


def test_thumbnail_revert_clears_edit_state(fresh_db):
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    db.set_project_thumbnail(project.id, "data:image/jpeg;base64,GEN",
                             edit_state={"regions": [{"translation": "x"}]})
    assert db.get_project(project.id).thumbnail_edit is not None
    db.set_project_thumbnail(project.id, None)  # revert
    reverted = db.get_project(project.id)
    assert reverted.thumbnail is None
    assert reverted.thumbnail_edit is None
    assert reverted.full()["thumbnail_edit"] is None


def test_thumbnail_apply_as_published_stays_published(fresh_db):
    # The re-thumbnail tool pushes a thumbnail to the LIVE video and persists it.
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    db.mark_project_published(project.id, "tgt12345678", "t", _rows(), None, None, None)
    assert db.get_project(project.id).state == "published"

    db.set_project_thumbnail(
        project.id, "data:image/jpeg;base64,LIVE",
        edit_state={"regions": [{"translation": "Hola", "fill_color": "#ff0000"}]},
        as_published=True,
    )
    entry = db.get_project(project.id)
    # Persisted AND still published (not a false 'redub in progress').
    assert entry.thumbnail == "data:image/jpeg;base64,LIVE"
    assert entry.state == "published"
    assert entry.full()["thumbnail_edit"]["regions"][0]["fill_color"] == "#ff0000"


def test_dub_flow_thumbnail_save_flags_pending(fresh_db):
    # A staged (not-yet-published) thumbnail Save still flags pending.
    project = db.upsert_project("dQw4w9WgXcQ", "es")
    db.mark_project_published(project.id, "tgt12345678", "t", _rows(), None, None, None)
    db.set_project_thumbnail(project.id, "data:image/jpeg;base64,STAGED")  # as_published=False
    assert db.get_project(project.id).state == "published_pending"
