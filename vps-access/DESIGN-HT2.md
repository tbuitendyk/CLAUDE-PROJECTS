# DESIGN — History Tuning v2: the paired age-dial instrument
# (owner-approved 2026-08-04/05: "go ahead with the new design")

## What v1 got wrong (measured, not argued)
- Winner's curse: best-of-35-by-test vs unselected reference; test rank was
  ~uncorrelated with hold performance (rank 1 -> hold rank 11/34; ranks 4-5
  -> 21st and 32nd).
- Retune dial: every cadence negative pooled across ages (never +$58 median;
  r4m2 -$476); mechanism = trade multiplication x fees. RETIRED for singles
  at this trade rate (DERIVED).
- Power: per-window hold delta sd = $134 (measured); 3 windows resolve
  nothing under ~±$230. Effects on the table are ~$50-180. ~20 folds needed.

## The v2 instrument
ONE question per run: does age-weighting the TRAINING data (half-life h)
improve the DECLARED, FROZEN cell's money, out of sample?

- Exactly 2 arms: reference (no discount) vs ONE declared half-life h.
  No menus, no retunes, no picking step anywhere. The traded cell is the
  candidate's frozen cell in both arms.
- ~20 paired walk-forward folds over the pre-reserve calendar (count and
  window length DERIVED from history length and the setup's trade rate;
  floor: every fold must hold >= the derived minimum trades or the fold is
  refused for BOTH arms, never one).
- Per fold: train members twice (weights 0.5^(age/h) vs uniform; class
  weights compose multiplicatively where the decision style uses them),
  trade the frozen cell on the fold window with both arms, record the
  paired delta (arm $ - reference $).

## Reading rules (stamped into every run before compute)
- R1 (DERIVED): the statistic is the SUM of per-fold paired deltas; folds
  positive count is descriptive, never the verdict.
- R2 (DERIVED, always fires): the null is the sign-flip randomization of the
  per-fold deltas (10,000 resamples, seeded from the run id): under "no
  systematic arm effect" each fold's delta sign is exchangeable. p = share
  of resamples with sum >= observed. PASS needs p <= 0.05 AND the
  concentration check below. This null fires on every run, pass or fail.
- R3 (DERIVED, endpoint-computed — QC 78): concentration check printed with
  every verdict: largest single fold's share of the positive sum; a sum
  carried >50% by one fold is labeled CARRIED-BY-ONE-FOLD and cannot pass.
- R4 (DERIVED): the instrument may not touch a real pair until it has
  passed BOTH planted exams on the current engine version (below). The
  launcher refuses, like the planted gate.

## Known-answer exams (QC 56)
- Exam A, must find it: PLANTEDLATEUSDT — fabricated pair, random walk with
  NO rule for the first ~2/3 of history, then the planted day-follows-day
  (70%) rule switches ON for the final ~1/3. A half-life shorter than the
  rule-on era concentrates training on rule-bearing data; the age arm MUST
  pass (p <= 0.05, not carried by one fold).
- Exam B, must refuse it: PLANTEDUSDT — the existing stationary planted
  pair; the rule is uniform over all history, so age-weighting only starves
  the model; the age arm MUST NOT pass.
- Both fabricated pairs are RESERVED: refused by every real launcher, book,
  and data download, generated locally, never fetched.

## Burn notice
The v1 35-arm record (historytuning-20260804-204431) is design/calibration
data — curtain opened on owner's order. No arm may be promoted from it. If
a real half-life run is later fired on LTC, its hypothesis cites this
contaminated origin on the label.
