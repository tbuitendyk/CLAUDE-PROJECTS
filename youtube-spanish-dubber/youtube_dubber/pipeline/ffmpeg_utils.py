"""Small wrappers around the `ffmpeg`/`ffprobe` CLIs (free, open-source, the
de-facto standard for audio/video manipulation, installed via apt on Debian).

All intermediate narration audio is normalized to a single PCM format
(mono, 24kHz, 16-bit) so it can be losslessly joined with ffmpeg's `concat`
demuxer without complex filter graphs.
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)

SAMPLE_RATE = 24000
CHANNELS = 1


def _run(cmd: list[str]) -> None:
    log.debug("Running: %s", " ".join(cmd))
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed ({' '.join(cmd)}):\n{result.stderr[-4000:]}")


def probe_duration(path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def probe_video_params(path: Path) -> tuple[int, int, float]:
    """(width, height, fps) of a video's first video stream; (0, 0, 0.0) on
    failure. fps is parsed from ffprobe's r_frame_rate (e.g. "30000/1001")."""
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    lines = [ln.strip() for ln in result.stdout.splitlines() if ln.strip()]
    if len(lines) < 3:
        return 0, 0, 0.0
    try:
        width, height = int(lines[0]), int(lines[1])
        num, _, den = lines[2].partition("/")
        fps = float(num) / float(den) if den and float(den) else float(num)
    except (ValueError, ZeroDivisionError):
        return 0, 0, 0.0
    return width, height, fps


def _probe_audio_params(path: Path) -> tuple[int, int]:
    """(sample_rate, channels) of a video's first audio stream; (48000, 2) on
    failure."""
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=sample_rate,channels",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    lines = [ln.strip() for ln in result.stdout.splitlines() if ln.strip()]
    try:
        return int(lines[0]), int(lines[1])
    except (ValueError, IndexError):
        return 48000, 2


def probe_video_codec(path: Path) -> str:
    """The codec name of a video's first video stream (e.g. "h264", "vp9",
    "av1"); "" on failure."""
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=codec_name",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return result.stdout.strip()


_ENCODERS_CACHE: "set[str] | None" = None


def _available_encoders() -> "set[str]":
    """The encoder names this ffmpeg build provides (parsed from `-encoders`),
    cached for the process."""
    global _ENCODERS_CACHE
    if _ENCODERS_CACHE is None:
        try:
            out = subprocess.run(
                ["ffmpeg", "-hide_banner", "-encoders"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            ).stdout
        except Exception:  # noqa: BLE001
            out = ""
        _ENCODERS_CACHE = {token for token in out.split() if token}
    return _ENCODERS_CACHE


def _intro_encoder_for(codec: str) -> "tuple[str, list[str]]":
    """Pick an encoder (and fast, visually-clean settings) to re-encode the SHORT
    intro to match the master's video codec -- a concatenated track can't switch
    codecs mid-stream, so the intro must be the master's codec. Raises a clear
    error for a codec this ffmpeg can't encode, rather than producing a bad file."""
    table = {
        "h264": (["libx264"], ["-preset", "veryfast", "-crf", "20"]),
        "hevc": (["libx265"], ["-preset", "veryfast", "-crf", "23"]),
        "vp9":  (["libvpx-vp9"], ["-b:v", "0", "-crf", "32", "-deadline", "good", "-cpu-used", "5", "-row-mt", "1"]),
        "vp8":  (["libvpx"], ["-b:v", "1M", "-deadline", "good", "-cpu-used", "5"]),
        "av1":  (["libsvtav1", "libaom-av1"], []),
    }
    if codec not in table:
        raise RuntimeError(f"Can't add an intro to a '{codec or 'unknown'}'-encoded video (unsupported codec).")
    encoders, extra = table[codec]
    available = _available_encoders()
    for encoder in encoders:
        if encoder in available:
            if encoder == "libsvtav1":
                extra = ["-preset", "8", "-crf", "34"]
            elif encoder == "libaom-av1":
                extra = ["-cpu-used", "6", "-crf", "34", "-b:v", "0"]
            return encoder, extra
    raise RuntimeError(
        f"This server's ffmpeg has no encoder for '{codec}' video (need one of {encoders}); "
        "can't add an intro to it."
    )


def prepend_intro(intro_path: Path, master_path: Path, dst: Path) -> Path:
    """Concatenate `intro_path` in front of `master_path` into `dst` WITHOUT
    re-encoding the (potentially long) master.

    A recorded intro almost never matches the dub's resolution / fps / codec, and
    a concatenated track can't switch codecs mid-stream, so we re-encode only the
    *short* intro to conform to the master -- the master's video codec (the master
    is the already-published dub file, so its codec is whatever the source was:
    H.264, VP9, AV1 ...), geometry, frame rate and audio format. Then both parts
    are wrapped to Matroska by stream copy and joined with the concat *demuxer*
    (which re-bases the second segment's timestamps), remuxing to MP4 -- still
    copy, so the master is never re-encoded.

    Why this shape:
    - The concat *filter* re-encodes the whole master -> hours on a small VPS.
    - The MP4 concat *demuxer* (or the concat: protocol) copy leaves non-monotonic
      timestamps -> a file YouTube rejects as "could not be processed".
    - MPEG-TS framing only carries H.264/H.265, not VP9/AV1 -> fails on those.
    Matroska + the concat demuxer is codec-agnostic and yields a clean,
    monotonic-timestamp file (verified by a full-decode pass in the tests).
    YouTube re-transcodes on upload, smoothing the single seam."""
    width, height, fps = probe_video_params(master_path)
    if width <= 0 or height <= 0:
        raise RuntimeError(f"Couldn't read video dimensions from {master_path}")
    fps = fps if fps > 0 else 30.0
    sample_rate, channels = _probe_audio_params(master_path)
    encoder, encoder_args = _intro_encoder_for(probe_video_codec(master_path))

    work = dst.parent
    conformed = work / "intro_conformed.mkv"
    master_mkv = work / "master_seg.mkv"

    # 1) Conform ONLY the short intro to the master (its codec, geometry, fps and
    #    audio format; scaled to fit, letter/pillar-boxed on black, square pixels).
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps:.4f},format=yuv420p"
    )
    _run([
        "ffmpeg", "-y", "-i", str(intro_path),
        "-vf", vf,
        "-c:v", encoder, *encoder_args, "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", str(sample_rate), "-ac", str(channels), "-b:a", "160k",
        str(conformed),
    ])

    # 2) Wrap the master to Matroska by stream copy (no re-encode).
    _run(["ffmpeg", "-y", "-i", str(master_path), "-c", "copy", str(master_mkv)])

    # 3) Concat demuxer (re-bases timestamps) -> MP4, still copy.
    def _q(p: Path) -> str:
        return str(p.resolve()).replace("'", "'\\''")

    list_file = work / "intro_concat.txt"
    list_file.write_text(f"file '{_q(conformed)}'\nfile '{_q(master_mkv)}'\n", encoding="utf-8")
    try:
        _run([
            "ffmpeg", "-y", "-fflags", "+genpts",
            "-f", "concat", "-safe", "0", "-i", str(list_file),
            "-c", "copy", "-avoid_negative_ts", "make_zero",
            "-movflags", "+faststart", str(dst),
        ])
    finally:
        for tmp in (conformed, master_mkv, list_file):
            tmp.unlink(missing_ok=True)
    return dst


