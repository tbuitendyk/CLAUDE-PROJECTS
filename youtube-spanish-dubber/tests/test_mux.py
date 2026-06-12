"""Tests for the background-music duck mix (ffmpeg_utils.duck_filter_complex).

The graph is the logic; the ffmpeg invocation around it is a thin wrapper, so we
assert the graph wires the original audio as a ducked bed under the narration."""
from __future__ import annotations

from youtube_dubber.pipeline.ffmpeg_utils import duck_filter_complex


def test_duck_filter_ducks_the_original_under_the_narration():
    graph = duck_filter_complex(0.4)
    # Original (0:a) -> a bed at the requested volume.
    assert "[0:a]" in graph and "volume=0.400[bed]" in graph
    # Narration (1:a) is split: one copy drives the sidechain, one is the mix.
    assert "[1:a]" in graph and "asplit=2[dub][sc]" in graph
    # The bed is sidechain-compressed by the narration (dips under speech, rises
    # back in the pauses), then mixed with the full narration and limited so the
    # summed signal can't clip.
    assert "[bed][sc]sidechaincompress=" in graph and "[ducked]" in graph
    # amix mixes the two; we avoid the 'normalize' option (ffmpeg >= 4.4 only --
    # Debian 11 has 4.3) and undo amix's default 1/n halving with volume=2.
    assert "[ducked][dub]amix=" in graph and "normalize" not in graph
    assert "volume=2.0" in graph
    assert "alimiter=" in graph and graph.rstrip().endswith("[aout]")


def test_duck_filter_threads_the_bed_volume():
    assert "volume=0.125[bed]" in duck_filter_complex(0.125)
