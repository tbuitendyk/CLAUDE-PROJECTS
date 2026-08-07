# Forward books — first out-of-sample read (2026-08-07)

Engine 1.44.0. Books, cutoff, scoring start and reading rules were committed in
FORWARD-BOOKS.md BEFORE any of this existed. Scored window 2026-07-01 ..
2026-08-02 (28 periods) — data no selecting run could see.

## 1. The numbers, with the trade count first (R3)

  book  trades  net $   wins  break-even $/leg  headroom  always-long  always-short
  F1        13  +27.43  11/13          1.1799     843.9%       +4.88       -16.88
  F2         2   -0.51   1/2          -0.0034    -102.7%      -69.38       +57.88
  F3         3   -1.25   1/3          -0.0837    -167.0%      -69.38       +57.88

ALL THREE ARE BELOW THE 30-TRADE FLOOR. Per R3, declared before any number
existed: numbers are reported, NO VERDICT is claimed. Nothing below changes
that, including the parts that look good.

## 2. F1 — encouraging, and for that reason to be read with more suspicion
It beat both no-skill controls (R5): +$27.43 against always-long +$4.88 and
always-short -$16.88, on a stretch where LTC went roughly nowhere. It won 11 of
13. Its break-even fee is $1.18/leg against the $0.125 charged.

Reasons NOT to be pleased yet, in order of force:
- 13 TRADES. An 85% win rate on 13 trades has a huge spread; a coin-flip
  strategy hits 11+ of 13 about 1 time in 90, which sounds impressive until you
  remember three books were run and the whole exercise is one draw of a
  five-week window. This is not a p-value and must not be quoted as one.
- THE MAGNITUDE IS A WARNING, NOT A SELLING POINT. $27.43 on a $100 book in
  five weeks is roughly a 27% return. Effects that large in a strategy whose
  own backtest managed $158 over eleven months are more often a sign of a thin
  sample or an error than of an edge that will persist.
- 844% headroom is computed from the same 13 trades; it inherits their spread.
- The selecting backtest ($158.32 over 224 trades) is spent and cannot be
  averaged with this. Reported side by side ONLY as contrast.

## 3. F2 and F3 — an instrument question, not just a poor result
Both barely traded. Backtest trade rates were 240/325 = 0.74 and 242/325 = 0.75
per period; forward rates are 2/28 = 0.07 and 3/28 = 0.11 — a TEN-FOLD collapse
in participation. That is not a small-sample wobble, it is a different regime of
behaviour, and it needs a cause before either book's forward money means
anything.
Leading hypothesis (UNTESTED): both use breakout entry with dMult 1.5 against a
FROZEN band of 1.61%, so they require a ~2.4% move to trigger. If forward
volatility is materially lower than the training era, the trigger is simply out
of reach and the books stand aside almost always. F1 uses market entry — no
distance to reach — and did not collapse, which fits the hypothesis.
DECLARED NEXT CHECK: compare realised volatility in the forward window against
the training era for XLM. If it has fallen, the collapse is explained and the
frozen band becomes a known limitation of any breakout book, worth stating
plainly rather than discovering later.

## 4. Engineering disclosure — this module was built badly three times
Three defects of one class reached the box before the first honest read:
a chunk field (`endTs`) that does not exist, used in the split; the same field
again in `lastPeriodTs`; and `.pnl` read off no-skill controls that arrive as
plain numbers. Each produced `undefined`, which JSON drops silently, so the
failure surfaced far from its cause. All three are now covered by a test that
round-trips a scored book through JSON and asserts every field the reader
prints is present.
One was worse than a nuisance: the split used the 24h STEP as if it were the
period's SPAN, while daily-4d does not close its trade until 138h after a
period starts. About 5 training periods of 2397 had their outcomes inside the
scoring window — a real leak of exactly the kind this freeze exists to prevent.
Fixed to use the geometry's outcome horizon. The test that should have caught
it had encoded the same wrong definition as the code, so it agreed with the bug
instead of failing it; it now asserts against the geometry.
Also found on the way: tests/run.js takes an explicit file list, so a new test
file runs NOTHING while the suite reports success. A check now fails if any
test file is unregistered.

## 5. Standing
F1 is the most interesting thing this project has produced, and it is still
below the floor at which the pre-registration permits a verdict. The books
accumulate; the next read is worth taking when F1 approaches 30 forward trades,
which at ~13 per five weeks is roughly seven more weeks. No Binance trade is
authorised or implied by anything here.