def audio_window_plan(total_seconds: float, window_seconds: float) -> list[tuple[float, float]]:
    """Split a [0, total) timeline into consecutive (start, duration) windows of
    at most `window_seconds`, the last covering the remainder.

    Returns a single full-length window when windowing is disabled
    (`window_seconds` <= 0) or unnecessary (audio already shorter than a window),
    and an empty list for non-positive `total_seconds`. Used to feed Whisper one
    time-window at a time so the whole audio is never decoded into RAM at once.
    """
    if total_seconds <= 0:
        return []
    if window_seconds <= 0 or total_seconds <= window_seconds:
        return [(0.0, total_seconds)]
    plan: list[tuple[float, float]] = []
    start = 0.0
    while start < total_seconds - 1e-6:
        plan.append((start, min(window_seconds, total_seconds - start)))
        start += window_seconds
    return plan


def extract_audio_window(src: Path, dst: Path, start: float, duration: float) -> None:
    """Write [start, start+duration) of `src` to `dst` as a standalone WAV in the
    standard mono/24kHz/16-bit PCM format. `-ss`/`-t` before `-i` keeps the seek
    fast and (for PCM) sample-accurate, so windows tile the audio with no gaps."""
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{start:.3f}", "-t", f"{duration:.3f}",
        "-i", str(src),
        "-ar", str(SAMPLE_RATE), "-ac", str(CHANNELS),
        "-c:a", "pcm_s16le", str(dst),
    ]
    _run(cmd)


def to_standard_wav(src: Path, dst: Path, atempo: float | None = None) -> None:
    """Re-encode `src` to the standard mono/24kHz/16-bit PCM format, optionally
    applying a tempo (speed) change. ffmpeg's `atempo` only supports 0.5-2.0
    per instance, which comfortably covers our clamped speaking-rate range."""
    filters = []
    if atempo is not None and abs(atempo - 1.0) > 1e-3:
        filters.append(f"atempo={atempo:.4f}")
    filter_arg = ",".join(filters) if filters else "anull"
    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-filter:a", filter_arg,
        "-ar", str(SAMPLE_RATE), "-ac", str(CHANNELS),
        "-c:a", "pcm_s16le", str(dst),
    ]
    _run(cmd)


