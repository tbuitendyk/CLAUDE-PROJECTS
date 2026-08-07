# Training-extent stability test (2026-08-07)

Declared before the run: STABLE means net money keeps its SIGN across all
extents AND the call rate stays within a factor of two. Anything else
disqualifies the setup from a live test regardless of its other numbers.

Construction: the scored periods are IDENTICAL for every extent (the held-back
15%, never trained on). Only how much history feeds the members varies, always
ending immediately before the scored slice. Difference is attributable to
training extent alone. Both coins, both decision rules, so coin and rule are
not confounded.

## Results

  setup                       net money range       call-rate spread   verdict
  LTC argmax   (F1 spec)      +$204.50 .. +$341.26            x1.6     STABLE
  LTC directional (cross)     +$120.61 .. +$437.41            x2.1     unstable (rate)
  XLM directional (F2 spec)    -$85.77 .. +$101.27           x63.6     UNSTABLE
  XLM argmax   (cross)         -$77.97 ..  +$70.97            x1.2     unstable (sign)

## Reading

F1's SPECIFICATION IS THE ONLY ONE THAT PASSES. Across a 2x range of training
history its money stays positive and its call rate moves by less than a factor
of two. That is the first stability evidence any candidate here has produced.

F2's SPECIFICATION IS DISQUALIFIED, and not marginally. Its money swings from
-$85.77 to +$101.27 purely on how much history it is trained on, and its call
rate moves by a factor of SIXTY-THREE. The $40.96 that got it through the money
screen is one draw from a range that straddles zero; a different training extent
would have produced a different sign and it would never have been a candidate.
F3 shares the specification and falls with it.

BOTH XLM SETUPS FLIP SIGN; BOTH LTC SETUPS STAY POSITIVE. The instability tracks
the COIN more than the decision rule, which retires the leftover suspicion that
`directional` is inherently fragile — LTC/directional keeps a positive sign
across every extent and fails only the call-rate limit at x2.1, marginally.

## Scope limits, stated rather than buried
- These are all scored on the held-back slice that F1 was SELECTED on. The
  stability finding is valid (it is about sensitivity to training extent, and
  the scored periods are held constant), but the absolute money here is NOT
  fresh evidence for any of them.
- The extents slice the most recent N% of pre-scoring history, which is not the
  board's own training construction, so these dollar figures do not and should
  not reproduce the board's $158.32. Reproduction was verified separately
  (243 vs 240, 226 vs 224 committee calls).
- x2 and "sign stable" are GUESSED thresholds, declared in advance. A setup
  failing them is disqualified from a LIVE test; it is not proof the idea is
  worthless. F2 is not retired as a research object, it is barred from money.

## Where F1 now stands
Survived, in order: three null constructions (19/19 under each, including two
that were built specifically to be harder), the declared money screen (283% fee
headroom), and now training-extent stability. It is the strongest candidate this
project has produced and the only one that has never failed a declared test.
It still lacks the one thing that matters: a forward record of any size. 13
trades against a pre-registered floor of 30.

## Next
1. Let the forward record accumulate. Nothing else changes that.
2. QC entry: training-extent stability becomes a standing gate — no candidate
   reaches a live-money conversation without passing it, because a backtest
   number from an unstable setup is one draw from a range nobody looked at.
3. The second pre-registered book set (reproducing SELECTED models rather than
   retrained recipes) remains owed, per the framing correction.
