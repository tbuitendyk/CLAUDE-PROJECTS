"""Tests for the one-shot library maintenance (2026-06-12): time-overlap
alignment, transcript reconstruction from published videos, English-column
fill that retains the stored Spanish text + timestamps, and the everything-
reads-Published finale. STT/downloads are stubbed at the module seam."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from youtube_dubber import db, maintenance
from youtube_dubber.pipeline.models import Segment


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
    with db._connect() as conn:
        conn.execute("DELETE FROM meta")  # let the maintenance under test run
    return fake


# --- align_by_overlap (pure) -------------------------------------------------

def _rows():
    return [
        {"start": 0.0, "end": 5.0, "translated_text": "Hola"},
        {"start": 5.0, "end": 10.0, "translated_text": "Mundo"},
    ]


def test_align_assigns_segments_to_most_overlapped_row():
    segments = [Segment(0.5, 4.0, "Hello there"), Segment(5.5, 9.0, "wide world")]
    assert maintenance.align_by_overlap(_rows(), segments) == ["Hello there", "wide world"]


def test_align_straddling_segment_goes_to_dominant_row():
    # 3.0-7.0 overlaps row1 by 2s and row2 by 2s -> first found max wins (row1);
    # 3.0-8.0 overlaps row2 more (3s) -> row2.
    assert maintenance.align_by_overlap(_rows(), [Segment(3.0, 8.0, "straddler")]) == [None, "straddler"]


def test_align_joins_multiple_segments_in_time_order():
    segments = [Segment(2.0, 4.0, "world"), Segment(0.0, 1.5, "hello")]
    assert maintenance.align_by_overlap(_rows(), segments) == ["hello world", None]


def test_align_no_overlap_snaps_to_nearest_row_so_text_is_never_dropped():
    segments = [Segment(20.0, 22.0, "late text")]
    assert maintenance.align_by_overlap(_rows(), segments) == [None, "late text"]


def test_align_empty_inputs():
    assert maintenance.align_by_overlap([], [Segment(0, 1, "x")]) == []
    assert maintenance.align_by_overlap(_rows(), []) == [None, None]


# --- the full pass -----------------------------------------------------------

SRC = "srcVID00001"
DUB = "dubVID00001"


def _stub_stt(monkeypatch, en_segments, es_segments, calls=None):
    def fake(url, label):
        if calls is not None:
            calls.append(url)
        return es_segments if DUB in url else en_segments
    monkeypatch.setattr(maintenance, "_transcribe_url", fake)


def test_reconstructs_empty_entry_from_published_videos(fresh_db, monkeypatch):
    project = db.upsert_project(SRC, "es", source_title="Hello World")
    db.update_project(project.id, target_video_id=DUB, title="[ES] Hola")
    assert db.get_project(project.id).rows_list() == []

    _stub_stt(
        monkeypatch,
        en_segments=[Segment(0.2, 4.5, "Hello there"), Segment(5.2, 9.0, "wide world")],
        es_segments=[Segment(0.0, 5.0, "Hola amigos"), Segment(5.0, 10.0, "ancho mundo")],
    )
    maintenance.run_pending()

    entry = db.get_project(project.id)
    rows = entry.rows_list()
    # Timestamps of record = the SPANISH dub's segments.
    assert [(r["start"], r["end"]) for r in rows] == [(0.0, 5.0), (5.0, 10.0)]
    assert [r["translated_text"] for r in rows] == ["Hola amigos", "ancho mundo"]
    # English filled by overlap; its own timings were used for alignment only.
    assert [r["original_text"] for r in rows] == ["Hello there", "wide world"]
    assert [r["text"] for r in entry.source_rows_list()] == ["Hello there", "wide world"]
    assert entry.acquired_rows_list() == rows
    # Fix 3: the library reads Published when maintenance is done.
    assert entry.state == "published"
    assert db.get_meta(maintenance.FLAG)


def test_fills_english_retaining_spanish_text_and_timestamps(fresh_db, monkeypatch):
    # The Dj5OYkgDtHU/tcx86qRHAaI shape: Spanish-only rows with job-record
    # timings that must come through byte-identical.
    spanish_rows = [
        {"start": 1.25, "end": 6.5, "original_text": None, "translated_text": "Hola edición"},
        {"start": 6.5, "end": 12.75, "original_text": None, "translated_text": "Mundo edición"},
    ]
    project = db.upsert_project(SRC, "es")
    db.update_project(project.id, target_video_id=DUB,
                      rows=json.dumps(spanish_rows), acquired_rows=json.dumps(spanish_rows))

    calls = []
    _stub_stt(
        monkeypatch,
        en_segments=[Segment(1.0, 6.0, "Hello edit"), Segment(7.0, 12.0, "world edit")],
        es_segments=[Segment(0, 1, "NOT USED")],
        calls=calls,
    )
    maintenance.run_pending()

    entry = db.get_project(project.id)
    rows = entry.rows_list()
    # Spanish text + timestamps RETAINED exactly; only English was filled.
    assert [(r["start"], r["end"], r["translated_text"]) for r in rows] == [
        (1.25, 6.5, "Hola edición"), (6.5, 12.75, "Mundo edición"),
    ]
    assert [r["original_text"] for r in rows] == ["Hello edit", "world edit"]
    # Only the ENGLISH source was transcribed -- the dub was never touched.
    assert all(SRC in url for url in calls)
    # Acquired (revert) copy repaired the same way; source_rows captured.
    assert all(r["original_text"] for r in entry.acquired_rows_list())
    assert [r["text"] for r in entry.source_rows_list()] == ["Hello edit", "world edit"]
    assert entry.state == "published"


def test_complete_entries_are_untouched_and_pass_runs_once(fresh_db, monkeypatch):
    bilingual = [{"start": 0.0, "end": 2.0, "original_text": "Hello", "translated_text": "Hola"}]
    project = db.upsert_project(SRC, "es")
    db.mark_project_published(project.id, DUB, "t", bilingual, None, None, None)
    # Give it a phantom pending-edits flag, as reported in the UI.
    db.update_project(project.id, published_fingerprint="stale")
    assert db.get_project(project.id).state == "published_pending"

    calls = []
    _stub_stt(monkeypatch, [], [], calls=calls)
    maintenance.run_pending()

    entry = db.get_project(project.id)
    assert entry.rows_list() == bilingual          # data untouched
    assert calls == []                             # no STT was run
    assert entry.state == "published"              # fix 3 cleared the flag
    assert db.get_meta(maintenance.FLAG)

    maintenance.run_pending()                      # flag-guarded no-op
    assert calls == []


def test_failure_leaves_flag_unset_for_retry_but_still_publishes_states(fresh_db, monkeypatch):
    project = db.upsert_project(SRC, "es")
    db.update_project(project.id, target_video_id=DUB)  # empty entry -> needs STT

    def boom(url, label):
        raise RuntimeError("bot check")
    monkeypatch.setattr(maintenance, "_transcribe_url", boom)
    maintenance.run_pending()

    assert db.get_meta(maintenance.FLAG) is None   # retried on next restart
    assert db.get_project(project.id).state == "published"  # finale still ran
    assert any("entry failed" in e["action"] for e in db.list_events())
