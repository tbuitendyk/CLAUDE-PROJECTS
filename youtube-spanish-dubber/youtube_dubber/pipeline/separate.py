"""Remove the source-language *speech* from the original audio, keeping the
music and sound effects -- so the Spanish narration sits over a clean
instrumental bed instead of fighting the original voice (which ducking never
did well).

This is audio source separation with an MDX-Net model run on **onnxruntime +
numpy only** -- deliberately no torch (the box's stack avoids it; the easy
wrapper libraries need Python 3.10+ and torch 2.3, neither of which this Debian
11 / Python 3.9 box has). The model outputs the *instrumental* stem directly, so
there's no vocal-subtraction step.

Memory is **flat regardless of video length**: the audio is streamed through
ffmpeg (one decode pipe in, one encode pipe out) and processed with an
overlap-save sliding buffer, so only ~one model chunk is ever resident. Because
the MDX model processes each chunk independently, the streamed result is
identical to processing the whole track at once.

Best-effort: if the model file or onnxruntime is missing, or anything fails,
`instrumental_bed` returns None and the caller falls back to another mix mode.
It never raises into the pipeline.
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Callable, Optional

from ..config import settings

log = logging.getLogger(__name__)

# MDX-Net inference constants. The model's I/O is [batch, 4, DIM_F, DIM_T]
# (4 = 2 channels x real/imag). N_FFT/HOP are the MDX standards for this shape;
# DIM_F/DIM_T come straight from the model. SAMPLE_RATE is what MDX is trained on.
SAMPLE_RATE = 44100
N_FFT = 6144
HOP = 1024
DIM_F = 3072
DIM_T = 256

_FRAME_BYTES = 2 * 4  # 2 channels x float32


def available() -> bool:
    """True if separation can run: the model file exists and onnxruntime imports."""
    try:
        import onnxruntime  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return Path(settings.separator_model_path).exists()


# --- DSP (matches torch.stft/istft: center=True, periodic hann, no norm) -----

def _window():
    import numpy as np
    n = np.arange(N_FFT)
    return (0.5 - 0.5 * np.cos(2.0 * np.pi * n / N_FFT)).astype(np.float64)  # periodic hann


def _stft_ch(x, window):
    import numpy as np
    pad = N_FFT // 2
    xp = np.pad(x, (pad, pad), mode="reflect")
    frames = 1 + (len(xp) - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(frames)[:, None]
    fr = xp[idx] * window[None, :]
    return np.fft.rfft(fr, axis=1).T  # [n_bins, frames]


def _istft_ch(spec, window, length):
    import numpy as np
    frames = spec.shape[1]
    acc = np.zeros((frames - 1) * HOP + N_FFT)
    wsum = np.zeros_like(acc)
    fr = np.fft.irfft(spec.T, n=N_FFT, axis=1) * window[None, :]
    w2 = window ** 2
    for i in range(frames):
        s = i * HOP
        acc[s:s + N_FFT] += fr[i]
        wsum[s:s + N_FFT] += w2
    wsum[wsum < 1e-8] = 1e-8
    out = acc / wsum
    pad = N_FFT // 2
    return out[pad:pad + length]


def roundtrip_max_error(samples: int = 120000) -> float:
    """Self-test hook: max abs error of stft->istft on noise (~0 if DSP is right)."""
    import numpy as np
    win = _window()
    x = np.random.default_rng(0).standard_normal(samples)
    rt = _istft_ch(_stft_ch(x, win), win, len(x))
    return float(np.abs(x - rt).max())


def _process_chunk(window_chunk, session, win, in_name):
    """One MDX chunk: a `chunk_size`-sample stereo window -> the centre `gen`
    samples of the instrumental estimate. `window_chunk` is [2, chunk_size]."""
    import numpy as np
    n_bins = N_FFT // 2 + 1
    trim = N_FFT // 2
    chunk = window_chunk.shape[1]
    spec = np.zeros((1, 4, DIM_F, DIM_T), dtype=np.float32)
    for c in range(2):
        s = _stft_ch(window_chunk[c], win)
        spec[0, 2 * c] = s[:DIM_F].real
        spec[0, 2 * c + 1] = s[:DIM_F].imag
    out = session.run(None, {in_name: spec})[0]  # [1,4,DIM_F,DIM_T]
    wave = np.zeros((2, chunk))
    for c in range(2):
        est = np.zeros((n_bins, DIM_T), dtype=np.complex128)
        est[:DIM_F] = out[0, 2 * c] + 1j * out[0, 2 * c + 1]
        wave[c] = _istft_ch(est, win, chunk)
    return wave[:, trim:trim + (chunk - 2 * trim)]  # centre gen samples


def _separate_stream(session, read_block, write_block, on_progress, total_est) -> int:
    """Overlap-save streaming separation. Pulls input via `read_block(n) ->
    [2, m]` (m < n at end-of-stream), pushes instrumental output via
    `write_block([2, k])`. Only ~one chunk is ever held, so memory is flat
    regardless of length. Returns the number of samples written.

    Each MDX chunk covers `gen` output samples plus `trim` of context on each
    side; consecutive chunks overlap by `2*trim`, so after emitting a chunk we
    keep its tail as the next chunk's left context. Stream edges are zero-padded
    (matching the batch version's padding), and the final block is trimmed to the
    real sample count so no padding leaks into the output."""
    import numpy as np
    win = _window()
    trim = N_FFT // 2
    chunk = HOP * (DIM_T - 1)
    gen = chunk - 2 * trim
    in_name = session.get_inputs()[0].name

    buf = np.zeros((2, trim), dtype=np.float32)  # leading left-context (zeros)
    read_total = 0   # real input samples pulled
    produced = 0     # real output samples written
    eof = False
    while True:
        while buf.shape[1] < chunk and not eof:
            blk = read_block(gen)
            if blk.shape[1] == 0:
                eof = True
            else:
                buf = np.concatenate([buf, blk.astype(np.float32)], axis=1)
                read_total += blk.shape[1]
        if produced >= read_total and eof:
            break
        if buf.shape[1] < chunk:  # pad the trailing edge at EOF
            buf = np.concatenate([buf, np.zeros((2, chunk - buf.shape[1]), np.float32)], axis=1)
        centre = _process_chunk(buf[:, :chunk], session, win, in_name)  # [2, gen]
        k = min(gen, read_total - produced)
        if k <= 0:
            break
        write_block(centre[:, :k])
        produced += k
        buf = buf[:, gen:]
        if on_progress and total_est:
            on_progress(min(0.99, produced / total_est))
    return produced


# --- ffmpeg streaming pipes (raw float32 PCM, no soundfile/scipy dependency) --

def _read_exact(stream, nbytes: int) -> bytes:
    chunks = []
    got = 0
    while got < nbytes:
        b = stream.read(nbytes - got)
        if not b:
            break
        chunks.append(b)
        got += len(b)
    return b"".join(chunks)


def _make_session():
    import onnxruntime as ort
    # The box is memory-capped. onnxruntime's defaults -- a worker thread and a
    # memory arena per core -- ballooned to ~50 threads pinned at the cgroup
    # ceiling. Pin to a few threads and drop the CPU arena/mem-pattern so it stays
    # in budget (and, with less thread thrash, runs faster too).
    so = ort.SessionOptions()
    so.intra_op_num_threads = max(1, int(settings.separator_threads))
    so.inter_op_num_threads = 1
    so.enable_cpu_mem_arena = False
    so.enable_mem_pattern = False
    return ort.InferenceSession(
        str(settings.separator_model_path), sess_options=so, providers=["CPUExecutionProvider"]
    )


def instrumental_bed(
    source_media: Path, work_dir: Path, on_progress: Optional[Callable[[float], None]] = None
) -> Optional[Path]:
    """Separate `source_media`'s audio and write the music+SFX (no speech) bed to
    `work_dir/instrumental.wav`. Streams the audio through ffmpeg so memory stays
    flat for any length. Returns its path, or None if separation isn't available,
    produced nothing, or failed -- the caller then falls back to another mix mode.
    Never raises into the pipeline."""
    if not available():
        log.info("Speech separation unavailable (no model / onnxruntime); falling back.")
        return None

    import numpy as np
    from . import ffmpeg_utils

    out = work_dir / "instrumental.wav"
    total_est = max(1, int(ffmpeg_utils.probe_duration(source_media) * SAMPLE_RATE))
    decoder = encoder = None
    try:
        session = _make_session()
        decoder = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-i", str(source_media),
             "-ac", "2", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
        encoder = subprocess.Popen(
            ["ffmpeg", "-y", "-v", "error",
             "-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "2", "-i", "pipe:0",
             "-c:a", "pcm_s16le", str(out)],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )

        def read_block(n):
            data = _read_exact(decoder.stdout, n * _FRAME_BYTES)
            if not data:
                return np.empty((2, 0), dtype=np.float32)
            usable = (len(data) // _FRAME_BYTES) * _FRAME_BYTES
            return np.frombuffer(data[:usable], dtype=np.float32).reshape(-1, 2).T

        def write_block(a):
            encoder.stdin.write(
                np.ascontiguousarray(np.clip(a.T, -1.0, 1.0), dtype=np.float32).tobytes()
            )

        produced = _separate_stream(session, read_block, write_block, on_progress, total_est)
        encoder.stdin.close()
        encoder.wait()
        decoder.stdout.close()
        decoder.wait()
        if produced <= 0:
            return None
        return out if out.exists() else None
    except Exception as exc:  # noqa: BLE001 -- best effort; caller falls back
        log.warning("Speech separation failed (%s); falling back to another mix mode.", exc)
        return None
    finally:
        for proc in (decoder, encoder):
            try:
                if proc is not None and proc.poll() is None:
                    proc.kill()
            except Exception:  # noqa: BLE001
                pass
