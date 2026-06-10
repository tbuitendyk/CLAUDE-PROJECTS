"""Grammar-based punctuation + truecasing + sentence segmentation, on CPU,
torch-free.

A run-on, unpunctuated transcript (auto-generated captions, or a fast speaker
Whisper didn't punctuate) is what limits chunk quality: with no sentence marks
the rechunker can only guess from pauses, which a low-pause speaker doesn't
give. A transformer that reads the *words* fixes this -- but the published
wrappers (`punctuators`, `deepmultilingualpunctuation`) pull in PyTorch and,
by default, multi-GB CUDA wheels: a bad trade for a CPU-only VPS.

The model itself is a plain ONNX graph, though, and the wrappers only use torch
for trivial batching/tensor-wrapping. So this module runs the same model on
`onnxruntime` + numpy directly -- the tokenisation, windowing and label-decoding
logic here is a faithful, torch-free port of the `punctuators` package
(Apache-2.0, github.com/1-800-BAD-CODE/punctuators). No torch, no CUDA.

It is intentionally *optional and defensive*: if onnxruntime / sentencepiece /
the model download aren't available, or anything raises, the caller falls back
to the pause-and-opener heuristic -- so this can only improve results, never
break the pipeline.
"""
from __future__ import annotations

import logging
import threading
from typing import Optional

log = logging.getLogger(__name__)

# Default model: the English-only "punct_cap_seg" model -- smaller than the
# multilingual XLM-RoBERTa one and well matched to English source transcripts.
# Overridable via config for other languages / higher-quality models.
_DEFAULT_REPO = "1-800-BAD-CODE/punct_cap_seg_en"
_DEFAULT_SPE = "spe_32k_lc_en.model"
_DEFAULT_ONNX = "punct_cap_seg_en.onnx"
_CONFIG_FILE = "config.yaml"

_ACRONYM_TOKEN = "<ACRONYM>"

_lock = threading.Lock()
_model: Optional["_OnnxPunctuator"] = None
_load_failed = False


