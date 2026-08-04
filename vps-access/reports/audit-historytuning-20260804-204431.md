# Post-run audit — job historytuning-20260804-204431-historytuning

Run: History Tuning on the LTC survivor (LTCUSDT daily-4d argmax q5,
directional gate, market entry, 137h hold) from bracketlab-20260804-0733.
35 dial pairs (age half-life x retune cadence) x 3 splits = 105 passes +
untuned reference, reserve61 calendar, engine 1.40.0. 6 minutes, 0 failures,
0 refusals, no arms excluded.

## 1. What was this run supposed to answer?

The four reading rules stamped before compute. Headline question: do the two
time dials (age discount, retune cadence) STRENGTHEN this specific survivor —
judged on hold windows the picking never touched, winner vs the untuned
reference pass.

## 2. Does the output answer THAT question?

Yes, and the answer is NO. Winner by test money (none|r8m1: no age discount,
retune every 8 months) made +$122.21 across the three picking windows, then
lost -$121.08 across the three graded windows against the reference's
-$37.04, winning 1 of 3. Stamped sentence: HOLD RULE FAILED - tuning did not
strengthen this survivor. Null draws were not fired: with the hold rule
failed there is no tuning claim to defend (the stamped rules gate the draws
on a hold pass).

## 3. What does the metric COUNT that it should not?

The dial-pair board column is test money - the shopping read. It is labeled
as such on screen and never graded. No defect found; the hold columns stay
sealed for all but winner+reference by design.

## 4. What does the metric OMIT that it should include?

The single-split board number (+$82.41 held-back on the 0733 board) and the
HT walk's three-window reference holds (-62/-39/+64) measure different
things and neither is displayed beside the other. Not a defect of this run,
but the juxtaposition is the informative read (see 9).

## 5. Are the two compared arms the same population?

Yes: winner and reference walk the identical calendar, same training floors,
same trailing setting held at the declared cell's value; both hold columns
came from the same three windows.

## 6-7. No-skill achievability / would noise look the same?

The test-money column is achievable by shopping (35 pairs). The graded
comparison is winner-vs-reference on sealed windows - the stamped construction.
Null draws exist for this instrument (19 declared) but per the stamped rules
they only fire on a hold pass. Not fired; no claim made that needs them.

## 8. What did I assume and not verify?

- ASSUMED the UI would render the finished board; it did not refresh itself
  while the run computed and needed a manual reload after. The record was
  intact throughout (verified from disk). FIX: self-refreshing HT panel
  shipped in the same session (app.js v89).
- VERIFIED: 105/105 passes, 35 pairs complete, excludedArms empty, verdict
  endpoint healthy, data fingerprint stamped at launch (1.40.0).

## 9. Is the previously planned next step STILL correct?

The tuning branch is closed: no null draws, reserve grade untouched (it
grades a tuning winner; there is none). The candidate itself is NOT retired
by this - one instrument, one question, answered. But the reference walk's
holds (-62/-39/+64: profit only in the latest third) plus the earlier
17-coin replication miss sharpen the same message: LTC-specific and
late-era-heavy. The honest next judge, per protocol, is the forward paper
book on the UNTUNED setup - time only runs one way there. Recommended and
proposed to the owner; awaiting his word.

## AMENDMENT (2026-08-04, later same day): the combining-rule check, done late

The stamped combining rule says "the audit must check the winner is not
carried by one split alone." The audit above omitted that check; the owner's
question about the mechanism prompted it. RESULT: the winner WAS carried by
one split — none|r8m1's +$122.21 total = -128.33 early +222.89 middle
+27.65 late. The verdict crowned a single-window artifact, exactly the case
the rule anticipated. This strengthens the HOLD-RULE failure (the "winner"
was luck-shaped from the start) and indicts the mechanism's construction:
best-of-35-by-test is selected FOR window luck (winner's curse), then graded
against an unselected reference — the deck is stacked toward "tuning fails"
whether or not tuning helps.

CONTAMINATION DISCLOSURE: diagnosing the instrument required reading the
non-winner arms' hold columns from the stored rows (the UI seals them; the
record keeps them, correctly, under QC 74). In those rows, 36mo|never beat
the reference on ALL THREE hold windows (-43 vs -62, -24 vs -39, +79 vs
+64). Because that was seen AFTER unsealing, it may never be used to promote
that arm — holds were peeked, so any such promotion would be shopping the
graded window. It is recorded here solely as (a) proof the winner's-curse
construction hid a consistent arm from the verdict, and (b) a hypothesis
that a FUTURE pre-registered one-arm test may cite as its origin, with the
contamination named.

## Findings for the QC register

QC 78: a stamped rule that assigns the AUDIT a check does not enforce that
check — mine skipped it until the owner's question forced it. Fix: audit
obligations named in reading rules must be computed by the verdict endpoint
itself (e.g. print 'winner carried by one split: YES/NO' with the numbers),
so the reader cannot omit them. MANUAL until that ships.
