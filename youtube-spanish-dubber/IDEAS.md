# Dubber — Ideas / Backlog

Living queue of planned work for the **youtube-spanish-dubber** backend (this
`dubber` branch). UI-only pieces ship from the `website` branch (see
`CLAUDE.md`) and are flagged where relevant. Newest thinking wins — prune as
items land.

## Recently shipped

- **Anchored audio timeline** (`3b21a99`) — each dubbed line is placed at its
  *real* timestamp, with the original pauses kept as silence; when a line
  overruns, the next starts ASAP and the slack is absorbed at the next pause
  ("catch up in the pauses") instead of accumulating drift. Replaced the old
  back-to-back assembly that drifted seconds ahead/behind. Tunable via
  `DUBBER_TTS_RATE` and `DUBBER_TTS_MAX_TEMPO`.
- **TTS base-rate tuning** — settled on `-5%` as the code default
  (`config.tts_rate`), tuned by ear against the anchored timeline. `.env`
  override removed so the code default is the single source of truth.
- **Re-thumbnail an existing video** — standalone tool to push a translated
  thumbnail onto an already-published video on the connected channel, no re-dub.
  Backend: `POST /thumbnail/apply` (`app.py`) parses the target ID and calls
  `uploader.set_thumbnail` (now with opt-in `raise_on_error` so the tool reports
  why a set was refused). UI (`website` branch): a third control box with its own
  target-URL field + "Update thumbnail", reusing a refactored
  `makeThumbnailEditor` widget (one factory, two instances: dub + re-thumbnail).
- **Background music under preserved pauses** — `audio_mode` now defaults to
  `"duck"`: `ffmpeg_utils.duck_filter_complex` keeps the source audio as a bed
  (`DUBBER_DUCK_VOLUME`, default 0.40) that sidechain-compresses under the
  narration and rises back in the anchored timeline's pauses. Tunable bed level;
  `audio_mode=replace` restores full replacement.

## Queue

### 1. 🔭 Big Fix — translate in-video (frame) text, not just the thumbnail
- Today only the thumbnail's baked-in text gets translated/localized
  (`pipeline/thumbnail.py` + ONNX scene-text OCR). Source videos often have
  on-screen text *during playback* (titles, captions, callouts, lower-thirds)
  that stays in English in the dub.
- Likely shape: reuse the thumbnail OCR/translate/inpaint pipeline
  (`image_text.py`, `thumbnail.py`) but applied per-frame (or per-shot) across
  the video rather than to a single still image — detect text regions, OCR,
  translate, inpaint, overlay the Spanish text, for the span the text is on
  screen.
- Open questions to scope before starting: cost/perf of running OCR across a
  full video (sampling strategy — keyframes vs. every frame vs. scene-cut
  detection), how to track a text region across frames so the overlay doesn't
  flicker/jitter, and how this interacts with the existing mux step in
  `runner.py`.

### 2. 🎬 Intro clips — add / remove / swap an intro on a completed dub
- **Goal:** record short intro clips and be able to attach one to the front of
  any *already-completed* dub — and later change it or strip it back off —
  **without re-dubbing**, and without corrupting the dub's own timeline so
  subsequent transcript edits still line up.
- **Intro ingestion via YouTube:** the intros are recorded, uploaded to YouTube
  as **unlisted/private** videos, and supplied by link. The server fetches the
  media with the existing yt-dlp downloader (`pipeline/downloader.py`) — reuses
  the infra we already have and avoids a separate file-upload path. Each fetched
  intro is cached (the media + its **measured exact duration**) keyed by the
  YouTube id, so reusing the same intro across dubs is cheap.
- **What must be persisted, per dub (the crux):**
  1. **The pre-intro master.** Today the finished dub lives at
     `work_dir/dubbed.mp4` and the work dir is deleted after upload. To
     add/remove/swap an intro later we must keep that master (dub *before* any
     intro is prepended) on the server — encode it into the project cache the
     way a freshly separated bed already is (`runner.run` → `bed_source_path`),
     keyed by job / source video id.
  2. **The current intro state + its exact length.** Store which intro is
     attached (the cached intro id) **and its precise duration** — or "none".
- **Why the length matters:** the dub's transcript runs on the *anchored
  timeline* (each line at its real timestamp; see "Recently shipped"). That
  timeline is relative to the **master** (starts at 0). The intro is a *separate
  prepend of known length L*, never baked into the transcript timings. So:
  - **Remove** = re-export the master alone (or drop the leading L).
  - **Swap** = concat a different intro (L′) onto the same master.
  - **Transcript edit** = re-render the master at offset 0, then re-apply the
    currently-selected intro. Edits never have to know the intro exists; the
    stored L is what translates master-time ↔ published-time (e.g. for any UI
    timeline or chapter markers on the published video).
- **The real engineering cost — normalize-then-concat:** an intro recorded on a
  phone almost never matches the dub's resolution / fps / codec / audio sample
  rate, so a raw concat glitches. The intro (and/or both) must be re-encoded to
  a common target before concatenation (a `pipeline/video.py` helper alongside
  `mux`). The intro keeps its own audio; the dub's audio resumes after it (the
  intro is **not** itself dubbed).
- **Decided behavior:**
  - **Every publish/republish is a new YouTube video id.** YouTube has no
    replace-media API, and we lean into that rather than fight it: intros (and
    re-dubs) can be swapped in/out at *any* stage, and each republish — whether
    or not it also includes fresh transcript dubbing — mints a brand-new video.
    Workflow incentive that follows: keep a dub unlisted/draft and only go
    **public once the whole package (dub + intro) is right**, since going public
    is a one-shot per id.
  - **Retention: keep every pre-intro master for now — no auto-deletion.**
    Surface a small **"total space used" status line** under the dubbing-service
    control (UI, `website` branch) backed by a backend usage stat, so growth is
    visible. Reclaim space **manually** by deleting masters for videos we know
    we'll never re-dub — no retention policy/TTL needed yet.
  - **UI + endpoints (`website` branch drives new backend here):** per-completed
    dub controls to set / clear / change the intro; an intro library (paste an
    unlisted link, name it); and a master-library view showing per-item size +
    delete. New backend endpoints, e.g. `POST /dub/{id}/intro`,
    `DELETE /dub/{id}/intro`, a library usage/stat endpoint for the space line,
    and a delete-master endpoint.

## Confirmed behavior (reference, not a task)

- A best-shot branded thumbnail is **auto-generated and attached to every dub**
  even when the "Preview thumbnail" step is skipped
  (`runner._brand_thumbnail` → `uploader.set_thumbnail`), gated by
  `DUBBER_THUMBNAIL_ENABLED` (default **on**) and
  `DUBBER_THUMBNAIL_TRANSLATE_TEXT` (default **on**). Custom thumbnails require a
  phone-verified channel; otherwise YouTube keeps its auto-thumbnail and the dub
  still publishes.