class _OnnxPunctuator:
    """Loads the ONNX model + sentencepiece tokenizer and restores punctuation,
    casing and sentence boundaries -- the torch-free equivalent of
    punctuators.models.PunctCapSegModelONNX."""

    def __init__(self, repo_id: str, spe_filename: str, onnx_filename: str):
        import onnxruntime as ort
        import yaml
        from huggingface_hub import hf_hub_download
        from sentencepiece import SentencePieceProcessor

        spe_path = hf_hub_download(repo_id=repo_id, filename=spe_filename)
        onnx_path = hf_hub_download(repo_id=repo_id, filename=onnx_filename)
        config_path = hf_hub_download(repo_id=repo_id, filename=_CONFIG_FILE)

        self._sp = SentencePieceProcessor(spe_path)  # noqa
        # CPU only -- never request CUDA on a CPU VPS (avoids a noisy provider
        # warning and any accidental GPU dependency).
        self._session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
        with open(config_path, "r", encoding="utf-8") as fh:
            cfg = yaml.safe_load(fh)
        self._max_len = int(cfg["max_length"])
        self._pre_labels = list(cfg["pre_labels"])
        self._post_labels = list(cfg["post_labels"])
        self._null = cfg.get("null_token", "<NULL>")

    # -- tokenisation + windowing (port of TextInferenceDataset) --
    def _windows(self, text: str, overlap: int):
        ids = self._sp.EncodeAsIds(text)
        max_len = self._max_len - 2  # room for BOS/EOS
        out = []
        start = 0
        idx = 0
        while start < len(ids):
            adj = start - (0 if idx == 0 else overlap)
            stop = adj + max_len
            out.append(ids[adj:stop])
            start = stop
            idx += 1
        return out or [[]]

    def restore(self, text: str, overlap: int = 16) -> list[str]:
        """Return `text` as a list of punctuated, truecased sentences."""
        import numpy as np

        bos, eos = self._sp.bos_id(), self._sp.eos_id()
        seg_ids_all: list[int] = []
        seg_pre_all: list[Optional[str]] = []
        seg_post_all: list[Optional[str]] = []
        seg_cap_all: list[list] = []
        seg_sbd_all: list[int] = []

        windows = self._windows(text, overlap)
        n = len(windows)
        for w_idx, win in enumerate(windows):
            input_ids = np.array([[bos] + win + [eos]], dtype=np.int64)
            pre, post, cap, seg = self._session.run(None, {"input_ids": input_ids})
            length = input_ids.shape[1]
            # strip BOS/EOS
            ids = input_ids[0, 1:length - 1].tolist()
            pre_t = [self._pre_labels[i] for i in pre[0, 1:length - 1].tolist()]
            post_t = [self._post_labels[i] for i in post[0, 1:length - 1].tolist()]
            pre_t = [None if x == self._null else x for x in pre_t]
            post_t = [None if x == self._null else x for x in post_t]
            cap_t = cap[0, 1:length - 1].tolist()
            sbd_t = seg[0, 1:length - 1].tolist()

            # Drop the overlap region halves so windows stitch cleanly (port of
            # PunctCapSegResultCollector.produce's overlap trimming).
            start = overlap // 2 if w_idx > 0 else 0
            stop = len(ids) - (overlap // 2 if w_idx < n - 1 else 0)
            seg_ids_all.extend(ids[start:stop])
            seg_pre_all.extend(pre_t[start:stop])
            seg_post_all.extend(post_t[start:stop])
            seg_cap_all.extend(cap_t[start:stop])
            seg_sbd_all.extend(sbd_t[start:stop])

        return self._decode(seg_ids_all, seg_pre_all, seg_post_all, seg_cap_all, seg_sbd_all)

    # -- detokenise + apply predictions (port of PunctCapSegResultCollector) --
    def _decode(self, ids, pre_preds, post_preds, cap_preds, sbd_preds) -> list[str]:
        pieces = [self._sp.IdToPiece(x) for x in ids]
        outputs: list[str] = []
        cur: list[str] = []
        for ti, token in enumerate(pieces):
            if token.startswith("▁") and cur:  # "▁" = sentencepiece word start
                cur.append(" ")
            char_start = 1 if token.startswith("▁") else 0
            for ci, ch in enumerate(token[char_start:], start=char_start):
                if ci == char_start and pre_preds[ti] is not None:
                    cur.append(pre_preds[ti])
                if ci < len(cap_preds[ti]) and cap_preds[ti][ci]:
                    ch = ch.upper()
                cur.append(ch)
                label = post_preds[ti]
                if label == _ACRONYM_TOKEN:
                    cur.append(".")
                elif ci == len(token) - 1 and post_preds[ti] is not None:
                    cur.append(post_preds[ti])
                if ci == len(token) - 1 and sbd_preds[ti]:
                    outputs.append("".join(cur))
                    cur = []
        if cur:
            outputs.append("".join(cur))
        return outputs


def _get_model(repo_id: str, spe: str, onnx: str) -> Optional["_OnnxPunctuator"]:
    global _model, _load_failed
    if _model is not None or _load_failed:
        return _model
    with _lock:
        if _model is None and not _load_failed:
            try:
                log.info("Loading ONNX punctuation model '%s' (one-time)...", repo_id)
                _model = _OnnxPunctuator(repo_id, spe, onnx)
                log.info("ONNX punctuation model ready.")
            except Exception as exc:  # missing deps, download failure, bad config...
                log.warning("ONNX punctuation model unavailable (%s); using heuristic restoration.", exc)
                _load_failed = True
    return _model


def release_model() -> None:
    """Drop the cached ONNX punctuation session + tokenizer when the worker
    goes idle so they don't stay resident between jobs. A previously failed
    load is left flagged (nothing to free, and no point retrying every idle
    cycle); a successful one reloads lazily on the next use."""
    global _model
    with _lock:
        _model = None


def restore_sentences(text: str) -> Optional[list[str]]:
    """Restore punctuation/casing and split `text` into sentences, or return
    None if the model is disabled/unavailable or inference fails (the caller
    then falls back to the heuristic). Model selection comes from config:
    DUBBER_PUNCTUATION_MODEL_ENABLED / _REPO / _SPE / _ONNX."""
    try:
        from ..config import settings
        enabled = settings.punctuation_model_enabled
        repo_id = settings.punctuation_model_repo
        spe = settings.punctuation_model_spe
        onnx = settings.punctuation_model_onnx
    except Exception:  # config import shouldn't fail, but never let it break callers
        enabled, repo_id, spe, onnx = True, _DEFAULT_REPO, _DEFAULT_SPE, _DEFAULT_ONNX
    if not enabled:
        return None
    model = _get_model(repo_id, spe, onnx)
    if model is None:
        return None
    try:
        return model.restore(text)
    except Exception as exc:  # pragma: no cover - defensive
        log.warning("ONNX punctuation inference failed (%s); using heuristic restoration.", exc)
        return None
