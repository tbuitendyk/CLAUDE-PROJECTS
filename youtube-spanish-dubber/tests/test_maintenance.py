"""Tests for the one-shot library maintenance: word-level time alignment,
transcript reconstruction from published videos, the English-column rebuild
that retains the stored Spanish text + timestamps, the sparse-English redo
(pass 2), titles from the Spanish videos, and the everything-reads-Published
finale. STT/downloads/probes are stubbed at the module seams."""
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
    # Network seams stubbed inert by default; tests override as needed.
    monkeypatch.setattr(maintenance, "_probe_title", lambda vid: None)
    return fake


# Segment doubles as a timed word (same start/end/text shape).
def _words(*triples):
    return [Segment(s, e, t) for s, e, t in triples]


def _rows():
    return [
        {"start": 0.0, "end": 5.0, "translated_text": "Hola"},
        {"start": 5.0, "end": 10.0, "translated_text": "Mundo"},
    ]


# --- align_words (pure) -------------------------------------------------------

def test_align_words_by_midpoint_window():
    words = _words((0.5, 1.0, "Hello"), (1.2, 1.8, "there"), (6.0, 6.5, "wide"), (7.0, 7.4, "world"))
    assert maintenance.align_words(_rows(), words) == ["Hello there", "wide world"]


def test_align_words_distributes_a_long_segment_across_rows():
    # THE reported bug: one long STT segment used to land whole on a single
    # row. As interpolated words, its text now spreads across both rows.
    words = _words((0.0, 2.5, "Hello"), (2.5, 4.9, "there"), (5.1, 7.5, "wide"), (7.5, 10.0, "world"))
    assert maintenance.align_words(_rows(), words) == ["Hello there", "wide world"]


def test_align_words_outside_all_windows_snap_to_nearest():
    words = _words((11.0, 12.0, "late"), (-2.0, -1.0, "early"))
    assert maintenance.align_words(_rows(), words) == ["early", "late"]


def test_align_words_joins_in_time_order_and_handles_empties():
    assert maintenance.align_words([], _words((0, 1, "x"))) == []
    assert maintenance.align_words(_rows(), []) == [None, None]
    words = _words((3.0, 3.5, "world"), (0.5, 1.0, "hello"))
    assert maintenance.align_words(_rows(), words) == ["hello world", None]


def test_english_coverage():
    assert maintenance.english_coverage([]) == 1.0
    rows = [{"original_text": "x"}, {"original_text": None}]
    assert maintenance.english_coverage(rows) == 0.5


# --- the full passes -----------------------------------------------------------

SRC = "srcVID00001"
DUB = "dubVID00001"


def _stub_stt(monkeypatch, en, es=None, calls=None):
    """en/es: (segments, words) tuples returned for source/dub URLs."""
    def fake(url, label):
        if calls is not None:
            calls.append(url)
        return es if (es and DUB in url) else en
    monkeypatch.setattr(maintenance, "_transcribe_url", fake)


def test_reconstructs_empty_entry_from_published_videos(fresh_db, monkeypatch):
    project = db.upsert_project(SRC, "es", source_title="Hello World")
    db.update_project(project.id, target_video_id=DUB)
    assert db.get_project(project.id).rows_list() == []

    _stub_stt(
        monkeypatch,
        en=([], _words((0.2, 2.0, "Hello"), (2.2, 4.5, "there"), (5.2, 7.0, "wide"), (7.2, 9.0, "world"))),
        es=([Segment(0.0, 5.0, "Hola amigos"), Segment(5.0, 10.0, "ancho mundo")], []),
    )
    maintenance.run_pending()

    entry = db.get_project(project.id)
    rows = entry.rows_list()
    # Timestamps of record = the SPANISH dub's segments.
    assert [(r["start"], r["end"]) for r in rows] == [(0.0, 5.0), (5.0, 10.0)]
    assert [r["translated_text"] for r in rows] == ["Hola amigos", "ancho mundo"]
    # English filled word-by-word; its timings used for alignment only.
    assert [r["original_text"] for r in rows] == ["Hello there", "wide world"]
    assert [r["text"] for r in entry.source_rows_list()] == ["Hello there", "wide world"]
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
        en=([], _words((1.0, 3.0, "Hello"), (3.5, 6.0, "edit"), (7.0, 9.0, "world"), (9.5, 12.0, "edit"))),
        calls=calls,
    )
    maintenance.run_pending()

    entry = db.get_project(project.id)
    rows = entry.rows_list()
    # Spanish text + timestamps RETAINED exactly; only English was rebuilt.
    assert [(r["start"], r["end"], r["translated_text"]) for r in rows] == [
        (1.25, 6.5, "Hola edición"), (6.5, 12.75, "Mundo edición"),
    ]
    assert [r["original_text"] for r in rows] == ["Hello edit", "world edit"]
    # Only the ENGLISH source was transcribed -- the dub was never touched.
    assert all(SRC in url for url in calls)
    assert all(r["original_text"] for r in entry.acquired_rows_list())
    assert [r["text"] for r in entry.source_rows_list()] == ["Hello edit", "world edit"]
    assert entry.state == "published"


