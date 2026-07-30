# Post-run audit — job bracketlab-20260729-2054-l11-walkforward-redo (cycle 11)

Written 2026-07-30 under research-loop step 7.

---

## 1. What was this run supposed to answer?

Does the edge survive in a DIFFERENT stretch of history? Cycle 9 showed it beat
noise after fees 19/19, but all 19 scrambles came from the same ~4.5-month
window, so they cannot test whether that window was special. Data ends 2025-06,
putting the held-back slice on a non-overlapping earlier period.

Rule fixed before firing: beats all 19 = not period-specific; 18 of 19 =
suggestive, do not act; **anything weaker = cycle 9 was period-specific, the
edge does not generalise, and that is the answer, not a prompt to try more
windows until one works.**

Separately, a 5-asset subset (TRXUSDT, LTCUSDT, BNBUSDT, XLMUSDT, XRPUSDT) was
frozen at 22:21:30 with this job mid-flight, ranked on cycle 9's SEARCH window
so selection and evaluation used non-overlapping data.

## 2. Does the output answer THAT question, or a neighbouring easier one?

It answers it, unambiguously.

    statistic        real        best null    worst null   beats
    net $        -6,375.75        -806.96     -4,703.23    0/19
    median $        -13.29          -5.09        -27.18   13/19
    win %            41.8%          47.1%         38.2%    7/19
    $ / trade      -0.2291        -0.0237       -0.1597    0/19
    vs hold $    -8,007.91      -2,154.27     -6,062.45    0/19

Sanity gate passed: 19/19 scrambles lose money.

**The real arm is worse than the WORST of nineteen scrambled worlds** on the
declared primary, on money per trade, and against buy-and-hold. Invariants
passed first (real arm not bit-identical to any scramble), so unlike cycle 10
this is a real measurement.

**Verdict per the declared rule: the edge does not generalise. Cycle 9's result
was period-specific.**

The declared subset failed harder: real -$3,542.15 against a scramble median of
**+$962.02**, beating 0/19. The concentration hypothesis — that a pooled test
was diluting an effect living in a few assets — is dead, and it was tested
exactly once, on data that did not choose it.

## 3. What does the metric COUNT that it should not?

**I went looking for a reason the metric was unfair to the real arm, and found
the opposite.** The primary (total net $) beat 0/19 while the median setup beat
13/19, a gap that can only come from extremes — so I checked whether outliers
were deciding it:

    real arm:   worst 5 setups = 63.3% of its total
    scrambles:  worst 5 setups = 89.8% of total (median across 19)

The real arm is **less** outlier-dominated than a typical scramble. The metric
treats both arms alike, and my suspicion is retired rather than left hanging.

## 4. What does the metric OMIT that it should include?

Nothing new. The overlap between daily-1d..4d remains the thing that makes one
asset's failure count four times — see Q6.

## 5. Are the two compared arms the same population?

Yes — both from ONE job, one build, one data range, one code path. That is the
structural fix that shipped after cycle 8, and this is the first run to benefit
from it.

## 6. Is any part of the reported number achievable with NO skill?

Inverted this time, and it is the useful finding. **Doing nothing clever beat
the model.** The scrambles all lost money and the real arm lost more.

The mechanism is concentrated and identifiable:

    -1,027.43  XRPUSDT  daily-3d  argmax
      -981.92  XRPUSDT  daily-4d  argmax
      -854.87  XRPUSDT  daily-2d  argmax
      -750.45  XRPUSDT  daily-1d  argmax
      -419.50  BCHUSDT  daily-3d  directional

The four worst setups are the SAME ASSET in four overlapping geometries — one
failure counted four times, because daily-1d through daily-4d step one day at a
time and differ only in lookback.

**XRPUSDT was in the declared subset**, ranked 5th on cycle 9's search window.
The asset that looked strongest on the selection window is the one that blew up
out of sample. That is textbook overfitting to a period, and the
selection/evaluation separation is what exposed it.

## 7. Would this number look the same on pure noise?

No — it is materially WORSE than noise. Nineteen scrambled worlds all lost
money; the real configuration lost more than any of them.

## 8. What did I assume and not verify?

- *That the primary metric might be unfairly outlier-driven.* CHECKED, and
  false — Q3.
- *That fees might explain a weak result.* **FALSE, and it kills the next
  planned step.** The scrambles pay the identical fee and the real arm did worse
  than all of them. A cost assumption cannot produce that. This failure is
  predictive, not cost-related.
- *That this window was comparable in difficulty.* It was not: scramble median
  -$2,977 here against -$2,268 in cycle 9's window, so trading anything cost
  roughly 2x more. That does not rescue anything — the comparison is
  within-window — but it is worth recording.
- OPEN: why cycle 9 and cycle 11 disagree so violently on identical code is not
  yet explained beyond "different period". XRP is a large part of it, not
  demonstrably all of it.

## 9. Is the previously planned next step STILL correct?

**No, and the reason matters more than the substitution.**

Planned: a fee sweep, approved by the owner. **Its premise is gone.** The fee
sweep existed to ask whether cycle 9's 1.6-point edge survived realistic
execution costs. But cycle 9's edge does not survive a different *period*,
which is the more fundamental failure — and fees cannot be the cause, because
every scramble paid the same fee and the real arm still came last. Sweeping the
fee now would measure the cost sensitivity of a result we know is
period-specific.

What is NOT retired, stated carefully because "no candidate is retired on one
measurement" is a standing rule:

- **Retired:** the claim that this configuration family produces a tradeable
  aggregate edge. That is not one marginal measurement — it is a failed
  REPLICATION, 0/19 on two independent declared tests, with the real arm below
  every scramble. Replication failure is exactly what is permitted to retire a
  candidate.
- **NOT retired:** the mechanism itself, and specifically the parameters inside
  it that have never once been tested — trailing stops, the dormant band,
  weekdays, the trade-count floor. Those are untested, not disproven, and the
  owner's instruction is to take singles to full depth before any
  bigger-picture change.

Next: **trailing stops**, the parameter the owner has raised twice and that has
been off in all eleven runs. Run on the EARLIER window first, because it is the
harder one, with the rule declared in advance that trailing must clear BOTH
windows to count for anything — a single-window pass is precisely the mistake
cycle 9 made.

## 10. New QC-REGISTER entries

- **45** — assuming a suspicion about a metric will favour the arm you are
  suspicious on behalf of. I checked whether outliers were unfairly sinking the
  real arm; they were sinking the scrambles harder. Check the direction, do not
  assume it.
- **46** — assuming an approved next step survives its own premise. The fee
  sweep was approved before the result that removed its purpose existed. An
  approval is for a question, not for a job.
- **47** — assuming overlapping geometries give independent evidence. One
  asset's failure appeared as the four worst setups because daily-1d..4d are
  re-cuts of the same days. Report per-asset concentration alongside any total.
