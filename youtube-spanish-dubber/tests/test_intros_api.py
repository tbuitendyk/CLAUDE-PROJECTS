"""Tests for the intro-clips API endpoints (called directly, like the other
endpoint tests, so no service startup/worker is involved). Skips cleanly when
the heavy app deps aren't installed."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

app = pytest.importorskip("youtube_dubber.app")

from fastapi import HTTPException  # noqa: E402

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


def test_attach_intro_requires_a_saved_master(fresh_db):
    project = db.upsert_project("vidAAAAAAAA1", "es")
    intro = db.create_intro("https://youtu.be/x", "/x.mp4", 5.0)
    with pytest.raises(HTTPException) as exc:
        app.attach_project_intro(project.id, app.ProjectIntroRequest(intro_id=intro.id))
    assert exc.value.status_code == 409 and "master" in exc.value.detail


def test_attach_intro_sets_state_and_enqueues(fresh_db):
    project = db.upsert_project("vidAAAAAAAA2", "es")
    db.set_project_master(project.id, "/m.mp4")
    intro = db.create_intro("https://youtu.be/x", "/x.mp4", 5.0, name="Bumper")

    job = app.attach_project_intro(project.id, app.ProjectIntroRequest(intro_id=intro.id, privacy="public"))
    assert job["mode"] == "intro" and job["project_id"] == project.id and job["privacy"] == "public"

    refreshed = db.get_project(project.id)
    assert refreshed.intro_id == intro.id and refreshed.intro_duration == 5.0


def test_attach_unknown_intro_404(fresh_db):
    project = db.upsert_project("vidAAAAAAAA3", "es")
    db.set_project_master(project.id, "/m.mp4")
    with pytest.raises(HTTPException) as exc:
        app.attach_project_intro(project.id, app.ProjectIntroRequest(intro_id="missing"))
    assert exc.value.status_code == 404


def test_detach_intro_clears_and_enqueues(fresh_db):
    project = db.upsert_project("vidAAAAAAAA4", "es")
    db.set_project_master(project.id, "/m.mp4")
    intro = db.create_intro("https://youtu.be/x", "/x.mp4", 5.0)
    db.set_project_intro(project.id, intro.id, intro.duration)

    job = app.detach_project_intro(project.id)
    assert job["mode"] == "intro" and job["project_id"] == project.id

    refreshed = db.get_project(project.id)
    assert refreshed.intro_id is None and (refreshed.intro_duration or 0) == 0


def test_library_usage_endpoint(fresh_db, tmp_path):
    (tmp_path / "masters").mkdir()
    (tmp_path / "masters" / "a.mp4").write_bytes(b"x" * 10)
    usage = app.library_usage()
    assert usage["total_bytes"] == 10 and usage["masters"]["count"] == 1


def test_add_intro_endpoint_uses_the_service(fresh_db, monkeypatch):
    import youtube_dubber.intros as intros_service

    fake = db.Intro(id="iii", source_url="https://youtu.be/x", file_path="/x.mp4", name="N", duration=3.0)
    monkeypatch.setattr(intros_service, "ingest_intro", lambda url, name=None: fake)

    out = app.add_intro(app.IntroCreateRequest(url="https://youtu.be/abc12345678", name="N"))
    assert out["id"] == "iii" and out["duration"] == 3.0


def test_add_intro_maps_download_failure_to_502(fresh_db, monkeypatch):
    import youtube_dubber.intros as intros_service
    from youtube_dubber.pipeline import downloader

    def boom(url, name=None):
        raise downloader.DownloadError("video unavailable")

    monkeypatch.setattr(intros_service, "ingest_intro", boom)
    with pytest.raises(HTTPException) as exc:
        app.add_intro(app.IntroCreateRequest(url="https://youtu.be/abc12345678"))
    assert exc.value.status_code == 502 and "unavailable" in exc.value.detail


def test_list_and_delete_intro_endpoints(fresh_db):
    intro = db.create_intro("https://youtu.be/x", "/x.mp4", 2.0, name="A")
    assert any(i["id"] == intro.id for i in app.list_intros())

    out = app.remove_intro(intro.id)
    assert out == {"id": intro.id, "deleted": True}
    assert db.get_intro(intro.id) is None