def test_pass2_redoes_sparse_english_from_segment_era_alignment(fresh_db, monkeypatch):
    # Pass 1 already ran (flag set) and left the reported damage: a long
    # English segment dumped on one row, neighbours empty -> coverage 1/3.
    db.set_meta(maintenance.FLAG)
    sparse = [
        {"start": 0.0, "end": 5.0, "original_text": "Hello there wide world dumped here",
         "translated_text": "Hola"},
        {"start": 5.0, "end": 10.0, "original_text": None, "translated_text": "Mundo"},
        {"start": 10.0, "end": 15.0, "original_text": None, "translated_text": "Amigos"},
    ]
    project = db.upsert_project(SRC, "es")
    db.update_project(project.id, target_video_id=DUB, rows=json.dumps(sparse))

    _stub_stt(monkeypatch, en=([], _words(
        (0.5, 4.0, "Hello there"), (6.0, 9.0, "wide world"), (11.0, 14.0, "friends"),
    )))
    maintenance.run_pending()

    rows = db.get_project(project.id).rows_list()
    # The whole English column was rebuilt -- including the over-stuffed row.
    assert [r["original_text"] for r in rows] == ["Hello there", "wide world", "friends"]
    assert db.get_meta(maintenance.FLAG_B)

    # Pass 2 is one-shot too.
    monkeypatch.setattr(maintenance, "_transcribe_url",
                        lambda url, label: (_ for _ in ()).throw(AssertionError("must not re-run")))
    maintenance.run_pending()


def test_pass2_sets_titles_from_the_spanish_videos(fresh_db, monkeypatch):
    db.set_meta(maintenance.FLAG)
    bilingual = [{"start": 0.0, "end": 2.0, "original_text": "Hello", "translated_text": "Hola"}]
    project = db.upsert_project(SRC, "es", source_title="An English Title")
    db.mark_project_published(project.id, DUB, "stale title", bilingual, None, None, None)

    monkeypatch.setattr(maintenance, "_probe_title",
                        lambda vid: "[Versión Español] Hola Mundo" if vid == DUB else None)
    maintenance.run_pending()

    entry = db.get_project(project.id)
    assert entry.title == "[Versión Español] Hola Mundo"   # from the SPANISH video
    assert entry.source_title == "An English Title"        # untouched
    assert entry.state == "published"
    assert db.get_meta(maintenance.FLAG_B)
    assert any(e["action"] == "Library maintenance: title set from the published video"
               for e in db.list_events())


def test_complete_entries_are_untouched_and_passes_run_once(fresh_db, monkeypatch):
    bilingual = [{"start": 0.0, "end": 2.0, "original_text": "Hello", "translated_text": "Hola"}]
    project = db.upsert_project(SRC, "es")
    db.mark_project_published(project.id, DUB, "[ES] Hola", bilingual, None, None, None)
    # Give it a phantom pending-edits flag, as reported in the UI.
    db.update_project(project.id, published_fingerprint="stale")
    assert db.get_project(project.id).state == "published_pending"

    calls = []
    _stub_stt(monkeypatch, en=([], []), calls=calls)
    monkeypatch.setattr(maintenance, "_probe_title", lambda vid: "[ES] Hola")  # unchanged
    maintenance.run_pending()

    entry = db.get_project(project.id)
    assert entry.rows_list() == bilingual          # data untouched
    assert calls == []                             # no STT was run
    assert entry.state == "published"              # finale cleared the flag
    assert db.get_meta(maintenance.FLAG) and db.get_meta(maintenance.FLAG_B)

    maintenance.run_pending()                      # flag-guarded no-op
    assert calls == []


def test_failure_leaves_flags_unset_for_retry_but_still_publishes_states(fresh_db, monkeypatch):
    project = db.upsert_project(SRC, "es")
    db.update_project(project.id, target_video_id=DUB)  # empty entry -> needs STT

    def boom(url, label):
        raise RuntimeError("bot check")
    monkeypatch.setattr(maintenance, "_transcribe_url", boom)
    maintenance.run_pending()

    assert db.get_meta(maintenance.FLAG) is None   # retried on next restart
    assert db.get_project(project.id).state == "published"  # finale still ran
    assert any("entry failed" in e["action"] for e in db.list_events())
