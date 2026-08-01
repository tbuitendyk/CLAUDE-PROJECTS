# Post-run audit — job walkforward-20260731-215808-wfnull-s101

Engine 1.30.0 (planted check PASS including null criteria N1-N4, same
day). 136/136 setups scored, 0 failures. Reading rules NR1-NR4 committed
in scripts/classifier-wfnull-launch.sh before launch.

---

## 1. What was this run supposed to answer?

As declared: the board-level LUCK COUNTS — how many of 136 setups pass
R1, R1+R2 and S1 when every member's votes are rotated inside each fold
(seed 101) so they carry no market information, with the committee's
internal agreement preserved. The comparison target: WF1's real counts.

## 2. Does the output answer THAT question, or a neighbouring easier one?

That question, exactly, by construction: identical universe, shapes,
decisions, fee, floor and fold machinery; both arms recomputed from fold
detail files by one piece of arithmetic (classifier-wfnull-read.sh).
Counts (real vs null): R1 22 vs 15; R1+R2 7 vs 5; S1 63 vs 57.

## 3. What does the metric COUNT that it should not?

The S1 rule counts "beats always-going-long" as skill — and the null arm
proves that is mostly NOT skill: 57 of 136 informationless setups pass
S1. Mechanism: the picker chooses, per fold, the best cell on the test
window, and cells that trade rarely or stand aside beat always-long in
any falling era regardless of what the votes know. "Beats the drift
control" is substantially a property of the MACHINERY (adaptive cell
choice + the option to sit out), not of vote information. The S1 top-10
makes it visible: UNI setups (0 of 8 pass R1; raw medians negative)
dominate the S1 ranking purely by not-being-long a falling coin.

## 4. What does the metric OMIT that it should include?

Magnitudes. Counts were the declared statistic (NR1) and remain the
verdict basis, but the null's PASSING setups' sizes were not declared
for comparison — e.g. real DOT daily-4d sk-med +$85/fold vs whatever the
null's best is. A paired per-setup real-vs-null comparison (same setup,
same folds, real votes vs rotated votes) is the sharper instrument; it
was not declared for this read and is therefore design input for the
next one, not a number to quote now.

## 5. Are the two compared arms the same population?

Yes, by construction and verified: same 136 setups, same folds, same
grids; only the votes' dates differ. Both recomputed identically.

## 6. Is any part of the reported number achievable with NO skill?

That is what this run measures. Answer: most of it. 15/22 of R1's count,
5/7 of R1+R2's, 57/63 of S1's are achievable on rotated votes.

## 7. Would this number look the same on pure noise?

This IS the noise measurement. What is NOT yet known: the SPREAD of the
luck counts across seeds — one seed is one draw (NR3, QC 57). Seed 102
fires immediately after this audit is committed.

## 8. What did I assume and not verify?

- Worker-scheduling determinism on the 8-thread pool (carried from the
  WF1 audit): still open; closes with a single-unit rerun byte-compare,
  queued with the instrument work in 9.
- That two seeds are enough to characterize the luck-count spread: NOT
  assumed resolved — the declared rule for the s102 read (in its
  launcher) states the decision consequence either way.

## 9. Is the previously planned next step STILL correct?

The planned step (second seed, NR3) proceeds — fired right after this
commit, with its own declared read: real R1+R2 must exceed TWICE the
larger null count across both seeds [GUESSED factor, stated before the
run] to be called distinguishable; otherwise the verdict is "these rules
cannot separate the real board from luck" and the work shifts to the
sharper instrument (paired per-setup real-vs-null), not to more seeds.
INSERTED ahead of any selection work, per 3: S1 is retired as a support
rule (it measures the machinery, not the votes); the null arm replaces
always-long as the reference for any "skill" claim. Nothing is selected;
no drill fires; the calibration-ledger work stays parked.

## 10. New QC-REGISTER entries

QC 64: "always-going-long is an adequate no-skill control for the
walk-forward pick machinery" — false; 42% of informationless setups beat
it. The null arm is the control; vs-long survives only as a descriptive
column. Registered with this audit.
