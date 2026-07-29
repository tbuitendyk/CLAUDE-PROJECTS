# Post-run audit — job bracketlab-20260729-0041 (cycle 5)

Written 2026-07-29 under research-loop step 7. First audit under the rule.

Disclosure: cycle 6 (job -0235) was fired BEFORE this audit existed, because
the rule did not yet exist. Under the rule it should have come first. The
audit's conclusion (Q9) is therefore acted on mid-flight rather than before
launch — see Q9 for what that costs and why the run does not need killing.

---

## 1. What was this run supposed to answer?

From the launcher, written before firing: *"is 57.6% more than this machinery
produces on outcomes it cannot possibly predict?"* Gate declared in advance:
the six scrambles must agree within 15 points or nothing is read.

## 2. Does the output answer THAT question, or a neighbouring easier one?

Partly a neighbouring one. It answered *"does the machinery flag more setups as
beating their baseline on real data than on scrambled data"* — a question about
CLASSIFICATION bookkeeping. The question we actually care about is whether the
system trades profitably, and the two are not the same. See Q3.

Gate itself: PASSED, 9.4 points against a 15-point limit (previous run: 76.5).
The construction fix is sound and that part of the run did its job.

## 3. What does the metric COUNT that it should not?

**This is the finding.** The `edge` metric scores all three answers —
down / flat / up. So a setup that commits to a direction ONCE and says "flat"
for the other 130 periods is graded almost entirely on its flat calls. Flat
calls place no trade and earn no money. The metric was substantially measuring
"can it tell when nothing happens", not "can it tell which way".

Already fixed this session: silent setups (zero directional calls) excluded —
they were 2.4% of the real run but ~15% of scrambled ones and were scored as
wins on flat calls alone.

NOT fixed by that: `active-only` counts a setup with 1 trade the same as one
with 50, and still grades both mostly on flat calls.

## 4. What does the metric OMIT that it should include?

The number of committed decisions. 170 unit-level yes/nos throw away the
19,913 individual trading decisions underneath them, which is where the
statistical power lives.

## 5. Are the two compared arms the same population?

**No, and this survived the active-only fix.** Trade-frequency distribution:

  real run   77.6% of setups made 21+ directional calls
  scrambled  59.8% of setups made 21+ directional calls

Scrambling does not just make the models wrong, it makes them trade less. So
even after removing silent setups, the real and scrambled arms differ in
composition. The directional-accuracy metric in Q9 is robust to this because
it pools per-DECISION rather than per-setup.

## 6. Is any part of the reported number achievable with NO skill?

Yes — substantially. Always calling "flat" scores well whenever the held-back
period contains more flat outcomes than the training period's commonest
answer. That is pure class-balance luck. It is precisely what inflated the
scrambled arm.

## 7. Would this number look the same on pure noise?

Now measured properly, and this is the payoff of the whole exercise:

  metric                      real (-2211)   noise (-0041)   gap
  active-only share              56.6%          50.8%       +5.8 pts
  DIRECTIONAL ACCURACY           36.09%         34.23%       +1.9 pts

The headcount overstated the effect roughly threefold. On the measure that
corresponds to money — of the periods where it committed to a direction, how
often was it right — the real advantage is under two points.

Per-scramble directional accuracy: 33.40, 33.61, 33.88, 34.20, 35.13, 35.14.
Mean 34.23%, sd 0.75 pts. Real 36.09% sits above all six, +2.48 sd.

Note the spread: 1.7 points, against roughly 13 points for the active-only
share. Pooling ~20,000 decisions instead of 170 unit verdicts is far more
precise, so this metric can settle the question with fewer scrambles.

## 8. What did I assume and not verify?

- *"Excluding silent setups makes the arms comparable."* WRONG — verified
  today, trade-frequency still differs (Q5). Recorded.
- *"Unit-level headcount is a reasonable summary."* WRONG — it discards the
  per-decision data and inherits flat-call contamination (Q3, Q4). Recorded.
- *"36% looks low."* NOT AN ERROR but needs saying: this is a 3-class problem,
  so chance is near 33%, not 50%. Compared against 50% it would look like a
  disaster; against its own null it is a small positive.
- *Cycle 5's construction is sound.* VERIFIED — gate passed at 9.4 points, and
  the run's own record confirms it used window-scope rotation.
- OPEN: the real census (-2211) has not been re-run since several code changes.
  Its numbers are assumed reproducible. The determinism fixture and full test
  suite pass, but the census itself has not been re-executed.

## 9. Is the previously planned next step STILL correct?

**Partly. It proceeds, but its primary metric changes.**

Planned: cycle 6, 19 scrambles, judged on active-only share.

Correction: the primary measure becomes **pooled directional accuracy**, for
the mechanism reason in Q3 — flat calls cannot be traded, so they cannot be
evidence about trading. Applying the register item 21 test to this change:
(a) argued from mechanism, not from the number improving — and note it makes
the effect look SMALLER, 5.8 points down to 1.9; (b) moves both arms (real
56.6→36.09, noise 50.8→34.23); (c) the older measures stay reported alongside.

Cycle 6 does NOT need killing. Its census records directional calls and hits
per row with the scramble tag, so the 19 scrambles it is already generating
produce exactly the data this metric needs. Killing and relaunching would cost
five hours and gain nothing.

What it costs to have fired early: nothing material here, by luck rather than
by design. Had the audit demanded a different universe or geometry, five hours
would have been wasted. The gate now exists so the next one cannot do this.

The declared reading rule for cycle 6 is written to
`reports/CYCLE6-READING-RULE.md` and committed BEFORE the run completes, so
the commit timestamp evidences that it preceded the numbers.

## 10. New QC-REGISTER entries

- **22** — assuming a classification score is a trading score. Flat calls are
  unearned and untradeable; score on committed decisions.
- **23** — assuming removing non-participants equalises two populations. Check
  the full activity distribution, not just the zero bucket.
- **24** — assuming unit-level headcounts summarise per-decision data. They
  discard power and inherit contamination.
