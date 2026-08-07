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

---

## ADDENDUM — the declared hypothesis was REFUTED, and what replaced it matters more

### The frozen-trigger hypothesis is dead
Declared: F2/F3 stopped trading because their breakout needs a 2.415% move
(1.5 x the frozen 1.61% band) and forward volatility fell.

Volatility DID fall — XLM median |period move| 3.12% (last 400 training
periods) -> 1.90% forward, and the share of periods clearing the trigger fell
60.0% -> 46.4%. But 46.4% of 28 periods is about 13 periods where the trigger
IS reachable, against 2 and 3 actual trades. The hypothesis is directionally
right and quantitatively nowhere near sufficient. REFUTED as the explanation.

### What is actually happening: the committees went silent
Decomposing participation into "did the committee call a side" and "did
execution then fire":

  book  fwd periods  committee called  trades  lost at committee  lost at execution
  F1             28        14 (50%)        13                 14                  1
  F2             28         2 ( 7%)         2                 26                  0
  F3             28         3 (11%)         3                 25                  0

Nothing is lost at execution. The loss is entirely upstream: the members stop
calling a direction at all. Per-member directional calls out of 28 forward
periods — F1: 3, 3, 8, 9. F2: 1, 0, 0, 2. F3: 1, 0, 0, 0, 0, 1, 2, 0.

Against their own backtests (committee participation): F1 61.5% -> 50%,
F2 73.8% -> 7%, F3 74.5% -> 11%.

### This is a finding about the whole approach, not about two books
A frozen committee does not fail loudly out of sample — it goes QUIET. It keeps
returning a well-formed answer ("stand aside") while having stopped saying
anything. On F2/F3 that produced a book with two trades and a plausible-looking
tiny loss, which is exactly the shape of defect this project keeps meeting:
right units, plausible magnitude, no error raised.

It also reframes F1. Its +$27.43 rests on members that call a direction only
3-9 times in 28 periods; the committee's 50% comes from a 1-of-4 quorum turning
a few sparse opinions into a position. That is a thinner basis than the headline
suggests, and it is now recorded next to the headline.

### New hypothesis, declared before it is tested
F2 and F3 use decision `directional`; F1 uses `argmax`. All three degrade, but
only the two `directional` books collapse. HYPOTHESIS: the `directional`
decision rule requires a confidence that forward data rarely supplies, so it
goes silent out of sample while `argmax` merely thins. If true it is a property
of an entire decision family, and it would disqualify `directional` setups from
forward use regardless of how well they backtest.
TEST, declared now: measure per-member directional-call rate for the same
committees on training-era periods versus forward periods, for both decision
rules, on the same coins. Reading rule: if `directional` members drop by an
order of magnitude while `argmax` members drop by less than half, the hypothesis
stands and every `directional` candidate in the pipeline is suspect.
This test comes BEFORE any further reading of F2/F3, and before the next
forward read is treated as meaningful.

### QC candidate (not yet an entry — no named cause)
"A frozen model that stops trading has failed, and must say so." Books should
report committee participation against their backtest rate, and flag a
collapse, rather than reporting a small loss on two trades as though it were a
result. Becomes an entry once the mechanism above is confirmed.

---

## ADDENDUM 2 — the silence hypothesis is REFUTED, and it exposed a framing error in my own books

### The declared test, run on both rules and both coins (confound removed)
Per-member directional-call rate, in-sample vs forward:

  coin  decision      in-sample  forward  retains
  LTC   argmax            33.7%    20.5%     61%
  LTC   directional       37.1%    38.4%    104%
  XLM   argmax            69.8%    78.6%    113%
  XLM   directional        3.2%     2.7%     85%

Reading rule required directional to drop ~10x forward while argmax held.
NOTHING drops forward. REFUTED. `directional` is not a rule that goes silent
out of sample.

What the table shows instead: XLM/directional was ALREADY near-mute IN SAMPLE
(3.2%). It never spoke; it did not stop speaking.

### That contradicted the board, so I checked, and the board is not wrong — I am
The discovery row for XLM/directional traded 240 of 325 periods. A 3.2% call
rate cannot produce that. Both cannot be the same committee.

Same specification, same scored periods, training window as the only difference:

  XLM directional   trained on first 70% (as the board did): 50.8% calls, committee 243/325
                    trained on train+test (as my books do):   8.2% calls, committee 105/325
  LTC argmax        trained on first 70% (as the board did): 36.6% calls, committee 226/364
                    trained on train+test (as my books do):  42.9% calls, committee 241/364

TWO CONCLUSIONS, and the first is good news:

1. THE ENGINE REPRODUCES. Construction A recovers the board almost exactly —
   243 committee calls against 240 recorded trades for XLM, 226 against 224 for
   LTC. The discovery numbers are real and re-derivable. That is a genuine
   validation of determinism, obtained as a by-product.

2. MY FORWARD BOOKS TEST SOMETHING OTHER THAN WHAT THEY CLAIM. FORWARD-BOOKS.md
   says a book that retrains "has stopped being a forward test of the thing that
   was selected" — and then specifies training on ALL data to 2026-06-30, which
   is exactly a retrain. The two sentences contradict each other and I did not
   notice. For LTC the retrained committee is close to the selected one (36.6%
   vs 42.9%), so F1 is roughly the intended artifact. For XLM it is a 6x
   different committee, so F2 and F3's forward numbers say NOTHING about the
   setups that cleared the money screen.

### Consequences, stated plainly
- F2/F3 forward results are WITHDRAWN as evidence about the money-screen
  clearers. They remain a valid record of something else (the recipe retrained),
  and under R4 they stay in the record rather than being deleted.
- F1's forward +$27.43 is closer to the intended artifact but is still a
  retrained committee, not the selected one. Downgraded from "the leader's
  forward record" to "the leader's RECIPE, retrained, forward record".
- The books keep running unchanged. R4 forbids re-specifying them, and the
  correct repair is a SECOND, separately pre-registered set that reproduces the
  selected models exactly (train on the board's own 70% window), not an edit to
  these.

### The finding underneath, which outranks all three books
Adding ~325 recent periods to XLM/directional's training set cuts its member
call rate from 50.8% to 8.2%. A recipe whose behaviour changes six-fold on how
much history it is given is fragile in a way no backtest on a fixed split can
show. This is now the most important open question in the project, ahead of any
individual candidate:
DECLARED NEXT TEST — train the same specification on a sliding set of training
extents (50%, 60%, 70%, 80%, 90%, 100% of history to the freeze) and plot call
rate and net money against extent, for both coins and both decision rules. A
setup whose money swings with training extent is not tradeable at any backtest
value. Reading rule: stability means net money keeps its SIGN and call rate
stays within a factor of two across extents; anything else disqualifies the
setup from a Binance test regardless of its other numbers.

### QC candidate, now with a named cause
"A frozen book must state whether it reproduces the SELECTED model or retrains
the recipe, and its training window must be asserted against the run that
selected it." Becomes an entry with the next release, enforced by a test that
compares reconstructed committee participation against the selecting run's
recorded trade count.
