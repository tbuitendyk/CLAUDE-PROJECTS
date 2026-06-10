"""Tests for merging over-segmented text detections (ocr_onnx._merge_line_regions).

Detectors split one stylized title into several overlapping boxes; these check
that same-line pieces are stitched back into one region (with the duplicated
boundary characters de-duplicated) so it's translated and drawn once. Pure
geometry/string logic -- no OCR model needed.
"""
from __future__ import annotations

import pytest

from youtube_dubber.pipeline import ocr_onnx
from youtube_dubber.pipeline.models import TextRegion


def _r(text, x0, y0, x1, y1, conf=0.9):
    return TextRegion(polygon=[(x0, y0), (x1, y0), (x1, y1), (x0, y1)], text=text, confidence=conf)


def test_merges_overlapping_split_title_and_dedupes_overlap():
    # The reported case: "Salvation by Faith Alone?" split into two overlapping
    # boxes, the second recognised with a duplicated leading "n".
    regions = [
        _r("Salvation", 40, 60, 400, 150),
        _r("n by Faith Alone?", 380, 60, 900, 150),
    ]
    merged = ocr_onnx._merge_line_regions(regions)
    assert len(merged) == 1
    assert merged[0].text == "Salvation by Faith Alone?"
    assert merged[0].bbox == (40, 60, 900, 150)  # union of the two boxes


def test_adjacent_boxes_join_with_a_space():
    # Same line, a small gap (not overlapping) -> joined with a space.
    regions = [_r("Big", 10, 10, 100, 60), _r("Sale", 120, 12, 250, 62)]
    merged = ocr_onnx._merge_line_regions(regions)
    assert len(merged) == 1
    assert merged[0].text == "Big Sale"


def test_separate_lines_are_not_merged():
    regions = [_r("Hello", 10, 10, 200, 60), _r("World", 10, 90, 200, 140)]
    merged = ocr_onnx._merge_line_regions(regions)
    assert len(merged) == 2
    assert {r.text for r in merged} == {"Hello", "World"}


def test_far_apart_same_line_boxes_stay_separate():
    # Same line but a wide gap (> ~0.6 line-heights) -> distinct text elements.
    regions = [_r("Left", 10, 10, 90, 60), _r("Right", 800, 10, 900, 60)]
    merged = ocr_onnx._merge_line_regions(regions)
    assert len(merged) == 2


def test_single_region_passes_through():
    regions = [_r("Solo", 0, 0, 50, 20)]
    assert ocr_onnx._merge_line_regions(regions) is regions


def test_shared_affix_len():
    assert ocr_onnx._shared_affix_len("Salvation", "n by Faith Alone?") == 1
    assert ocr_onnx._shared_affix_len("fooBAR", "barbaz") == 3
    assert ocr_onnx._shared_affix_len("abc", "xyz") == 0


def test_detect_text_regions_applies_merge(monkeypatch):
    Image = pytest.importorskip("PIL.Image")
    pytest.importorskip("numpy")

    class _FakeEngine:
        def __call__(self, _bgr):
            return ([
                [[[40, 60], [400, 60], [400, 150], [40, 150]], "Salvation", 0.95],
                [[[380, 60], [900, 60], [900, 150], [380, 150]], "n by Faith Alone?", 0.92],
            ], 0.0)

    monkeypatch.setattr(ocr_onnx, "_get_engine", lambda: _FakeEngine())
    regions = ocr_onnx.detect_text_regions(Image.new("RGB", (960, 200), (255, 255, 255)))
    assert len(regions) == 1
    assert regions[0].text == "Salvation by Faith Alone?"
