# Post-run audit — job bracketlab-20260729-1300-l9-real-arm-with-money (cycle 9)

Written 2026-07-29 under research-loop step 7. **This is the audit of a
POSITIVE result, which is when scepticism is worth most.**

---

## 1. What was this run supposed to answer?

Supply the missing real arm so cycle 8's 19 scrambles had something to
compare against. Rule declared before this number existed: real beats all 19
-> p = 0.05, the edge pays after fees; 18 of 19 -> suggestive; weaker -> the
edge does not pay.

## 2. Does the output answer THAT question, or a neighbouring easier one?

It answers it, and cleanly. Real beats all 19 scrambles on **every** money
statistic:

    net $        1,469.95   best null   380.45    19/19
    median $         9.88   best null     3.59    19/19
    win %           55.9%   best null    52.4%    19/19
    $ / trade      0.0412   best null   0.0091    19/19
    vs hold $    1,385.92   best null   457.88    19/19

Sanity gate passed: 18/19 scrambles lose money, as a fee-paying null must.
Margin over the luckiest scramble: $1,089.50 — a real margin, unlike cycle
6's 0.24 points. Internal check: this census reproduces 36.09% directional
accuracy exactly, so it is the same census as -2211 and -0729.

## 3. What does the metric COUNT that it should not?

**$1,469.95 is not an achievable profit and must never be quoted as one.** It
is the sum over 170 setups spanning 17 coins — roughly ten overlapping
configurations per coin, held simultaneously. Nobody could trade it. It is a
statistical aggregate whose only job is to be compared against the same
aggregate computed on noise.

## 4. What does the metric OMIT that it should include?

**Slippage.** The simulation fills at candle prices with a flat fee. Market
orders at $100 size on liquid pairs are forgiving, but this is not modelled,
and see Q6 for why that matters more than usual here.

## 5. Are the two compared arms the same population?

Same universe, same permutation, same build (both post the 08:10 deploy),
same holdout window. Yes.

**But a new mismatch surfaced, between the MONEY and ACCURACY results:**

    money arm      35,678 trades   (cell chosen by search-window MONEY)
    accuracy arm   19,913 calls    (rung chosen by search-window EDGE)

These are DIFFERENT selected configurations. So I cannot say "the 1.61-point
accuracy edge converts into money" — cycle 6 and cycle 9 measure different
things. Each stands on its own null; neither validates the other. Recorded as
QC 35.

## 6. Is any part of the reported number achievable with NO skill?

The null answers this: no, noise loses money. But the *size* of what is left
is the story, and it is thin:

    gross per trade, before fees   $0.2912   (0.291% of $100 notional)
    fees per round trip, assumed   $0.2500   (0.250%)
    net per trade                  $0.0412   (0.041%)

**Fees consume 85.9% of the gross edge.** Break-even round-trip cost is
0.291%, and the assumption is 0.250% — headroom of 16%.

Binance spot taker alone is 0.10% per side, 0.20% round trip. The remaining
0.05% assumed covers spread. If real execution costs 0.30% — entirely
plausible with slippage on market orders, or a worse fee tier — **the edge is
negative.** This is the single most important number in the whole result and
it did not appear in any table until I went looking for it.

## 7. Would this number look the same on pure noise?

No — that is exactly what the 19 scrambles establish, and the margin is wide.

## 8. What did I assume and not verify?

- *A positive result needs less scrutiny than a negative one.* The inverse is
  true, and Q6 is why: the result is real and simultaneously fragile.
- *The money and accuracy results describe the same thing.* WRONG — Q5.
- **OPEN, and it is the largest one: ONE HOLDOUT WINDOW.** Everything rests on
  a single ~4.5-month slice at the end of the data. If that period suited this
  strategy, the result does not generalise, and no amount of scrambling within
  that window would reveal it — the scrambles share the same period.

## 9. Is the previously planned next step STILL correct?

**No. Live money was never the next step and is further away than it looks.**

The blocking weakness is Q8: one holdout window. A null tests "is this better
than noise *in this period*". It cannot test "does this hold in another
period", because every scramble is drawn from the same slice.

Next: **walk-forward.** Re-run the identical test with the data ending
earlier, so the held-back slice falls on a different stretch of history. If
the edge is real it should survive; if it was a property of one period it
will not.

Platform change made first, and it removes the fault that cost cycle 8 its
comparison: a multi-scramble job now carries its OWN real arm (r=0). Both
halves share one build, one data range, one code path, one moment. Enforcing
that by construction beats enforcing it by discipline, which is what QC 34
was, one run after it failed.

Not before walk-forward, and stated so nobody drifts toward it: no live money.
Even a clean walk-forward leaves 16% headroom over assumed costs, and the
first real question after that is execution cost measured on the actual
venue, not assumed in a simulator.

## 10. New QC-REGISTER entries

- **35** — assuming two results from one run describe the same configuration.
  The money cell is chosen by search-window money; the accuracy rung by
  search-window edge. Different selections, different objects.
- **36** — assuming a headline dollar figure is achievable. A census total is
  an aggregate over overlapping setups nobody could hold at once.
- **37** — assuming a net result is robust because it is positive. Report
  gross, fees and break-even cost beside every net figure: 85.9% of this
  gross edge is eaten by fees, which is invisible in the net number alone.
