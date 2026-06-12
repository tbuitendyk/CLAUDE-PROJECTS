"""One-shot library maintenance: initialise the existing entries.

Operator-directed data fixes, run ONCE by the worker before it starts claiming
jobs -- so the heavy Whisper passes are serialized with dubbing, never
concurrent with it.

Pass 1 (2026-06-12, FLAG):
 1. Entries with NO transcript rows: reconstruct from the published videos
    themselves. Whisper on the SPANISH dub provides the stored rows (text +
    timestamps -- the timings of record are always the Spanish side); Whisper
    on the ENGLISH source fills the original-language column, its word-level
    timestamps used for alignment only. No translation work.
 2. Entries whose rows are Spanish-only: RETAIN the stored Spanish text and
    timestamps untouched and fill ONLY the English column from the source
    video. The immutable source_rows are captured from that English.
 3. Finally, every entry with a published dub accepts its current content as
    the published content -- the whole library reads Published.

Pass 2 (2026-06-12b, FLAG_B):
 4. Redo sparse English columns. Pass 1's first run aligned whole Whisper
    SEGMENTS to rows -- a long English segment landed on a single Spanish row
    and left its neighbours empty ("almost all the english text is missing").
    Alignment is now per-WORD (Whisper word timings, or timings interpolated
    from the segments), so every word lands in the row whose time window holds
    it. Any entry whose English coverage is under 90% gets its English column
    rebuilt from a fresh source-video pass.
 5. Library titles all come from the SPANISH (published dub) videos: each
    published entry's title is set from a live yt-dlp probe of its dub.

Flag-guarded per pass: a flag is only set once its pass finishes with no
failures, so a transient YouTube/STT failure is retried on the next service
restart. Entries already fixed are skipped by their DATA, never redone.
"""
from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path

from . import db, memory, naming
from .config import settings

log = logging.getLogger(__name__)

FLAG = "library_maintenance_20260612"
FLAG_B = "library_maintenance_20260612b"

# Rows whose English coverage is below this get their original column rebuilt.
MIN_ENGLISH_COVERAGE = 0.9


def align_words(rows: list[dict], words: list) -> list[str | None]:
    """Distribute timed WORDS over stored rows: each word (with .start/.end/
    .text) lands in the row whose [start, end) window contains its midpoint; a
    word outside every window snaps to the nearest row, so no spoken text is
    ever dropped. Word-level granularity is the point -- whole STT segments
    are often longer than the rows, and assigning a segment to one row starves
    its neighbours. Returns one joined text (or None) per row, in row order."""
    if not rows:
        return []
    spans = [(float(r.get("start", 0.0)), float(r.get("end", 0.0))) for r in rows]

    def distance(index: int, midpoint: float) -> float:
        start, end = spans[index]
        if start <= midpoint < end:
            return 0.0
        return start - midpoint if midpoint < start else midpoint - end

    buckets: list[list[tuple[float, str]]] = [[] for _ in rows]
    for word in words:
        text = (word.text or "").strip()
        if not text:
            continue
        midpoint = (float(word.start) + float(word.end)) / 2.0
        index = next((i for i, (s, e) in enumerate(spans) if s <= midpoint < e), None)
        if index is None:
            index = min(range(len(rows)), key=lambda i: distance(i, midpoint))
        buckets[index].append((float(word.start), text))
    return [" ".join(text for _, text in sorted(bucket)) or None for bucket in buckets]


def english_coverage(rows: list[dict]) -> float:
    """Fraction of rows carrying original-language text (1.0 for no rows)."""
    if not rows:
        return 1.0
    return sum(1 for r in rows if r.get("original_text")) / len(rows)


def _transcribe_url(url: str, label: str) -> tuple[list, list]:
    """Download a video and Whisper-transcribe it (language auto-detected).
    Returns (segments, words); when Whisper produced no word timings, words
    are interpolated from the segments so word-level alignment always has
    data. Module-level seam so tests stub it. Work files and the STT model
    are released before returning."""
    from .pipeline import downloader, rechunker, speech_to_text

    work_dir = settings.data_dir / "maintenance" / (naming.extract_video_id(url) or "video")
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        log.info("Maintenance: downloading %s (%s)", url, label)
        info = downloader.download_video(url, work_dir)
        log.info("Maintenance: transcribing %s (%s)", url, label)
        segments, language, words = speech_to_text.transcribe(Path(info.video_path))
        if not words:
            words = rechunker.words_from_segments(segments)
        log.info("Maintenance: %s -> %d segments / %d timed words (language=%s)",
                 label, len(segments), len(words), language)
        return segments, words
    finally:
        speech_to_text.release_model()
        memory.release_to_os()
        shutil.rmtree(work_dir, ignore_errors=True)


def _probe_title(video_id: str) -> str | None:
    """The live title of a video on YouTube (metadata only, no download).
    Module-level seam so tests stub it."""
    from .pipeline import downloader

    info = downloader.probe(naming.watch_url(video_id))
    title = (info.get("title") or "").strip()
    return title or None


def _source_rows_from(rows: list[dict]) -> str | None:
    source_rows = [
        {"start": r.get("start"), "end": r.get("end"), "text": r["original_text"]}
        for r in rows
        if r.get("original_text")
    ]
    return json.dumps(source_rows) if source_rows else None


