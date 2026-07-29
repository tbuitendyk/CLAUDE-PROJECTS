# Post-run audit — job bracketlab-20260729-0811-l8-money-null (cycle 8)

Written 2026-07-29 under research-loop step 7.

---

## 1. What was this run supposed to answer?

Does the 1.61-point directional-accuracy edge survive fees? Declared gate:
"the 19 scrambles must agree — total net money within a 2:1 ratio of spread to
median magnitude. Wider means the money measure is as unstable as the
headcount was, and NOTHING below is read."

## 2. Does the output answer THAT question, or a neighbouring easier one?

**Neither, yet — and for two separate reasons, one of them my fault.**

(a) The declared gate FAILED. Total net money across the 19 scrambles spans
    -$4,803.87 to +$380.45: spread $5,184 against a median magnitude of
    $2,268, a ratio of 2.29 against a 2.0 limit. Under my own rule I do not
    read the comparison, and I have not.

(b) **There is no real arm to compare against.** I deployed the money census
    at 08:10 and the last real-arm run (L7) was at 07:29. So the 19 scrambles
    carry money and the real census does not. That is a sequencing error I
    made and did not notice until the reader said so.

## 3. What does the metric COUNT that it should not?

Not the issue this round. The issue is the GATE, see Q8.

## 4. What does the metric OMIT that it should include?

Nothing new.

## 5. Are the two compared arms the same population?

Unanswerable — there is only one arm. See Q2(b).

## 6. Is any part of the reported number achievable with NO skill?

Yes, and it is the one clean finding here: **trading on pure noise LOSES
money.** Median scramble -$2,268 across 170 setups, -0.053 per trade. Fees
eat a system with nothing to predict, exactly as they should. Any real result
has to clear that, not zero.

## 7. Would this number look the same on pure noise?

That is what the run measured, and the noise level is now known. What is
missing is the real arm.

## 8. What did I assume and not verify?

**Two errors, both mine, both found by doing this audit rather than by being
told.**

- *"Totals are dominated by a few large trades, so pooling per TRADE will be
  better conditioned."* **WRONG, and provably so.** I implemented it: per-trade
  ratio 2.25 against the totals' 2.29 — no improvement. The reason is
  arithmetic I should have seen before writing the code: each scramble makes
  roughly the same number of trades (~42,000), so dividing by it is close to a
  pure rescaling, and a spread-to-MAGNITUDE RATIO is scale-invariant. It could
  not have helped. I reasoned by analogy to QC 24 without checking the analogy
  held.

- *"A spread-to-magnitude ratio is a sensible agreement gate."* **WRONG for
  this statistic.** Money-per-trade on scrambled data is centred near ZERO by
  design — that is the entire point of a null. Dividing a spread by a median
  that sits near zero makes any spread look enormous. The gate was borrowed
  from the accuracy headcount, where the null sits near 50% and a wild spread
  genuinely does mean a broken construction. It does not transfer.

  The 19 draws are NOT unstable in any meaningful sense. They are a
  distribution: -0.111 to +0.009 $/trade, clustered below zero, which is
  exactly what a fee-paying null should look like.

- *Deploying a census change and then running the null first.* The real arm
  must be re-run on the same build as the null, always. Sequencing, not
  statistics, and it cost a 5-hour run its comparison.

## 9. Is the previously planned next step STILL correct?

**No. Two intervening steps, in order.**

**(i) Replace the gate, declared before any real money number exists.** I am
not relaxing a gate because it was inconvenient — that is the trap this whole
week has been about. I am replacing one that is ill-defined for a
zero-centred quantity, on the mechanism argument in Q8, at the only moment
when the change cannot possibly be chosen to flatter a result: **the real
money census has not been run, so the number I would be fitting to does not
exist.** Timing is the evidence of good faith here, and it is on the record.

  The replacement is the rank test, which needs no agreement gate because it
  makes no assumption about spread:
  * real beats all 19 scrambles -> p = 0.05, the edge pays after fees.
  * beats 18 of 19 -> p = 0.10. Suggestive. No live money.
  * weaker -> the edge does not pay, and cycle 6's accuracy result stands as
    a true statement about prediction that does not convert into money.
  Sanity check retained, and it is a real one: the scrambles must LOSE money.
  If a null ever shows a profit, the simulation is wrong, not the market.

**(ii) Run the real census with money recorded**, on the identical build.
~20 minutes. That is what makes the comparison possible at all.

## 10. New QC-REGISTER entries

- **32** — assuming an analogy transfers. "Pool per trade like we pooled per
  decision" was reasoning by resemblance; the arithmetic says a scale-invariant
  ratio cannot be improved by rescaling. Check the analogy holds before
  building on it.
- **33** — assuming a gate designed for one statistic suits another. A
  spread-to-magnitude ratio is meaningless when the statistic is centred at
  zero by construction. Gates are per-statistic and must be derived, not
  copied.
- **34** — assuming a census change applies to runs already made. Deploying a
  new recorded field and then running only the null left the two arms on
  different builds. Re-run BOTH arms after any census change.
