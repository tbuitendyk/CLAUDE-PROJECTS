"""Remove the source-language *speech* from the original audio, keeping the
music and sound effects -- so the Spanish narration sits over a clean
instrumental bed instead of fighting the original voice (which ducking never
did well).

This is audio source separation with an MDX-Net model run on **onnxruntime +
numpy only** -- deliberately no torch (the box's stack avoids it; the easy
wrapper libraries need Python 3.10+ and torch 2.3, neither of which this Debian
11 / Python 3.9 box has). The model outputs the *instrumental* stem directly, so
there's no vocal-subtraction step. Everything is processed in fixed-size chunks
so memory stays bounded under the service's hard cap.

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
# DIM_F/DIM_T come straight from the model. SAMPLE_RATE is what MDX is trained
# on -- the audio is resampled to it for separation, then the bed is muxed at
# whatever rate the final mix uses.
SAMPLE_RATE = 44100
N_FFT = 6144
HOP = 1024
DIM_F = 3072
DIM_T = 256


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


def _separate(mix, session, on_progress: Optional[Callable[[float], None]]):
    """mix: float32 [2, T] -> instrumental float32 [2, T] (same length)."""
    import numpy as np
    win = _window()
    n_bins = N_FFT // 2 + 1
    trim = N_FFT // 2
    chunk = HOP * (DIM_T - 1)
    gen = chunk - 2 * trim
    total = mix.shape[1]
    pad = gen - (total % gen)
    m = np.concatenate([np.zeros((2, trim)), mix, np.zeros((2, pad + trim))], axis=1)
    result = np.zeros((2, m.shape[1]), dtype=np.float32)
    in_name = session.get_inputs()[0].name
    starts = list(range(0, m.shape[1] - chunk + 1, gen))
    for n, start in enumerate(starts):
        window_chunk = m[:, start:start + chunk]
        spec = np.zeros((1, 4, DIM_F, DIM_T), dtype=np.float32)
        for c in range(2):
            s = _stft_ch(window_chunk[c], win)
            spec[0, 2 * c] = s[:DIM_F].real
            spec[0, 2 * c + 1] = s[:DIM_F].imag
        out = session.run(None, {in_name: spec})[0]
        for c in range(2):
            est = np.zeros((n_bins, DIM_T), dtype=np.complex128)
            est[:DIM_F] = out[0, 2 * c] + 1j * out[0, 2 * c + 1]
            wave = _istft_ch(est, win, chunk)
            result[c, start:start + gen] = wave[trim:trim + gen]
        if on_progress and starts:
            on_progress((n + 1) / len(starts))
    return result[:, trim:trim + total]


# --- ffmpeg I/O (raw float32 PCM, no soundfile/scipy dependency) -------------

def _decode_stereo_f32(src: Path):
    """Decode `src`'s audio to a float32 [2, T] numpy array at SAMPLE_RATE."""
    import numpy as np
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(src), "-ac", "2", "-ar", str(SAMPLE_RATE),
         "-f", "f32le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(f"ffmpeg decode failed: {proc.stderr.decode('utf-8', 'replace')[-500:]}")
    interleaved = np.frombuffer(proc.stdout, dtype=np.float32)
    return interleaved.reshape(-1, 2).T  # [2, T]


def _encode_wav_f32(arr, dst: Path) -> None:
    """Write float32 [2, T] to `dst` as a 16-bit WAV at SAMPLE_RATE."""
    import numpy as np
    interleaved = np.ascontiguousarray(arr.T, dtype=np.float32)
    proc = subprocess.run(
        ["ffmpeg", "-y", "-v", "error",
         "-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "2", "-i", "pipe:0",
         "-c:a", "pcm_s16le", str(dst)],
        input=np.clip(interleaved, -1.0, 1.0).tobytes(),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg encode failed: {proc.stderr.decode('utf-8', 'replace')[-500:]}")


def instrumental_bed(
    source_media: Path, work_dir: Path, on_progress: Optional[Callable[[float], None]] = None
) -> Optional[Path]:
    """Separate `source_media`'s audio and write the music+SFX (no speech) bed to
    `work_dir/instrumental.wav`. Returns its path, or None if separation isn't
    available or fails -- the caller then falls back to another mix mode. Never
    raises into the pipeline."""
    if not available():
        log.info("Speech separation unavailable (no model / onnxruntime); falling back.")
        return None
    try:
        import onnxruntime as ort

        mix = _decode_stereo_f32(source_media)
        # The box is memory-capped. onnxruntime's defaults -- a worker thread and
        # a memory arena per core -- ballooned to 51 threads pinned at the cgroup
        # ceiling, so separation thrashed. Pin to a few threads and drop the CPU
        # arena/mem-pattern so it stays in budget (and, with less thread thrash,
        # runs faster too).
        so = ort.SessionOptions()
        so.intra_op_num_threads = max(1, int(settings.separator_threads))
        so.inter_op_num_threads = 1
        so.enable_cpu_mem_arena = False
        so.enable_mem_pattern = False
        session = ort.InferenceSession(
            str(settings.separator_model_path), sess_options=so, providers=["CPUExecutionProvider"]
        )
        instrumental = _separate(mix, session, on_progress)
        out = work_dir / "instrumental.wav"
        _encode_wav_f32(instrumental, out)
        return out if out.exists() else None
    except Exception as exc:  # noqa: BLE001 -- best effort; caller falls back
        log.warning("Speech separation failed (%s); falling back to another mix mode.", exc)
        return None
