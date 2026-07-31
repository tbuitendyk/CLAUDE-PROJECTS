# Post-run audit — bracketlab-20260731-0657-l14-seed3 + the combined seed check

Written 2026-07-31 under research-loop step 7. Covers seed 3 (170/170,
0 failures, 10.4 min) and the combined R1-R4 read over seeds 1-3
(classifier-seedcheck-read.sh), reads declared in the launchers before
either seed fired.

## 1. What was this run supposed to answer?
Do L14's findings survive a different random placement of the scattered
evaluation blocks, or were they one draw's luck?

## 2. Does the output answer THAT question, or a neighbouring easier one?
That question, decisively: two of the four declared reads FAILED, which is
an answer. R1 held (overlap with the chronological board 1/10, 1/10, 0/10
across seeds — the era-luck finding is placement-robust). R2 failed: the
aggregate flipped from -$5.3k/-$5.9k to +$13.0k under seed 3. R3 failed:
ATOM daily-1d went rank 1 -> 38 -> 146 (+$462 -> +$79 -> -$141) while its
prediction edge stayed positive every time (+7.0/+3.9/+2.7pt). R4: seeds
agree 2/10, 4/10, 0/10.

## 3. What does the metric COUNT that it should not?
The 170-setup aggregate counts one coin's era luck up to EIGHT times: seed
3's board is eight DOGE re-cuts, and DOGE placement alone swings the total
by ~$18k (QC 47 concentration, now shown to flip signs).

## 4. What does the metric OMIT that it should include?
Placement variance. Any single-seed money figure now needs its cross-seed
spread beside it or it overstates its own meaning.

## 5. Are the two compared arms the same population?
Across seeds, yes by construction (same setups, same counts invariant).
The chronological comparator is unchanged by the seed.

## 6. Is any part of the reported number achievable with NO skill?
Yes — demonstrated: seed 3's +$13k aggregate needs no skill, only
fortunate window placement over one wild coin's history.

## 7. Would this number look the same on pure noise?
Placement noise alone flips it; label-scramble noise wasn't needed to make
the point. Scrambles still owed to any candidate that ever reaches freeze.

## 8. What did I assume and not verify?
That "aggregate negative" (L14) was a market fact. It was a placement
fact. RETRACTED in the record by this audit.

## 9. Is the previously planned next step STILL correct?
The L15 consult stands but its question changes: not "which board row to
freeze" — no single-seed board may select — but which credential selects:
multi-seed money, member durability (H1), or waiting for H1a's decay
curves. H1's standing rises: the member layer is the only measured
stratum stable across windows AND seeds.

## 10. New QC-REGISTER entries
- 57 (single-seed scattered-window results are placement-dominated).
