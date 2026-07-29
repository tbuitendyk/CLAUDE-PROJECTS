# Post-run audit — job bracketlab-20260729-0729-l7-verify-real-arm (cycle 7)

Written 2026-07-29 under research-loop step 7.

---

## 1. What was this run supposed to answer?

Does the real arm of cycle 6's comparison — 36.09% directional accuracy from
job -2211 — still reproduce on the current build? Cycle 6's entire result was
a 0.24-point margin resting on that one number, produced before the null was
rewritten, the split helper refactored, the census extended, the draw cap
raised and job naming changed.

Rule fixed before firing: within 0.1 points = reproduced, cycle 6 stands.
More than 0.1 points = cycle 6 void until the cause is found, *including* if
it moved in our favour.

## 2. Does the output answer THAT question, or a neighbouring easier one?

Directly, and better than the rule required. Not "within 0.1 points" —
IDENTICAL, to every digit reported:

    directional calls   19913  vs  19913
    hits                 7187  vs   7187
    accuracy           36.09%  vs  36.09%
    median unit        35.21%  vs  35.21%
    edge > 0           98/170  vs  98/170
    silent units       4 (2.4%) vs 4 (2.4%)

Determinism held across every change. **Cycle 6 stands as read.**

## 3. What does the metric COUNT that it should not?

Unchanged from the cycle 6 audit. Still open: "right" means an exact 3-class
match, so a wrong call that lands on flat (small loss plus fees) and one that
lands on the opposite direction (large loss) score identically. Accuracy is
not P&L. That is the money question and it is now the next step.

## 4. What does the metric OMIT that it should include?

Trade sizing and the asymmetry of wins against losses. Same gap as above.

## 5. Are the two compared arms the same population?

Not applicable — this run has one arm. It IS the comparison object for
cycle 6, where the population question was checked and answered (pooled and
per-unit medians agreed in direction and size).

## 6. Is any part of the reported number achievable with NO skill?

Yes, and unchanged: chance on a 3-class problem sits near 33%, measured
scramble level 34.48%. The skill component of 36.09% remains 1.61 points.

## 7. Would this number look the same on pure noise?

Answered by cycle 6, not by this run. This run confirms the real arm of that
comparison is stable, which is what makes cycle 6's answer usable.

## 8. What did I assume and not verify?

- *The determinism fixture and full suite passing implies the census
  reproduces.* Now VERIFIED rather than assumed, and it held exactly. This
  closes the blocking open item carried since the cycle 5 audit.
- Nothing new outstanding from this run.

## 9. Is the previously planned next step STILL correct?

**Yes.** For the first time in this sequence the audit does not force an
intervening step. The blocker it was fired to clear is cleared, exactly.

Next: **the money question.** Does 1.61 points of directional accuracy
survive fees?

It does not follow from what we have. Accuracy counts a wrong call the same
whether the market went nowhere or went hard the other way, and P&L does not.
A system can be right more often than noise and still lose money if its
mistakes are larger than its wins.

Platform work this needs, before firing anything (loop step 3): the census
records prediction quality per unit but not net money on the held-back slice.
The money arm needs the same treatment the accuracy arm just got — a census
that is never money-ranked, and the same 19 scrambles for comparison.
Reusing the money-ranked leaderboard would reintroduce exactly the selection
fault that invalidated the very first edge screen (job -2158).

## 10. New QC-REGISTER entries

None. No incorrect assumption surfaced in this run — the one it was fired to
test turned out to be correct, which is recorded rather than skipped.
