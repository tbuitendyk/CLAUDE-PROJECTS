"""Return freed heap back to the OS.

Dropping a Python object (a cached ML model, a decoded audio array) lowers the
*heap in use*, but CPython/glibc keep the freed arenas mapped -- and the many
native threads CTranslate2 / onnxruntime spawn multiply the arena count -- so
the process's RSS (which is what the cgroup's MemoryHigh throttle and MemoryMax
ceiling actually measure) can stay high long after the objects are gone.
malloc_trim forces glibc to hand the arenas back, so the resident set really
falls and the host's other VMs get the RAM.

Call this right after releasing something big -- a heavy model whose pipeline
stage just finished, or the end of a job.
"""
from __future__ import annotations

import ctypes
import gc


def release_to_os() -> None:
    """Collect garbage, then ask glibc to return freed arenas to the OS."""
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:  # noqa: BLE001 -- non-glibc / unavailable: best effort
        pass
