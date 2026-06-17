"""Tests for the worker's intro path: persisting the pre-intro master after a
dub, and the intro-republish job (concat the intro + upload as a new video).
The uploader and the ffmpeg concat are mocked, so no network/ffmpeg is needed."""
from __future__ import annotations

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


def _published(source_video_id, **extra):
    project = db.upsert_project(source_video_id, "es")
    db.mark_project_published(
        project.id, target_video_id="OLDvideo", title="My Title",
        rows=[{"start": 0, "end": 1, "original_text": "Hi", "translated_text": "Hola"}],
        thumbnail=None, voice="es-ES-AlvaroNeural", privacy="unlisted",
    )
    master = db.project_master_path(project.id)
    master.write_bytes(b"master-bytes")
    db.set_project_master(project.id, master)
    if extra:
        db.update_project(project.id, **extra)
    return db.get_project(project.id), master


def test_cache_master_persists_the_dub(fresh_db, tmp_path):
    project = db.upsert_project("vid00000003", "es")
    dubbed = tmp_path / "dubbed.mp4"
    dubbed.write_bytes(b"video")

    worker._cache_master(project, str(dubbed))

    refreshed = db.get_project(project.id)
    assert refreshed.master_path == str(db.project_master_path(project.id))
    assert Path(refreshed.master_path).exists()


def test_process_intro_prepends_and_publishes(fresh_db, monkeypatch):
    from youtube_dubber.pipeline import ffmpeg_utils, uploader

    project, master = _published("vid00000004", description="desc")
    intro = db.create_intro(
        "https://youtu.be/i", str(db.intro_file_path("introAAAA")), 4.0, intro_id="introAAAA",
    )
    Path(intro.file_path).write_bytes(b"intro-bytes")
    db.set_project_intro(project.id, intro.id, intro.duration)

    seen: dict = {}

    def fake_prepend(intro_path, master_path, dst, on_progress=None):
        Path(dst).write_bytes(b"joined")
        seen["prepended"] = (Path(intro_path).name, Path(master_path).name)
        return dst

    def fake_upload(path, title, description, privacy_status, on_progress=None):
        seen["uploaded"] = {
            "exists": Path(path).exists(), "title": title,
            "description": description, "privacy": privacy_status,
        }
        return "NEWvideo002"

    monkeypatch.setattr(ffmpeg_utils, "prepend_intro", fake_prepend)
    monkeypatch.setattr(uploader, "upload_video", fake_upload)

    job = db.create_job(
        db.naming.watch_url("vid00000004"), "es", mode="intro",
        project_id=project.id, privacy="public",
    )
    proj = db.get_project(project.id)
    result = worker._process_intro(job, proj, db.job_work_dir(job.id), lambda *a, **k: None)

    assert result == {"youtube_video_id": "NEWvideo002",
                      "youtube_video_url": "https://youtu.be/NEWvideo002", "had_intro": True}
    assert seen["prepended"][0] == "introAAAA.mp4"
    assert seen["uploaded"]["exists"] is True
    assert seen["uploaded"]["title"] == "My Title"
    # The stored description plus the appended "Original video" credit.
    assert seen["uploaded"]["description"].startswith("desc")
    assert "Vídeo original: https://www.youtube.com/watch?v=vid00000004" in seen["uploaded"]["description"]
    assert seen["uploaded"]["privacy"] == "public"  # the job override wins over the entry

    worker._finish_intro(job, proj, result)
    published = db.get_project(project.id)
    assert published.target_video_id == "NEWvideo002"
    assert published.state == "published"
    done = db.get_job(job.id)
    assert done.status == "done" and done.youtube_video_id == "NEWvideo002"


