"""Tests for the intro-clips backend: the intro library (db CRUD), ingestion
from an unlisted link, per-project master/intro persistence, and the library
disk-usage stat. These touch only db + the (lazily-importing) intros service,
so no heavy pipeline deps are needed."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from youtube_dubber import db, intros


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


def test_intro_crud_roundtrip(fresh_db):
    intro = db.create_intro(
        "https://youtu.be/abc12345678", "/data/intros/x.mp4", 7.5,
        name="Bumper", youtube_id="abc12345678",
    )
    assert db.get_intro(intro.id).duration == 7.5
    assert [i.id for i in db.list_intros()] == [intro.id]
    data = intro.to_dict()
    assert data["name"] == "Bumper" and data["duration"] == 7.5


def test_intro_name_falls_back_to_youtube_id(fresh_db):
    intro = db.create_intro("https://youtu.be/x", "/x.mp4", 1.0, youtube_id="ytid123")
    assert intro.to_dict()["name"] == "ytid123"


def test_delete_intro_detaches_it_from_projects(fresh_db):
    project = db.upsert_project("vid00000001", "es")
    intro = db.create_intro("https://youtu.be/abc12345678", "/x.mp4", 5.0)
    db.set_project_master(project.id, "/m.mp4")
    db.set_project_intro(project.id, intro.id, intro.duration)
    assert db.get_project(project.id).intro_id == intro.id

    deleted = db.delete_intro(intro.id)
    assert deleted.id == intro.id
    assert db.get_intro(intro.id) is None
    refreshed = db.get_project(project.id)
    assert refreshed.intro_id is None and (refreshed.intro_duration or 0) == 0


def test_project_summary_exposes_master_and_intro(fresh_db):
    project = db.upsert_project("vid00000002", "es")
    db.set_project_master(project.id, "/m.mp4")
    intro = db.create_intro("https://youtu.be/abc12345678", "/x.mp4", 3.25)
    db.set_project_intro(project.id, intro.id, intro.duration)
    summary = db.get_project(project.id).summary()
    assert summary["has_master"] is True
    assert summary["intro_id"] == intro.id
    assert summary["intro_duration"] == 3.25


def test_library_usage_totals_kept_artefacts(fresh_db, tmp_path):
    for sub, name, blob in [
        ("masters", "a.mp4", b"x" * 1000),
        ("beds", "b.opus", b"y" * 500),
        ("intros", "c.mp4", b"z" * 250),
    ]:
        (tmp_path / sub).mkdir(exist_ok=True)
        (tmp_path / sub / name).write_bytes(blob)
    usage = db.library_usage()
    assert usage["masters"] == {"bytes": 1000, "count": 1}
    assert usage["beds"]["bytes"] == 500
    assert usage["intros"]["bytes"] == 250
    assert usage["total_bytes"] == 1750
    assert usage["total_human"]  # a non-empty human string


def test_ingest_intro_downloads_caches_and_measures(fresh_db, monkeypatch):
    from youtube_dubber.pipeline import downloader, ffmpeg_utils

    def fake_download(url, work_dir, on_progress=None):
        src = Path(work_dir) / "source.mp4"
        src.write_bytes(b"fake-mp4-bytes")
        return SimpleNamespace(video_path=str(src), id="introVID0001", title="My Intro")

    monkeypatch.setattr(downloader, "download_video", fake_download)
    monkeypatch.setattr(ffmpeg_utils, "probe_duration", lambda p: 6.0)

    intro = intros.ingest_intro("https://youtu.be/introVID0001")
    assert intro.duration == 6.0
    assert intro.youtube_id == "introVID0001"
    assert intro.name == "My Intro"  # falls back to the video title
    cached = Path(intro.file_path)
    assert cached.exists() and cached.parent.name == "intros"
    assert db.get_intro(intro.id).id == intro.id


def test_service_delete_intro_unlinks_media(fresh_db):
    intro_id = "deadbeef0001"
    dest = db.intro_file_path(intro_id)
    dest.write_bytes(b"data")
    intro = db.create_intro("https://youtu.be/x", str(dest), 2.0, intro_id=intro_id)
    assert Path(intro.file_path).exists()

    intros.delete_intro(intro.id)
    assert not Path(intro.file_path).exists()
    assert db.get_intro(intro.id) is None