def _reconstruct_entry(project: db.Project) -> None:
    """Fix 1: an empty entry gets its transcript back from the published
    videos -- Spanish dub rows (the timestamps of record) + English by
    word-level time alignment."""
    es_segments, _es_words = _transcribe_url(naming.watch_url(project.target_video_id), "Spanish dub")
    rows = [
        {"start": seg.start, "end": seg.end, "original_text": None,
         "translated_text": (seg.text or "").strip()}
        for seg in es_segments
        if (seg.text or "").strip()
    ]
    if not rows:
        raise RuntimeError(f"No speech found in the published dub {project.target_video_id}")
    _en_segments, en_words = _transcribe_url(naming.watch_url(project.source_video_id), "English source")
    for row, original in zip(rows, align_words(rows, en_words)):
        row["original_text"] = original

    fields: dict = {"rows": json.dumps(rows)}
    if not project.acquired_rows:
        fields["acquired_rows"] = json.dumps(rows)
    if not project.source_rows:
        source_rows = _source_rows_from(rows)
        if source_rows:
            fields["source_rows"] = source_rows
    db.update_project(project.id, **fields)
    db.record_event(
        "Library maintenance: transcript reconstructed from the published videos",
        video_title=project.title or project.source_title,
        project_id=project.id,
        detail=f"{len(rows)} lines",
    )


def _fill_english(project: db.Project) -> None:
    """Fixes 2 + 4: rows stay EXACTLY as stored (Spanish text + timestamps
    retained); the English column is REBUILT from a fresh source-video pass by
    word-level alignment. The English side is machine-owned (the UI never
    edits it), so overwriting is always safe -- and it's what heals a sparse
    fill from the old segment-level alignment."""
    rows = [dict(r) for r in project.rows_list()]
    _segments, en_words = _transcribe_url(naming.watch_url(project.source_video_id), "English source")
    for row, original in zip(rows, align_words(rows, en_words)):
        row["original_text"] = original

    fields: dict = {"rows": json.dumps(rows)}
    acquired = project.acquired_rows_list()
    if acquired:
        repaired = [dict(r) for r in acquired]
        for row, original in zip(repaired, align_words(repaired, en_words)):
            row["original_text"] = original
        fields["acquired_rows"] = json.dumps(repaired)
    else:
        fields["acquired_rows"] = json.dumps(rows)
    source_rows = _source_rows_from(rows)
    if source_rows:
        fields["source_rows"] = source_rows
    db.update_project(project.id, **fields)
    db.confirm_published_state(project.id)  # a repair is not a user edit
    db.record_event(
        "Library maintenance: English transcript filled from the source video",
        video_title=project.title or project.source_title,
        project_id=project.id,
        detail=f"{len(rows)} lines",
    )


def _pass_initial() -> None:
    """Pass 1: reconstruct empty entries, fill Spanish-only ones, then make the
    whole library read Published."""
    if db.get_meta(FLAG):
        return
    log.info("Running one-shot library maintenance (%s)...", FLAG)
    failures = 0
    for project in db.list_projects():
        rows = project.rows_list()
        try:
            if not rows and project.target_video_id:
                _reconstruct_entry(project)
            elif rows and not any(r.get("original_text") for r in rows):
                _fill_english(project)
        except Exception as exc:  # noqa: BLE001 -- per-entry best effort
            failures += 1
            log.exception("Maintenance failed for project %s", project.id)
            db.record_event(
                "Library maintenance: entry failed (will retry on next restart)",
                video_title=project.title or project.source_title,
                project_id=project.id,
                detail=str(exc).split("\n")[0][:300],
            )

    # Finale -- runs regardless: every published entry accepts its current
    # content, so nothing is left reading 'redub in progress'.
    for project in db.list_projects():
        db.confirm_published_state(project.id)

    if failures == 0:
        db.set_meta(FLAG)
        db.record_event("Library maintenance complete",
                        detail="all entries Published; transcripts initialised")
        log.info("Library maintenance complete; flag %s set.", FLAG)
    else:
        log.warning("Library maintenance finished with %d failure(s); flag NOT set -- "
                    "it will retry on the next restart.", failures)


def _pass_english_redo_and_titles() -> None:
    """Pass 2: rebuild sparse English columns at word-level granularity, and
    set every published entry's title from its SPANISH video."""
    if db.get_meta(FLAG_B):
        return
    log.info("Running library maintenance pass 2 (%s)...", FLAG_B)
    failures = 0
    for project in db.list_projects():
        rows = project.rows_list()
        try:
            if rows and english_coverage(rows) < MIN_ENGLISH_COVERAGE:
                _fill_english(project)
        except Exception as exc:  # noqa: BLE001
            failures += 1
            log.exception("English redo failed for project %s", project.id)
            db.record_event(
                "Library maintenance: entry failed (will retry on next restart)",
                video_title=project.title or project.source_title,
                project_id=project.id,
                detail=str(exc).split("\n")[0][:300],
            )

    for project in db.list_projects():
        if not project.target_video_id:
            continue
        try:
            title = _probe_title(project.target_video_id)
            if title and title != project.title:
                db.update_project(project.id, title=title)
                db.record_event(
                    "Library maintenance: title set from the published video",
                    video_title=title, project_id=project.id,
                )
        except Exception as exc:  # noqa: BLE001
            failures += 1
            log.warning("Title probe failed for %s (%s)", project.target_video_id, exc)

    if failures == 0:
        db.set_meta(FLAG_B)
        db.record_event("Library maintenance pass 2 complete",
                        detail="English columns word-aligned; titles from the Spanish videos")
        log.info("Library maintenance pass 2 complete; flag %s set.", FLAG_B)
    else:
        log.warning("Maintenance pass 2 finished with %d failure(s); flag NOT set -- "
                    "it will retry on the next restart.", failures)


def run_pending() -> None:
    """All pending maintenance; called by the worker before its first claim."""
    _pass_initial()
    _pass_english_redo_and_titles()
