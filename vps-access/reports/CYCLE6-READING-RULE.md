# Cycle 6 (job bracketlab-20260729-0235) — reading rule

**Committed before the run completed.** The git timestamp on this file is the
evidence that the rule preceded the numbers. Job fired 02:35 UTC, ~4-5 hours,
19 scrambles.

## Primary measure: pooled DIRECTIONAL ACCURACY

Of the periods where the system committed to up or down, how often was it
right. Flat calls are excluded entirely: they place no trade, earn nothing,
and grading them was inflating every earlier measure (see audit of -0041, Q3).

Reference, real market data, job -2211:  **36.09%** over 19,913 committed calls.

Cycle 5's six scrambles put the noise level at mean 34.23%, sd 0.75 pts,
range 33.40-35.14. Cycle 6's 19 scrambles replace that estimate.

## The rule

**GATE FIRST.** The 19 scrambles must agree within 2.5 points of each other on
directional accuracy (cycle 5's six spanned 1.7). Wider means the construction
has broken again and NOTHING below is read.

Then, comparing 36.09% against the 19 scrambles:

- **Above all 19** -> rank-based p = 0.05. The system predicts direction better
  than noise. It is then owed the money question, which is separate: ~2 points
  of directional accuracy must survive fees, and it may well not.
- **Above 18 of 19** -> p = 0.10. Suggestive only. No live money.
- **Anything weaker** -> the directional edge closes. The remaining lead is the
  argmax/daily family, which gets its own declared test or nothing.

Report alongside, deciding nothing: the z-distance from the scramble mean, the
active-only share, and the all-units share. If the measures disagree,
directional accuracy governs and the disagreement is reported loudly.

## What this rule does NOT permit

- Reading a subset of the 19 scrambles.
- Re-running because the answer was unwelcome.
- Switching metric again after seeing the result. Any further metric change
  must satisfy QC-REGISTER item 21 and be declared before new numbers exist.
