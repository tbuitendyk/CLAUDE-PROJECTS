# YouTube Spanish Dubber

A self-hosted service that takes a YouTube video URL, produces a Spanish
voice-over of it, and publishes the result to your own YouTube channel —
built entirely from free / open-source tools (no paid APIs, no per-minute
billing).

> This is a self-contained sub-project of the `claude-projects` repo — every
> path below is relative to this directory (`youtube-spanish-dubber/`).

## How it works

```
POST /jobs {"url": "https://youtube.com/watch?v=..."}
        │
        ▼
 1. Download the video                         (yt-dlp)
 2. Get a Spanish transcript, cheapest first:
       a. existing manual Spanish captions      (yt-dlp)
       b. existing auto-generated Spanish ones  (yt-dlp)
       c. any other-language captions,
          machine-translated to Spanish         (yt-dlp + Argos Translate)
       d. nothing exists -> transcribe audio    (faster-whisper)
          from scratch, then translate          (Argos Translate)
 2b. Rechunk into natural "thought units":       (spaCy + rechunker.py)
       restore punctuation if missing, then cut
       at sentence/clause boundaries (not mid-
       sentence pauses), sized for clean TTS
 3. Synthesize Spanish speech per caption line, (edge-tts)
    time-stretched to match each line's slot    (ffmpeg atempo)
 4. Mux the new narration onto the video        (ffmpeg)
 5. Upload the result to your channel           (YouTube Data API v3)
```

Everything runs as a single FastAPI service backed by a tiny SQLite job
queue: you `POST` a URL, a background worker processes one job at a time
(transcoding/TTS are CPU-heavy — sequential is friendlier to a small VPS),
and you poll `GET /jobs/{id}` for status and the final video link.

## The free tools used (and why)