def generate_silence(dst: Path, duration: float) -> None:
    duration = max(duration, 0.02)
    cmd = [
        "ffmpeg", "-y", "-f", "lavfi",
        "-i", f"anullsrc=r={SAMPLE_RATE}:cl=mono",
        "-t", f"{duration:.3f}",
        "-c:a", "pcm_s16le", str(dst),
    ]
    _run(cmd)


def concat_wavs(paths: list[Path], dst: Path) -> None:
    if len(paths) == 1:
        to_standard_wav(paths[0], dst)
        return
    list_file = dst.with_suffix(".concat.txt")
    with list_file.open("w", encoding="utf-8") as fh:
        for path in paths:
            escaped = str(path.resolve()).replace("'", "'\\''")
            fh.write(f"file '{escaped}'\n")
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
        "-c:a", "pcm_s16le", str(dst),
    ]
    _run(cmd)
    list_file.unlink(missing_ok=True)


def encode_bed_cache(src: Path, dst: Path) -> Path:
    """Compress a freshly separated music/SFX bed (PCM WAV, ~635 MB/hour) into
    the project's permanent cache. Opus at 192k stereo is perceptually
    transparent for a bed mixed at reduced volume under narration, ~10x smaller
    -- and it's encoded exactly ONCE per project, so there's no cumulative
    generation loss across redubs. Falls back to AAC if libopus is missing."""
    try:
        _run([
            "ffmpeg", "-y", "-i", str(src),
            "-c:a", "libopus", "-b:a", "192k", str(dst),
        ])
        return dst
    except RuntimeError:
        fallback = dst.with_suffix(".m4a")
        _run([
            "ffmpeg", "-y", "-i", str(src),
            "-c:a", "aac", "-b:a", "256k", str(fallback),
        ])
        return fallback


def mux_replace_audio(video_path: Path, audio_path: Path, dst: Path) -> None:
    """Output = original video stream + new narration as the sole audio track."""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path), "-i", str(audio_path),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-shortest", str(dst),
    ]
    _run(cmd)


def duck_filter_complex(bed_volume: float) -> str:
    """ffmpeg filter graph: keep the original audio as a bed under the narration.

    Both streams are first normalised to a common format. The original is held
    at `bed_volume` and *sidechain-compressed by the narration* -- so it dips
    automatically while the narration speaks and rises back to `bed_volume`
    during the pauses the anchored timeline preserves -- then mixed with the
    narration (kept at full level), with a limiter to stop the sum clipping."""
    return (
        "[0:a]aresample=48000,aformat=channel_layouts=stereo,"
        f"volume={bed_volume:.3f}[bed];"
        "[1:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[dub][sc];"
        "[bed][sc]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=350:makeup=1[ducked];"
        # amix's 'normalize' option only exists in ffmpeg >= 4.4; Debian 11 ships
        # 4.3 and errors on it. So let amix apply its default 1/n scaling (which
        # halves both inputs) and undo it with volume=2 -- identical to
        # normalize=0 while the streams overlap -- then limit the sum vs clipping.
        "[ducked][dub]amix=inputs=2:duration=longest:dropout_transition=0,"
        "volume=2.0,alimiter=limit=0.98[aout]"
    )


def mux_duck_audio(video_path: Path, audio_path: Path, dst: Path, original_volume: float) -> None:
    """Output = the original audio kept as a music/ambience bed under the new
    narration, ducked under speech and swelling back in the pauses."""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path), "-i", str(audio_path),
        "-filter_complex", duck_filter_complex(original_volume),
        "-map", "0:v:0", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-shortest", str(dst),
    ]
    _run(cmd)


def mux_music_bed(video_path: Path, narration_path: Path, bed_path: Path, dst: Path, bed_volume: float) -> None:
    """Output = the speech-removed instrumental (`bed_path`: music + SFX, no
    original voice) under the new narration, mixed at a fixed level -- no
    sidechain ducking, since the competing speech is already gone. The bed sits
    at `bed_volume`; amix halves both inputs (1/n) so we restore with volume=2
    (ffmpeg-4.3-safe -- no 'normalize' option), then limit the sum vs clipping."""
    filter_complex = (
        f"[2:a]aresample=48000,aformat=channel_layouts=stereo,volume={bed_volume:.3f}[bed];"
        "[1:a]aresample=48000,aformat=channel_layouts=stereo[dub];"
        "[bed][dub]amix=inputs=2:duration=longest:dropout_transition=0,"
        "volume=2.0,alimiter=limit=0.98[aout]"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path), "-i", str(narration_path), "-i", str(bed_path),
        "-filter_complex", filter_complex,
        "-map", "0:v:0", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-shortest", str(dst),
    ]
    _run(cmd)
