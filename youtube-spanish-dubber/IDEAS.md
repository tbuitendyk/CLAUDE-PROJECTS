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
- **Intro clips library** — record short intros (unlisted YouTube links), fetch
  + cache them with their exact measured length, and attach/swap/remove one on a
  completed dub without re-dubbing (`intros` table, `pipeline.ffmpeg_utils
  .prepend_intro`, `POST/DELETE /projects/{id}/intro`). Every (re)publish mints a
  new video id (YouTube has no replace-media API). See item 2 for the remaining
  UI work.
- **Decouple dub from publish (+ unified intro publish).** A dub no longer has to
  publish: `runner.run(publish=False)` builds and returns the master without
  uploading, and a new `remaster` job mode caches it as the library entry's
  pre-intro master without minting a video — the **Dub / Redub** ("prepare only")
  half of the new control model. Publishing is one shared path
  (`worker._publish_master`, factored out of the old intro-republish): **Dub &
  publish** / **Redub & publish** build the master then prepend the chosen intro
  (carried on the job as `intro_id`, pre-filled to the entry's current intro so a
  republish retains it) and upload in a single job, while **Publish current cut**
  (the existing intro-republish) uploads the saved master as-is. Endpoints:
  `POST /jobs` (`mode=remaster`, `intro_id`), `POST /projects/{id}/redub`
  (`publish`, `intro_id`).
- **Persistent "pending dub" (green) state.** Edited-but-not-yet-dubbed
  transcript lines are greened against a baseline that now lives server-side: a
  `dubbed_rows` column snapshots the transcript each master was dubbed from
  (written on every finished dub/remaster), so the colouring survives closing and
  re-opening a project across the library. Exposed as `pending_dub` (project
  summary) and `dubbed_rows` (full payload); when no baseline is recorded yet it
  falls back to the publish state so nothing is falsely flagged. `pending_dub`
  (edits vs master) and `published_pending` (master vs live video) are now
  independent, which the decouple makes meaningful.

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

### 2. 🎛️ Unified dub/publish control model — UI (`website` branch)
The backend for this landed (see "Recently shipped": decouple + persistent
green); this item is the remaining **website-branch** UI that drives it. The
intro media/concat/persistence stack and the master/intro endpoints are all
done — what's left is presenting the control model consistently.
- **One control model, identical wording in both places** — the top "new job"
  section and each library entry share an **intro** selector (`No intro` / saved
  intros, pre-filled to the entry's current intro) and a **Publish as**
  Unlisted/Public choice, with buttons:
  - New-job section: **Dub** (`POST /jobs mode=remaster` — prepare master, no
    publish) and **Dub & publish** (`mode=dub` + `intro_id` — dub → intro →
    publish in one).
  - Library entry: **Redub** (`/redub publish=false`), **Redub & publish**
    (`/redub publish=true` + `intro_id`, defaulting the selector to the current
    intro so it's retained), and **Publish current cut** (the existing
    `POST/DELETE /projects/{id}/intro` — publish the saved master as-is with the
    chosen intro, no re-dub). Privacy lives only on the publishing buttons.
  - Naming mirrors across sections (**Dub ↔ Redub**, **Dub & publish ↔ Redub &
    publish**); the library adds **Publish current cut** because it has a master.
- **Render persistent green from the new fields.** Drop the session-only diff and
  green each transcript row whose narration differs from its `dubbed_rows`
  baseline (both in `GET /projects/{id}`); show the list-level dot from
  `pending_dub` in the summary. Treat the two flags as independent: `pending_dub`
  = edits not yet dubbed (green); `published_pending` = master not yet published.
- **Still to surface:** a master-library view with per-item size + delete and the
  **"total space used"** status line (backend `GET /library/usage` already
  exists) so kept-master growth is visible; reclaim space manually (no TTL yet).

## Confirmed behavior (reference, not a task)

- A best-shot branded thumbnail is **auto-generated and attached to every dub**
  even when the "Preview thumbnail" step is skipped
  (`runner._brand_thumbnail` → `uploader.set_thumbnail`), gated by
  `DUBBER_THUMBNAIL_ENABLED` (default **on**) and
  `DUBBER_THUMBNAIL_TRANSLATE_TEXT` (default **on**). Custom thumbnails require a
  phone-verified channel; otherwise YouTube keeps its auto-thumbnail and the dub
  still publishes.
