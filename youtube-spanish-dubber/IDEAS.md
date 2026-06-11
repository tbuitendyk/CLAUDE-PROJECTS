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

### 2. Background music under preserved pauses
- Now that real pauses survive as silence (anchored timeline), the source
  music/ambience could keep playing under the narration instead of going dead.
- Likely an `audio_mode` / mux change: mix the source audio bed under the
  Spanish narration rather than fully replacing it.

## Confirmed behavior (reference, not a task)

- A best-shot branded thumbnail is **auto-generated and attached to every dub**
  even when the "Preview thumbnail" step is skipped
  (`runner._brand_thumbnail` → `uploader.set_thumbnail`), gated by
  `DUBBER_THUMBNAIL_ENABLED` (default **on**) and
  `DUBBER_THUMBNAIL_TRANSLATE_TEXT` (default **on**). Custom thumbnails require a
  phone-verified channel; otherwise YouTube keeps its auto-thumbnail and the dub
  still publishes.
