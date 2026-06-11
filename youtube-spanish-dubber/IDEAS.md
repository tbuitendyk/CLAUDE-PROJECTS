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

## Queue

### 1. TTS base-rate tuning (in progress)
- Test sync at the current `-5%` (set in `/opt/youtube-dubber/.env`), then decide
  whether to move toward `0%` / `+3%`.
- Preferred end state — single source of truth: comment out `DUBBER_TTS_RATE` in
  `.env` so the code default (`config.tts_rate`) governs, then set that default
  to the agreed value and commit. (Deploys preserve `.env` — `install.sh` rsyncs
  with `--exclude .env`; both systemd `EnvironmentFile=` and `load_dotenv()`
  honor `#` comments, so the var falls back to the code default.)

### 2. Background music under preserved pauses
- Now that real pauses survive as silence (anchored timeline), the source
  music/ambience could keep playing under the narration instead of going dead.
- Likely an `audio_mode` / mux change: mix the source audio bed under the
  Spanish narration rather than fully replacing it.

### 3. "Re-thumbnail an existing video" control box
- Standalone tool to push a translated thumbnail onto an **already-published**
  video on the connected channel — independent of dubbing.
- **UI (website branch):** third control box, between the top controls and the
  SERVICE box — "Target video URL (Connected YouTube channel)" + "Update
  thumbnail". Source image comes from the existing "English source video URL"
  field; reuse the current preview / edit-the-text widget.
- **Backend (this branch):** most of it already exists — generation + edit loop
  is `POST /thumbnail/preview` and `POST /thumbnail/render`; pushing an image is
  `uploader.set_thumbnail`. New piece is one thin endpoint, e.g.
  `POST /thumbnail/apply {target_url, thumbnail}` → parse the video ID →
  `set_thumbnail`.
- **Constraints to design for:** the target video must be owned by the connected
  channel and the channel phone-verified — surface a clear "not your video / not
  verified" error rather than failing silently. `thumbnails.set` accepts the
  `youtube.upload` scope we already hold, so likely **no re-consent** needed
  (confirm when building).

### 4. ⚠️ Big Fix — PENDING CAPTURE
- Discussed earlier in conversation; **details not yet recorded.** Awaiting a
  one-line reminder to capture it accurately, then this slot gets filled in.

## Confirmed behavior (reference, not a task)

- A best-shot branded thumbnail is **auto-generated and attached to every dub**
  even when the "Preview thumbnail" step is skipped
  (`runner._brand_thumbnail` → `uploader.set_thumbnail`), gated by
  `DUBBER_THUMBNAIL_ENABLED` (default **on**) and
  `DUBBER_THUMBNAIL_TRANSLATE_TEXT` (default **on**). Custom thumbnails require a
  phone-verified channel; otherwise YouTube keeps its auto-thumbnail and the dub
  still publishes.
