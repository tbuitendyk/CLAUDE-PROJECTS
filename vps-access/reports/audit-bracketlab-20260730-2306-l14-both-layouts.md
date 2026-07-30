# Post-run audit — bracketlab-20260730-2306-l14-both-layouts (L14)

Written 2026-07-31 under research-loop step 7, against the reading rule
committed in scripts/classifier-cycle14-both-layouts.sh before the run.

## 1. What was this run supposed to answer?
Rebuild the 170-setup search on the corrected instrument (6 distinct
committee members, QC 49) under BOTH window layouts in one job, and answer:
do the two geometries crown the same setups, or were recent-window boards
ranking era placement? Declared reads: paired per-setup holdout money per
trade, survivor overlap, interlaced arm = the L15 selection board. No
candidate retired here.

## 2. Does the output answer THAT question, or a neighbouring easier one?
That question, directly. 340/340 units, 0 failures, 21.6 min (estimate was
~25). Every pair carries identical search and holdout period counts
(the invariant held on all 170 pairs); band shared (common-train) on
340/340 rows; 340/340 model dumps on disk. The answer itself: the arms
DISAGREE hard. Chronological aggregate +$2,965 (92/170 setups positive);
interlaced −$5,355 (77/170). Survivor overlap 1/10. Recent-window boards
were substantially ranking eras, not setups.

## 3. What does the metric COUNT that it should not?
The vs-buy-hold control, under interlacing, counts market moves during the
TRAINING gaps between evaluation blocks — periods the strategy was never
allowed to trade. DOGE daily-3d shows vsHold -$8,287 purely because
buy-hold rode the 2021 mania across the gaps. Under any scattered layout
only vs-always-long (a sum of per-period holds) is a valid drift control.
QC 54, and the reader now prints vsLong beside vsHold.

## 4. What does the metric OMIT that it should include?
Training-set size per arm. The interlaced arm pays purge at ~12 seams
(up to 335 chunks) vs the chronological arm's 2 (min 2), so the comparison
conflates era-mixing with a ~10-17% training-data difference. Not fixable
by reading; a future one-knob run can equalize train sizes. QC 55.

## 5. Are the two compared arms the same population?
Same setups, same period counts (forced), same band (shared), same seed —
but different calendar windows BY DESIGN (that is the experiment) and
different train sizes (the flaw in #4). Also 29/170 interlaced rows are
argmax/directional twins landing on the identical winning cell and money,
so the effective population is ~155, and top-10 overlap statistics carry
mild double-counting.

## 6. Is any part of the reported number achievable with NO skill?
Most of it. Of the top 15 interlaced money rows, only 5 beat their own
always-long control; the ETH block (6 rows, +$294..$422) sits $685-741
BELOW always-long — diluted drift capture at quorum 1 with the 'always'
gate. Prediction edge on top money rows is ~0. Money at the top of this
board is mostly the era's tide, not the committee.

## 7. Would this number look the same on pure noise?
Not measured in this run (0 scrambles, declared in the launcher: nulls run
on SELECTED survivors at the L15 consult, per-setup + selection-aware,
now arm-aware after the audit fixes). Nothing here is claimed significant.

## 8. What did I assume and not verify?
- That my first reader was sufficient — it omitted the drift controls, and
  the board read completely differently once they were printed. Caught in
  step 7b, before the email went out.
- The buy-hold control validity under layouts (#3) — assumed, wrong, now
  recorded.

## 9. Is the previously planned next step STILL correct?
Yes: the L15 freeze consult (owner's hard stop) with THIS board, filtered
by controls. Provisional shortlist for that conversation: ATOMUSDT
daily-1d argmax — the only row that beats both controls, carries real
prediction edge (+7.0pt), and is the single setup in both arms' top-10s.
The BCH family beats always-long with NEGATIVE edge (execution effect, not
prediction — interesting, suspicious, needs its nulls). Everything else at
the top fails its controls.

## 10. New QC-REGISTER entries
- 54 (buy-hold control invalid under scattered windows)
- 55 (arm comparison conflates era-mixing with train-size; equalization is
  an open one-knob run)
