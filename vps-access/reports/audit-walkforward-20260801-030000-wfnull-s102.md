# Post-run audit — job walkforward-20260801-030000-wfnull-s102

Engine 1.30.0. 136/136 setups scored, 0 failures. The second luck draw;
declared read in scripts/classifier-wfnull-launch-s102.sh.

---

## 1. What was this run supposed to answer?

The declared two-seed question: is the real board's R1+R2 count (7) more
than TWICE the larger of the two luck draws' counts [factor GUESSED,
declared before the run]?

## 2. Does the output answer THAT question, or a neighbouring easier one?

That question. Seed 102 luck counts: R1 18, R1+R2 5, S1 64 (seed 101:
15, 5, 57). Larger R1+R2 luck count = 5, bar = 11, real = 7. VERDICT AS
DECLARED: these counting rules cannot separate the real board from luck.

## 3. What does the metric COUNT that it should not?

As the s101 audit found (QC 64): S1 counts the machinery's stand-aside
option as skill (57 and 64 informationless passes across the two seeds —
stable, so the s101 figure was no fluke). Counts also discard magnitude
entirely, which is the specific blindness the next instrument removes.

## 4. What does the metric OMIT that it should include?

Magnitudes and pairing. Both arms score IDENTICAL folds, so the sharp
comparison is per-setup, per-fold: real money minus luck money on the
same slice of the same coin's history. Declared as the next read (9).

## 5. Are the two compared arms the same population?

Yes (same 136 setups, same folds); additionally the two LUCK draws agree
with each other closely (5 vs 5 on the headline count; 15 vs 18; 57 vs
64), which is what interchangeable draws should look like.

## 6. Is any part of the reported number achievable with NO skill?

5 of the real 7, on both draws.

## 7. Would this number look the same on pure noise?

Answered twice now, consistently. The spread question NR3 raised is
closed for the COUNT statistic: two draws differ by at most 3 counts.

## 8. What did I assume and not verify?

Worker-scheduling determinism (open since the WF1 audit) — still open,
still queued with the paired-instrument work. Nothing new assumed here.

## 9. Is the previously planned next step STILL correct?

Yes, exactly as declared in the s102 launcher: NO third seed. The
inserted step is the PAIRED read — rules PR1-PR5 committed in
scripts/classifier-wfpaired-read.sh BEFORE its first run, computing
per-setup fold-paired real-minus-luck from the three existing runs'
fold files (no new compute; the discipline is that the rules commit
precedes the output). Selection stays closed until the paired board
clears ITS luck reference (the two luck draws paired against each
other), and even then replication rules apply before any candidate talk.

## 10. New QC-REGISTER entries

None: both declared rules fired exactly as written, and the S1/vs-long
lesson was already registered as QC 64 in the s101 audit.
