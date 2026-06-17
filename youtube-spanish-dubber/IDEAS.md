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

### 1. 🔭 Big feature — translate in-video text (presentation overheads: scripture + notes)
- **Goal.** Source videos here are largely *teaching/presentation* content:
  full-screen overhead **slides** showing scripture passages and speaker notes
  that stay in the source language in the dub. Detect that on-screen text,
  translate it, and render it back into the video in the target language, so a
  Spanish viewer reads the slides in Spanish. Today only the *thumbnail's* baked
  text is localized (`pipeline/thumbnail.py` + `image_text.py` + ONNX OCR).
- **Scope it to slides first.** General moving frame text (lower-thirds, motion
  callouts) is a harder, later extension. Presentation slides are the tractable,
  high-value 80%: a slide is static for seconds and is usually high-contrast text
  on a plain background.
- **Why slides are tractable — don't OCR every frame.** Detect slide *changes*
  and OCR one representative frame per slide, then hold the translated overlay
  for that slide's whole span. No per-frame tracking / flicker.
- **Pipeline (reuses the thumbnail localization stack):**
  1. *Segment by slide.* Sample frames at ~1–2 fps; detect transitions
     (frame-difference / scene-cut, e.g. ffmpeg `select=gt(scene,…)` or SSIM);
     group into `[start,end]` segments; pick a sharp representative frame each;
     skip segments with little/no text (talking-head shots).
  2. *Detect + OCR* the representative frame — reuse `ocr_onnx` + `image_text`
     grouping (already proven on thumbnails).
  3. *Classify* each region: scripture reference / scripture body / other.
  4. *Translate or substitute* (below).
  5. *Re-render in place* — reuse `image_text` paint-out + re-render to build one
     translated overlay image per slide, fitted to the slide's text box.
  6. *Composite* each overlay over its time span and mux.
- **The scripture win (domain-specific, the standout).** Scripture should NOT be
  machine-translated — substitute the *canonical* target-language text:
  - Detect a reference on the slide (regex `Book chap:verse[-range]`, multi-book
    names + abbreviations). References are short and OCR-reliable → a strong anchor.
  - If only verse text shows (no visible reference), fuzzy-match it against a
    full-text Bible index to recover the reference (works even when the slide uses
    NIV/ESV wording — same verse).
  - Fetch the official target-language passage (e.g. Spanish **Valera**) and render
    *that* + the translated reference. Accurate Scripture, not garbled MT.
  - Dev convenience: the `kjv-bible` MCP in this workspace (`kjv_lookup` /
    `vp_lookup`, KJV ↔ Valera Purificada) is exactly the matcher/source to
    prototype with. **Production needs the texts bundled offline** (the service's
    network is GitHub-only). KJV is public domain; **check licensing** before
    bundling a specific Spanish edition (Reina-Valera 1909 is public domain;
    confirm Valera Purificada terms).
  - Other text (titles, notes) → existing Argos MT + `_apply_term_fixups`.
- **Big architectural cost — this forces a video re-encode.** The dub currently
  *copies* the video stream (`-c:v copy`, instant). Burning overlays means
  re-encoding the whole video — exactly the cost the intro feature hit on a 4K/AV1
  master. So: opt-in per dub; reuse the intro work's lessons (output H.264,
  resolution-cap to bound time, be codec-aware); expect this to be the slow, heavy
  mode.
  - *Cheaper alternative to record:* emit the slide translations as a separate
    soft **subtitle/caption track** (or a synced sidecar) instead of burning them
    in — no re-encode, much cheaper, though it doesn't replace the slide text
    visually. Possible Phase 0.
- **Review/correct UI (`website` branch), like the thumbnail editor.** OCR +
  translation + scripture-matching can all err, so a per-slide review card (each
  detected slide, its regions, the proposed target text, scripture matches flagged
  for confirm) lets the operator fix before committing. High value given the
  accuracy stakes (Scripture especially).
- **Phasing.**
  - P0 (optional, cheap): slide-text → soft subtitle track, no re-encode.
  - P1: slide-detect + OCR + MT overlay (notes/titles), re-encode — prove the pipeline.
  - P2: scripture reference/body detection + canonical target-Bible substitution.
  - P3: per-slide review/correct UI.
- **Open questions to scope:** slide-change thresholds + sample rate; OCR
  accuracy / false-positives on non-slide frames; re-encode cost / resolution cap
  / codec (tie to the intro lessons); offline Bible data + licensing; text-fit for
  longer/shorter target verses; interaction with the anchored audio timeline
  (independent, video-side) and the intro overlay/concat step.

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
