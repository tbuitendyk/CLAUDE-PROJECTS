# Post-run audit — job walkforward-20260801-105744-wfnull-s104
# (covers the four-arm derived-threshold read, the verdict this seed
# existed to enable)

Engine 1.30.0. 136/136 setups, 0 failures. Reader committed before the
numbers existed (classifier-wf4arm-read.sh).

---

## 1. What was this run supposed to answer?

The declared four-arm question: does the real board's paired count sit
outside observed luck variation — above max(luck-vs-rest counts) plus
their spread?

## 2. Does the output answer THAT question, or a neighbouring easier one?

That question, decisively. real-vs-4-lucks: 26. luck-vs-rest: 38, 28,
33, 26 (max 38, spread 12, line 50). The real board is not merely below
the line — it sits at the BOTTOM of the luck range. Under this
statistic the real board is indistinguishable from a fifth luck arm.

## 3. What does the metric COUNT that it should not?

The question now runs the other way: what did the EARLIER metric count
that it should not? The two-arm paired read (28 vs floor 19, "+47%")
compared real-vs-mean-of-TWO against luck-vs-ONE — the real arm got a
smoother reference than the luck arms did, which manufactured most of
the apparent lead. The four-arm read nearly symmetrizes this (real vs
mean-of-4, each luck vs mean-of-3; the residual asymmetry FAVOURS real,
which makes the null verdict conservative in the honest direction).
Lesson registered as QC 65.

## 4. What does the metric OMIT that it should include?

Top-of-board magnitude comparison (are real's best pair-medians, e.g.
UNI 2d +$21.91/fold, bigger than each luck arm's best?) was not
declared and is not quoted. Noted as a possible future declared read;
given the count verdict, expectations should be low.

## 5. Are the two compared arms the same population?

Yes, with the one named residual asymmetry in 3 — which favours the
real arm and therefore cannot have produced this null result.

## 6. Is any part of the reported number achievable with NO skill?

All of it: 26 sits inside (at the minimum of) the luck arms' own range.

## 7. Would this number look the same on pure noise?

Yes — demonstrated on four independent scrambles.

## 8. What did I assume and not verify?

Worker-scheduling determinism — still open; now folds into the redesign
work rather than blocking anything. The four-value luck sample is small
(named at declaration); the verdict does not rest on a fine margin: 26
vs a line of 50.

## 9. Is the previously planned next step STILL correct?

The declared consequence fires: NO selection, NO replication design —
the current committee design's edge, if any, is too small for this
instrument to certify. Next is hypothesis/design work — AND the owner
has explicitly parked all new design until his requested debrief. So
the loop's next step is the debrief and consult: present the full
picture (this verdict included), then redesign with him — his auto-tune
and re-vote ideas are the natural starting material, now informed by a
trustworthy yardstick. No jobs fire until then except by his word.

## 10. New QC-REGISTER entries

QC 65: "a paired comparison is fair if both sides use the same formula"
— false as first built: the reference-arm COUNT must match too, or the
side with the smoother (more-averaged) reference gets a free lead.
Registered with enforcement in the four-arm reader's construction.
