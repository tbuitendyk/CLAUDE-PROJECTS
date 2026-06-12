"""One-shot library maintenance (2026-06-12): initialise the existing entries.

Operator-directed data fixes, run ONCE by the worker before it starts claiming
jobs -- so the heavy Whisper passes are serialized with dubbing, never
concurrent with it. The stack, as specified:

 1. Entries with NO transcript rows: reconstruct from the published videos
    themselves. Whisper on the SPANISH dub provides the stored rows (text +
    timestamps -- the timings of record are always the Spanish side); Whisper
    on the ENGLISH source fills the original-language column, its own
    timestamps used for time-overlap alignment only. No translation work.
 2. Entries whose rows are Spanish-only (e.g. source Dj5OYkgDtHU / dub
    tcx86qRHAaI): RETAIN the stored Spanish text and timestamps untouched and
    fill ONLY the English column from the source video, aligned by time
    overlap. The immutable source_rows are captured from that English.
 3. Finally, every entry with a published dub accepts its current content as
    the published content -- the whole library reads Published, with no
    'redub in progress' flags surviving the maintenance.

Flag-guarded (meta key below): per-entry best effort, and the flag is only set
once a pass finishes with no failures, so a transient YouTube/STT failure is
retried on the next service restart. Entries already fixed are skipped by
their DATA (rows present / English present), not by the flag, so a retry never
redoes finished work.
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


def align_by_overlap(rows: list[dict], segments: list) -> list[str | None]:
    """Distribute STT segments over stored rows by time overlap.

    Each segment (with .start/.end/.text) is assigned to the row whose
    [start, end) window it overlaps most -- a segment with no positive overlap
    snaps to the row with the nearest start, so no spoken text is ever dropped.
    Returns one joined text (or None) per row, in the rows' order."""
    if not rows:
        return []
    assigned: list[list[tuple[float, str]]] = [[] for _ in rows]
    starts = [float(row.get("start", 0.0)) for row in rows]
    for seg in segments:
        text = (seg.text or "").strip()
        if not text:
            continue
        best_index, best_overlap = None, 0.0
        for index, row in enumerate(rows):
            overlap = min(float(row.get("end", 0.0)), seg.end) - max(starts[index], seg.start)
            if overlap > best_overlap:
                best_index, best_overlap = index, overlap
        if best_index is None:
            best_index = min(range(len(rows)), key=lambda i: abs(starts[i] - seg.start))
        assigned[best_index].append((seg.start, text))
    return [" ".join(text for _, text in sorted(parts)) or None for parts in assigned]


def _transcribe_url(url: str, label: str) -> list:
    """Download a video and Whisper-transcribe it (language auto-detected).
    Module-level seam so tests stub it. Work files and the STT model are
    released before returning, keeping the resident set bounded per video."""
    from .pipeline import downloader, speech_to_text

    work_dir = settings.data_dir / "maintenance" / (naming.extract_video_id(url) or "video")
    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        log.info("Maintenance: downloading %s (%s)", url, label)
        info = downloader.download_video(url, work_dir)
        log.info("Maintenance: transcribing %s (%s)", url, label)
        segments, language, _words = speech_to_text.transcribe(Path(info.video_path))
        log.info("Maintenance: %s -> %d segments (language=%s)", label, len(segments), language)
        return segments
    finally:
        speech_to_text.release_model()
        memory.release_to_os()
        shutil.rmtree(work_dir, ignore_errors=True)


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
    overlap."""
    es_segments = _transcribe_url(naming.watch_url(project.target_video_id), "Spanish dub")
    rows = [
        {"start": seg.start, "end": seg.end, "original_text": None,
         "translated_text": (seg.text or "").strip()}
        for seg in es_segments
        if (seg.text or "").strip()
    ]
    if not rows:
        raise RuntimeError(f"No speech found in the published dub {project.target_video_id}")
    en_segments = _transcribe_url(naming.watch_url(project.source_video_id), "English source")
    for row, original in zip(rows, align_by_overlap(rows, en_segments)):
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
        video_title=project.source_title or project.title,
        project_id=project.id,
        detail=f"{len(rows)} lines",
    )


def _fill_english(project: db.Project) -> None:
    """Fix 2: rows stay EXACTLY as stored (Spanish text + timestamps retained);
    only the English column is filled from the source video by time overlap."""
    rows = [dict(r) for r in project.rows_list()]
    en_segments = _transcribe_url(naming.watch_url(project.source_video_id), "English source")
    for row, original in zip(rows, align_by_overlap(rows, en_segments)):
        if not row.get("original_text"):
            row["original_text"] = original

    fields: dict = {"rows": json.dumps(rows)}
    acquired = project.acquired_rows_list()
    if acquired and not any(r.get("original_text") for r in acquired):
        repaired = [dict(r) for r in acquired]
        for row, original in zip(repaired, align_by_overlap(repaired, en_segments)):
            row["original_text"] = original
        fields["acquired_rows"] = json.dumps(repaired)
    elif not acquired:
        fields["acquired_rows"] = json.dumps(rows)
    if not project.source_rows:
        source_rows = _source_rows_from(rows)
        if source_rows:
            fields["source_rows"] = source_rows
    db.update_project(project.id, **fields)
    db.record_event(
        "Library maintenance: English transcript filled from the source video",
        video_title=project.source_title or project.title,
        project_id=project.id,
        detail=f"{len(rows)} lines",
    )


def run_pending() -> None:
    """The whole maintenance pass; called by the worker before its first claim."""
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
                video_title=project.source_title or project.title,
                project_id=project.id,
                detail=str(exc).split("\n")[0][:300],
            )

    # Fix 3 -- runs regardless: every published entry accepts its current
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
