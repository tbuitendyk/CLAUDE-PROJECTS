# Post-run audit — job bracketlab-20260729-0235 (cycle 6)

Written 2026-07-29 under research-loop step 7, before any new job was fired.

---

## 1. What was this run supposed to answer?

From `reports/CYCLE6-READING-RULE.md`, committed 02:46 UTC before the run
finished: does the system predict direction better than noise, measured as
pooled directional accuracy against 19 scrambles, with our reference being
36.09% from job -2211.

Gate declared: the 19 scrambles must agree within 2.5 points or nothing is read.

## 2. Does the output answer THAT question, or a neighbouring easier one?

It answers that question. Gate PASSED at 2.44 points against a 2.5 limit —
with 0.06 points to spare, which is uncomfortably close to having thrown the
whole run out.

Result, applying the rule as written:

    real (job -2211)      36.09%
    19 scrambles          33.41% - 35.85%, mean 34.48%, sd 0.69
    verdict               above all 19  ->  rank-based p = 0.05
    z-distance            +2.33 sd from the scramble mean

**This is the weakest possible pass.** 19 draws makes 0.05 the *floor*, so
0.05 is not evidence of a strong effect — it is the best arithmetic allows.
The margin over the top scramble is **0.24 percentage points**.

## 3. What does the metric COUNT that it should not?

Nothing further found this round. The flat-call contamination was removed
before this run (directional accuracy counts only committed decisions).

Residual: "right" means an exact 3-class match. Being wrong can mean *flat*
(a small loss plus fees) or *the opposite direction* (a large loss). The
metric treats those identically. **Accuracy is not P&L**, and the two can
diverge sharply if the errors are asymmetric. This is the single largest
remaining gap and it is exactly the money question.

## 4. What does the metric OMIT that it should include?

The size of wins and losses. See above.

## 5. Are the two compared arms the same population?

Still not identical — real 77.6% of setups made 21+ trades, scrambled 61.1%.
**Checked whether this drives the result**, which it does not:

    pooled per-decision   real 36.09%  null 34.48%   +1.61
    median unit           real 35.21%  null 33.33%   +1.88

The two agree in direction and size, so the effect is not an artifact of
which units happen to trade more. This is a genuine check performed, not an
assumption.

## 6. Is any part of the reported number achievable with NO skill?

Chance on a 3-class problem is near 33%, and the measured scramble level is
34.48% — so roughly 34.5 of the 36.09 points are available with no skill at
all. The skill component is **1.61 points**.

## 7. Would this number look the same on pure noise?

No — that is what this run measured. But see Q8: the real arm has not been
re-measured on current code.

## 8. What did I assume and not verify?

- **BLOCKING: job -2211 has not been re-run since numerous code changes.**
  Its 36.09% is the entire real arm of this comparison. The full suite and
  the determinism fixture pass, so I expect it reproduces, but expecting is
  not checking — and this exact assumption class is QC item 2. A 0.24-point
  margin cannot absorb any drift at all.
- *The two metrics would agree.* **WRONG, and this is a finding.** Directional
  accuracy passes; the active-only headcount puts the real run INSIDE the
  null spread, 2.2 points BELOW the top scramble. See Q9.
- *Six scrambles characterised the headcount null.* WRONG. Cycle 5's six gave
  42.7-55.9%; nineteen give 48.6-58.8%. The headcount null was wider than six
  draws suggested, which is why more draws mattered.

## 9. Is the previously planned next step STILL correct?

**No. An intervening step is required first.**

Planned next: the money question (does 1.6 points survive fees).

Two reasons it does not proceed yet:

**(a) The real arm is unverified on current code.** A 0.24-point margin is
the entire result. Re-running the -2211 census on today's build is cheap
(~22 minutes) and is the difference between a result and a hope. This is
the intervening step, and it is fired next.

**(b) The metrics disagree and that must be understood, not waved through.**
The declared rule says directional accuracy governs, and I am honouring that
— but a result that passes on my chosen metric while failing on two others
deserves suspicion, not celebration. The most likely explanation is
resolution: the headcount's own null spans 10.2 points because it compresses
~22,000 decisions into 170 unit-verdicts, so it cannot resolve a 1.6-point
effect. The directional metric's null spans 2.4 points on a comparable scale.
That is a coherent story and it favours the primary metric — but it is a
story, and it is recorded here as such rather than as established.

Honest statement of where this leaves us: **a marginal pass at the weakest
significance the design can produce, on one metric of three, with the real
arm not yet re-verified.** That is a lead worth one cheap confirmation. It is
not grounds for live money, and I will not present it as such.

## 10. New QC-REGISTER entries

- **26** — assuming a gate that passes by 0.06 points is a pass like any
  other. Report the margin, not just the verdict; a near-miss on a gate is
  information about the instrument.
- **27** — assuming the significance floor is the significance. With N draws
  the rank test cannot go below 1/(N+1), so "p = 0.05" on 19 draws means
  "the best this design could say", not "a strong effect".
- **28** — assuming metrics that measure related things will agree. When they
  disagree, the disagreement is the finding; record which governs and why,
  decided in advance.