def test_process_dub_with_intro_prepends_then_publishes(fresh_db, monkeypatch, tmp_path):
    # "Dub & publish" with an intro chosen: one job builds the master (unpublished
    # in the runner), prepends the intro, uploads, applies the branded thumbnail
    # and leaves the intro attached.
    from youtube_dubber.pipeline import ffmpeg_utils, runner, uploader

    project = db.upsert_project("vid00000008", "es")
    intro = db.create_intro(
        "https://youtu.be/i", str(db.intro_file_path("introBBBB")), 5.0, intro_id="introBBBB",
    )
    Path(intro.file_path).write_bytes(b"intro-bytes")

    dubbed = tmp_path / "dubbed.mp4"
    dubbed.write_bytes(b"master")
    thumb = tmp_path / "thumb.jpg"
    thumb.write_bytes(b"jpg")
    seen: dict = {}

    def fake_run(*args, publish=True, **kwargs):
        seen["run_publish"] = publish  # dub-with-intro must build the master unpublished
        return {
            "youtube_video_id": None, "youtube_video_url": None,
            "title": "[ES] Title", "description": "Desc\n\nVídeo original: x",
            "source_title": "Hello", "source_video_id": "vid00000008",
            "voice": "es-ES-AlvaroNeural",
            "transcript": [{"start": 0, "end": 1, "original_text": "Hi", "translated_text": "Hola"}],
            "dubbed_path": str(dubbed), "bed_source_path": None, "thumbnail_path": str(thumb),
        }

    def fake_prepend(intro_path, master_path, dst, on_progress=None):
        Path(dst).write_bytes(b"joined")
        seen["prepended"] = (Path(intro_path).name, Path(master_path).name)
        return dst

    def fake_upload(path, title, description, privacy_status, on_progress=None):
        seen["upload"] = {"name": Path(path).name, "exists": Path(path).exists(),
                          "title": title, "privacy": privacy_status}
        return "DUBINTRO01"

    monkeypatch.setattr(runner, "run", fake_run)
    monkeypatch.setattr(ffmpeg_utils, "prepend_intro", fake_prepend)
    monkeypatch.setattr(uploader, "upload_video", fake_upload)
    monkeypatch.setattr(uploader, "set_thumbnail", lambda vid, path: seen.update(thumb=Path(path).name))

    job = db.create_job(db.naming.watch_url("vid00000008"), "es", mode="dub",
                        project_id=project.id, privacy="public", intro_id="introBBBB")
    worker._process(job)

    assert seen["run_publish"] is False
    assert seen["prepended"][0] == "introBBBB.mp4"
    assert seen["upload"]["name"] == "with_intro.mp4"   # the joined file, not the bare master
    assert seen["upload"]["title"] == "[ES] Title"
    assert seen["upload"]["privacy"] == "public"
    assert seen["thumb"] == "thumb.jpg"                 # branded thumbnail applied

    entry = db.get_project(project.id)
    assert entry.target_video_id == "DUBINTRO01" and entry.state == "published"
    assert entry.intro_id == "introBBBB" and (entry.intro_duration or 0) == 5.0  # intro stays attached
    done = db.get_job(job.id)
    assert done.status == "done" and done.youtube_video_id == "DUBINTRO01"


def test_process_intro_removed_uploads_the_bare_master(fresh_db, monkeypatch):
    from youtube_dubber.pipeline import uploader

    project, master = _published("vid00000006")  # no intro attached

    seen: dict = {}
    monkeypatch.setattr(
        uploader, "upload_video",
        lambda path, title, description, privacy_status, on_progress=None: (
            seen.update(path=str(path)) or "NEWBARE001"
        ),
    )

    job = db.create_job(db.naming.watch_url("vid00000006"), "es", mode="intro", project_id=project.id)
    result = worker._process_intro(job, db.get_project(project.id), db.job_work_dir(job.id), lambda *a, **k: None)

    assert result["had_intro"] is False
    assert seen["path"] == str(master)  # the bare master is uploaded, no concat
    assert result["youtube_video_id"] == "NEWBARE001"


def test_process_intro_without_master_errors(fresh_db):
    project = db.upsert_project("vid00000005", "es")
    job = db.create_job(db.naming.watch_url("vid00000005"), "es", mode="intro", project_id=project.id)
    with pytest.raises(RuntimeError, match="no saved pre-intro master"):
        worker._process_intro(job, db.get_project(project.id), db.job_work_dir(job.id), lambda *a, **k: None)


def test_finish_dub_persists_master_and_clears_intro(fresh_db, monkeypatch, tmp_path):
    # A dub finishing should stash its master and (since it publishes WITHOUT an
    # intro) clear any previously-attached intro, while keeping the description.
    project, _ = _published("vid00000007")
    intro = db.create_intro("https://youtu.be/i", "/i.mp4", 3.0)
    db.set_project_intro(project.id, intro.id, intro.duration)

    dubbed = tmp_path / "dubbed.mp4"
    dubbed.write_bytes(b"new-dub")
    job = db.create_job(db.naming.watch_url("vid00000007"), "es", mode="dub", project_id=project.id)
    result = {
        "youtube_video_id": "FRESHdub01",
        "youtube_video_url": "https://youtu.be/FRESHdub01",
        "title": "My Title", "description": "fresh description",
        "transcript": [{"start": 0, "end": 1, "original_text": "Hi", "translated_text": "Hola"}],
        "voice": "es-ES-AlvaroNeural", "dubbed_path": str(dubbed), "bed_source_path": None,
    }
    worker._finish_dub(job, db.get_project(project.id), result)

    refreshed = db.get_project(project.id)
    assert Path(refreshed.master_path).exists()
    assert refreshed.intro_id is None and (refreshed.intro_duration or 0) == 0
    assert refreshed.description == "fresh description"
    assert refreshed.target_video_id == "FRESHdub01"
