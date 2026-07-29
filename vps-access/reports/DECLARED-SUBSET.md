# Declared asset subset — frozen before its evaluation data was seen

**Committed while job bracketlab-20260729-2054-l11-walkforward-redo was still
RUNNING.** The git timestamp on this file is the evidence that the list
predates the numbers it will be judged on.

## The subset

    TRXUSDT, LTCUSDT, BNBUSDT, XLMUSDT, XRPUSDT

## How it was chosen, and why that is legitimate

Ranked by median **search-window** edge from cycle 9 (job -1300). The search
window is the slice used to pick settings — it is NOT the held-back slice, and
it is NOT the data this subset will be evaluated on.

    selection data   cycle 9 search window     ~2025-09 onward
    evaluation data  cycle 11 held-back slice  ~2025-01 to 2025-06

No overlap. Selection and evaluation are separated in time.

Ranking (median search-window edge, accuracy points):

    TRXUSDT  16.32     SOLUSDT   9.19     AVAXUSDT  3.17
    LTCUSDT  13.85     ATOMUSDT  7.29     ZECUSDT   2.14
    BNBUSDT  10.88     ETHUSDT   7.00     BCHUSDT   1.67
    XLMUSDT   9.91     LINKUSDT  5.79     ADAUSDT   0.90
    XRPUSDT   9.86     UNIUSDT   3.49     ETCUSDT   0.00
                                          DOGEUSDT -1.83
                                          DOTUSDT  -2.19

## Why a subset at all

The owner's objection is sound: a pooled test over 17 correlated assets can
DILUTE an effect concentrated in a few. If the edge lives in three assets and
is absent in fourteen, the aggregate understates it.

What is NOT allowed is pursuing whichever assets looked best on the held-back
slice. The null proves that bites — individual scrambled setups also post
strong-looking numbers, because picking the best of 170 draws from noise
produces an impressive-looking best.

## Reading rule, fixed now

When cycle 11 lands, this subset is evaluated on its held-back slice against
the same 19 scrambles, restricted to these five assets:

- **Subset beats all 19** — the effect is concentrated and survives into a
  different period. That is a stronger result than the pooled test gives, and
  it is the first thing worth costing out against real execution.
- **Subset beats 18 of 19** — suggestive only.
- **Subset weaker, but the POOLED result passes** — the concentration story is
  wrong; the edge is broad and weak rather than narrow and strong.
- **Both weaker** — cycle 9 was period-specific. The subset does not rescue it,
  and trying further subsets would be exactly the fishing this separation was
  built to prevent.

**One look. No re-ranking, no second subset, no "top 3 instead of top 5"
after seeing the answer.** If five is wrong, that is a finding for the next
declared test, not a licence to adjust this one.

## Caveat recorded now

Search-window edge is a PREDICTION measure; the evaluation is on MONEY. A
subset chosen for predicting well may not be the subset that pays best — see
QC 35, where the money cell and the accuracy rung turned out to be different
selections. This is the honest version of that risk, stated in advance rather
than discovered afterwards.
