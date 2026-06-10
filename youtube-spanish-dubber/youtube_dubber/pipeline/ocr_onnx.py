"""Scene-text detection + recognition on CPU, torch-free.

This is the first half of in-image text localisation: find the runs of text
baked into a picture (a thumbnail's title, a sign, a lower-third) and read them.
The second half -- translating, painting out the original and re-rendering the
Spanish -- lives in `image_text.py`; the two meet at `models.TextRegion`.

Why this stack: the project is deliberately CPU-only and torch-free (see
`punctuation_onnx.py` for the same stance). The mainstream Python OCR packages
(EasyOCR, PaddleOCR, docTR) all drag in PyTorch/Paddle and, by default,
multi-GB CUDA wheels -- the wrong trade for a small VPS. RapidOCR runs the same
PP-OCR detection + recognition models as plain ONNX graphs on `onnxruntime`
(Apache-2.0, models bundled in the wheel, fully offline), which is exactly the
runtime we already use. The detector emits polygons and the recognizer emits
text + a confidence, so the output maps straight onto `TextRegion` -- the shape
a future in-video pass is meant to reuse by tracking these across frames.

Like the punctuation model, this is *optional and defensive*: if RapidOCR /
opencv / numpy aren't installed, or anything raises, callers get an empty list
and simply keep the image's original text. It can only add localisation, never
break the dub.
"""
from __future__ import annotations

import logging
import threading
from typing import Optional

from .models import TextRegion

log = logging.getLogger(__name__)

_lock = threading.Lock()
_engine: Optional[object] = None
_load_failed = False


def _create_engine() -> Optional[object]:
    """Build the RapidOCR engine (detection + angle-classification + recognition),
    pinned to onnxruntime's CPU provider. Returns None if the stack is missing."""
    from rapidocr_onnxruntime import RapidOCR  # type: ignore

    # RapidOCR reads CPU/GPU choice from its bundled config; the default is the
    # CPU provider, which is what we want on a CPU VPS. Constructing it warms the
    # ONNX sessions (a one-time cost) so the first thumbnail isn't slow.
    return RapidOCR()


def _get_engine() -> Optional[object]:
    global _engine, _load_failed
    if _engine is not None or _load_failed:
        return _engine
    with _lock:
        if _engine is None and not _load_failed:
            try:
                log.info("Loading ONNX OCR model (one-time)...")
                _engine = _create_engine()
                log.info("ONNX OCR model ready.")
            except Exception as exc:  # missing deps, bundled-model load failure...
                log.warning("ONNX OCR model unavailable (%s); thumbnail text will not be localised.", exc)
                _load_failed = True
    return _engine


def release_model() -> None:
    """Drop the cached OCR engine (its ONNX sessions + thread pools) so it does
    not stay resident between uses. The thumbnail stage runs early and once per
    job, so the pipeline releases this right after branding rather than holding
    it through transcription; the worker also calls it when the queue drains.
    A previously failed load stays flagged -- nothing to free, no point retrying
    every idle cycle; a successful one reloads lazily on next use."""
    global _engine
    with _lock:
        _engine = None


def detect_text_regions(image, min_confidence: float = 0.0) -> list[TextRegion]:
    """Detect and recognise text in a PIL image, returning a `TextRegion` per
    run of text whose recognition confidence is at least `min_confidence`.

    Returns an empty list (never raises) if the OCR stack is unavailable or
    inference fails -- the caller then leaves the image's text untouched."""
    engine = _get_engine()
    if engine is None:
        return []
    try:
        import numpy as np

        # RapidOCR takes an OpenCV-style BGR ndarray (or a path); convert from
        # PIL's RGB. `np.ascontiguousarray` because the [::-1] channel flip makes
        # a negative-stride view some onnxruntime builds reject.
        rgb = np.asarray(image.convert("RGB"))
        bgr = np.ascontiguousarray(rgb[:, :, ::-1])
        result, _elapse = engine(bgr)
    except Exception as exc:  # pragma: no cover - defensive
        log.warning("ONNX OCR inference failed (%s); leaving image text as-is.", exc)
        return []

    regions: list[TextRegion] = []
    for item in result or []:
        # RapidOCR yields [box, text, score]; box is 4 [x, y] points. Be lenient
        # about the exact shape so a minor version bump can't crash the dub.
        try:
            box, text, score = item[0], str(item[1]), float(item[2])
            polygon = [(float(x), float(y)) for x, y in box]
        except Exception:  # noqa: BLE001 -- unexpected row shape; skip it
            continue
        if not text.strip() or score < min_confidence:
            continue
        regions.append(TextRegion(polygon=polygon, text=text, confidence=score))
    return regions