| Stage | Tool | License | Notes |
|---|---|---|---|
| Download / captions | [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Unlicense | Active fork of youtube-dl |
| Translation | [Argos Translate](https://github.com/argosopentech/argos-translate) | MIT | Fully offline, no rate limits |
| Speech-to-text fallback | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT | Runs locally on CPU |
| Sentence/clause chunking | [spaCy](https://spacy.io/) | MIT | CPU-only, no torch; small en/es models |
| Text-to-speech | [edge-tts](https://github.com/rany2/edge-tts) | GPL-3.0 | Free Microsoft neural voices, no API key |
| Audio/video processing | [ffmpeg](https://ffmpeg.org/) | LGPL/GPL | Industry standard |
| Publishing | [YouTube Data API v3](https://developers.google.com/youtube/v3) | Free quota | 10,000 units/day; an upload costs 1,600 (~6/day free) |
| Web service | [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/) | MIT | |

No component requires a credit card. The only "registration" needed is a
free Google Cloud project to obtain YouTube upload credentials (see below).

## Installation (Debian/Ubuntu VPS)

```bash
git clone <this-repo-url>
cd claude-projects/youtube-spanish-dubber
sudo bash deploy/install.sh
```

The installer:
1. Installs `ffmpeg` and Python build tools via `apt`.
2. Creates an unprivileged system user `dubber` and `/opt/youtube-dubber`.
3. Copies the project there and creates a Python virtualenv with all
   dependencies.
4. Pre-downloads a base set of Argos Translate language packages (so
   transcripts in English/French/Portuguese/German/Italian — the most common
   non-Spanish caption languages — can be machine-translated to Spanish
   offline, with English available as a pivot for any other pair).
5. Installs (but does not yet enable) the `youtube-dubber` systemd unit.

After it finishes, three manual steps remain — **do these before starting
the service**:

### 1. Get a free YouTube Data API v3 OAuth client

1. Go to the [Google Cloud Console](https://console.cloud.google.com/),
   create a project (free).
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen** → configure it (External,
   Testing mode is fine for personal use — add your own Google account as a
   test user).
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   → Application type **Desktop app**.
5. Download the resulting JSON and place it at:
   `/opt/youtube-dubber/secrets/client_secret.json`

This is entirely free; it just identifies *your* app to Google so it can ask
*your* permission to upload to *your* channel.

### 2. Run the one-time interactive authorization

This step opens a browser-based Google consent screen once, then caches a
refresh token so the service can upload unattended forever after (Google's
client library refreshes the access token automatically).

Because your VPS likely has no browser, forward a local port over SSH first:

```bash
ssh -L 8080:localhost:8080 you@your-vps
```

Then, on the VPS, run the authorization as the service user:

```bash
cd /opt/youtube-dubber && sudo -u dubber ./.venv/bin/python -m youtube_dubber.cli authorize
```

It prints a URL — open it in the browser on your local machine (the SSH
tunnel routes the OAuth redirect back to the VPS), sign in with the Google
account that owns your channel, and approve. You should see:

```
Saved credentials to /opt/youtube-dubber/secrets/token.json. The service can now upload unattended.
```

### 3. Review configuration

Edit `/opt/youtube-dubber/.env` (created from `deploy/env.example`). The
defaults are sensible, but you'll likely want to check:

- `DUBBER_TTS_VOICE` — which Spanish voice to use. List all free options with:
  `sudo -u dubber /opt/youtube-dubber/.venv/bin/edge-tts --list-voices | grep -i "^Name: es-"`
  Common choices: `es-ES-AlvaroNeural`, `es-ES-ElviraNeural`,
  `es-MX-JorgeNeural`, `es-MX-DaliaNeural`.
- `DUBBER_UPLOAD_PRIVACY` — **start with `private` or `unlisted`** until
  you've reviewed a few outputs, then switch to `public`.
- `DUBBER_AUDIO_MODE` — `replace` (clean dub, default) or `duck` (keeps the
  original audio faintly underneath, telenovela-style).
- `DUBBER_WHISPER_MODEL` — only matters for videos with *no* captions at
  all. `small` is a good speed/accuracy balance on a CPU-only VPS; bump to
  `medium`/`large-v3` if you have the RAM and don't mind it being slower.

## Running it

```bash
sudo systemctl enable --now youtube-dubber
sudo systemctl status youtube-dubber
journalctl -u youtube-dubber -f          # live logs
```

By default it listens on `127.0.0.1:8088` (not exposed to the internet —
edit `DUBBER_HOST`/`DUBBER_PORT` in `.env` and the systemd unit if you want
to reach it remotely, ideally behind a reverse proxy with auth, since it has
no authentication of its own).

## Using it

Submit a video:

```bash
curl -X POST http://127.0.0.1:8088/jobs \
     -H 'Content-Type: application/json' \
     -d '{"url": "https://www.youtube.com/watch?v=XXXXXXXXXXX"}'
```

```json
{"id": "a1b2c3d4e5f6", "source_url": "...", "status": "queued", ...}
```

Check progress:

```bash
curl http://127.0.0.1:8088/jobs/a1b2c3d4e5f6
```

```json
{
  "id": "a1b2c3d4e5f6",
  "status": "running",
  "stage": "synthesizing",
  "progress": "Synthesizing Spanish narration with voice 'es-ES-AlvaroNeural'...",
  "youtube_video_url": null,
  ...
}
```

When it's done, `status` becomes `done` and `youtube_video_url` points at
your freshly published dub (`failed` + an `error` field if something went
wrong — check `journalctl -u youtube-dubber` for the full traceback).

List recent jobs: `curl http://127.0.0.1:8088/jobs`

The optional CLI wraps the same API for convenience:

```bash
cd /opt/youtube-dubber && sudo -u dubber ./.venv/bin/python -m youtube_dubber.cli submit "https://youtu.be/XXXXXXXXXXX"
sudo -u dubber ./.venv/bin/python -m youtube_dubber.cli status a1b2c3d4e5f6
```

## Notes, limits & tuning

- **YouTube upload quota**: the Data API v3 free tier grants 10,000
  units/day; each upload costs 1,600, so roughly **6 dubs per day** without
  requesting a quota increase (also free, via a Cloud Console form, if you
  need more).
- **Timing alignment**: narration for each caption line is time-stretched
  (via ffmpeg's `atempo`, clamped to 0.75×–1.6×) to fit that line's original
  time slot, then placed at its original timestamp with silence filling the
  gaps. This keeps the dub roughly synced to on-screen action without
  sounding chipmunked — but it is not frame-perfect lip sync (no free tool
  does that well).
- **Copyright**: you are responsible for ensuring you have the right to
  re-dub and republish the source video. This tool is meant for your own
  content or content you have explicit permission to localize.
- **Disk usage**: by default, each job's working directory (source video,
  intermediate audio clips, final mux) is deleted after the job finishes.
  Set `DUBBER_KEEP_WORK_DIRS=true` in `.env` to keep them for debugging
  (under `/opt/youtube-dubber/data/jobs/<job_id>/`).
- **Re-authorizing**: if you ever need to re-run the OAuth flow (e.g. you
  revoked access), just delete `secrets/token.json` and re-run
  `python -m youtube_dubber.cli authorize`.

## Updating

```bash
cd /path/to/cloned/repo/youtube-spanish-dubber && git pull
sudo bash deploy/install.sh        # re-syncs code & deps, won't touch .env/secrets/data
sudo systemctl restart youtube-dubber
```

## Project layout

```
youtube_dubber/
  app.py            FastAPI HTTP service (POST /jobs, GET /jobs, GET /jobs/{id})
  worker.py         Background loop that claims and runs queued jobs
  db.py             SQLite-backed job queue/status store
  config.py         All settings (env-var driven, sensible defaults)
  cli.py            Operator CLI (OAuth authorization, submit/status helpers)
  pipeline/
    runner.py       Orchestrates the stages below for one job
    downloader.py   yt-dlp: fetch video, audio, captions
    transcript.py   Decides which transcript source to use (see flow above)
    speech_to_text.py  faster-whisper fallback transcription (+ word timings)
    rechunker.py    Punctuation restore + spaCy sentence/clause rechunking
    translator.py   Argos Translate wrapper
    tts.py          edge-tts synthesis + time-alignment to captions
    ffmpeg_utils.py Low-level ffmpeg/ffprobe helpers
    video.py        Final audio/video muxing
    uploader.py     YouTube Data API v3 OAuth + resumable upload
deploy/
  install.sh        Debian/Ubuntu installer
  youtube-dubber.service   systemd unit
  env.example       Template for .env
```
