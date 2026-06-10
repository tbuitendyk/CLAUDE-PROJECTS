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
    return _merge_line_regions(regions)


def _merge_line_regions(regions: list[TextRegion]) -> list[TextRegion]:
    """Merge detections that sit on the same text line and overlap (or nearly
    touch) horizontally into a single region spanning their union.

    Detectors routinely split one stylized title -- "Salvation by Faith Alone?"
    -- into several boxes. Translating and re-rendering each piece on its own
    gives mismatched font sizes, text that collides where the boxes overlap, and
    poor translations of the half-phrases (Argos mangles "n by Faith Alone?").
    Merging same-line pieces first means one coherent line is translated and
    drawn once, in one box, at one size."""
    if len(regions) < 2:
        return regions

    boxes = [r.bbox for r in regions]

    # Union-find: group every pair that reads as the same line.
    parent = list(range(len(regions)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(regions)):
        for j in range(i + 1, len(regions)):
            if _same_line_adjacent(boxes[i], boxes[j]):
                parent[find(i)] = find(j)

    groups: dict[int, list[int]] = {}
    for i in range(len(regions)):
        groups.setdefault(find(i), []).append(i)

    merged: list[TextRegion] = []
    for members in groups.values():
        if len(members) == 1:
            merged.append(regions[members[0]])
            continue
        members.sort(key=lambda i: boxes[i][0])  # reading order, left to right
        x0 = min(boxes[i][0] for i in members)
        y0 = min(boxes[i][1] for i in members)
        x1 = max(boxes[i][2] for i in members)
        y1 = max(boxes[i][3] for i in members)
        merged.append(
            TextRegion(
                polygon=[(float(x0), float(y0)), (float(x1), float(y0)),
                         (float(x1), float(y1)), (float(x0), float(y1))],
                text=_join_line_texts([regions[i].text for i in members],
                                      [boxes[i] for i in members]),
                confidence=min(regions[i].confidence for i in members),
            )
        )

    # Stable human reading order: top to bottom, then left to right.
    merged.sort(key=lambda r: (r.bbox[1], r.bbox[0]))
    return merged


def _same_line_adjacent(a: tuple, b: tuple) -> bool:
    """Do boxes `a` and `b` belong to the same run of title text -- i.e. they
    sit on the same line (vertical overlap) and overlap or nearly touch
    horizontally (gap under ~0.6 line-heights)?"""
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    vertical_overlap = min(ay1, by1) - max(ay0, by0)
    if vertical_overlap <= 0:
        return False
    shorter = min(ay1 - ay0, by1 - by0) or 1
    if vertical_overlap / shorter < 0.5:
        return False
    avg_height = (((ay1 - ay0) + (by1 - by0)) / 2) or 1
    gap = max(bx0 - ax1, ax0 - bx1)  # >0 is a horizontal gap; <=0 is overlap
    return gap <= 0.6 * avg_height


def _join_line_texts(texts: list[str], boxes: list[tuple]) -> str:
    """Join same-line fragments left to right. Where two boxes physically
    overlap, the recogniser usually duplicated the shared boundary characters
    ("Salvation" + "n by Faith Alone?"), so de-duplicate that overlap to
    reconstruct the original ("Salvation by Faith Alone?"); otherwise join with
    a space."""
    result = texts[0].strip()
    for index in range(1, len(texts)):
        nxt = texts[index].strip()
        if not nxt:
            continue
        if not result:
            result = nxt
            continue
        overlaps = boxes[index][0] < boxes[index - 1][2]  # starts before the previous box ends
        if overlaps:
            result += nxt[_shared_affix_len(result, nxt):]
        else:
            result += " " + nxt
    return result


def _shared_affix_len(left: str, right: str, max_k: int = 12) -> int:
    """Length of the largest suffix of `left` that equals a prefix of `right`
    (case-insensitive), capped at `max_k` -- the over-segmentation overlap to
    drop when stitching two fragments. 0 if there's no shared run."""
    left_l, right_l = left.lower(), right.lower()
    for k in range(min(len(left_l), len(right_l), max_k), 0, -1):
        if left_l[-k:] == right_l[:k]:
            return k
    return 0
