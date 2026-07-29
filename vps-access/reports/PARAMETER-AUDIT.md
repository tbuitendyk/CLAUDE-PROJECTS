# Parameter audit — what has been held fixed, and whether on purpose

Owner, 2026-07-29: narrow fields are the right tool; narrowing by inertia is
not. Every setting below is either held fixed ON PURPOSE with a revisit date,
or was silently frozen and is now named.

| setting | value in all 10 cycles | fixed on purpose? | revisit |
|---|---|---|---|
| `sizes` | singles only | **NO — inertia.** Doubles were in the first overnight sweep; singles was set around cycle 1 to keep the null clean and then copied ten times | after trailing |
| `trailing` | off | **NO — inertia.** Approved by the owner days ago, never once enabled | next after cycle 11 |
| `feePerLeg` | 0.125 | **NO — WORSE.** Hard-coded in the orchestrator, unreachable from any launcher. Now exposed | immediately — see below |
| `permute.band` | false (always `auto`) | **NO — inertia.** The dormant band defines what counts as "flat", so it shapes every label | after doubles |
| `permute.weekdays` | false (always 24/7) | **NO — inertia.** 24/5 never tested | low priority, but named |
| `minTrades` | 10 | Partly. VERDICTS A1 argued a low-frequency lane exists; a flat floor of 10 can exclude rare-but-fat signals | with trailing |
| `promoteK` | 50 | Yes — it is the detail cap, not a hypothesis | n/a |
| `universe` | same 17 | Yes for comparability, but they are survivors: coins that died are absent. Affects both arms equally so it does not bias the null, but it does limit what the result generalises to | named, not scheduled |
| `dMults`/`tHours`/`gates`/`entries` | library constants | Effectively hard-coded like the fee was, though these ARE swept within each run | audit again after fee |
| `holdout` | true | Yes — deliberate and load-bearing | n/a |
| `labelShiftScope` | window | Yes — series was proven broken | n/a |

## Why the fee jumps the queue, ahead of trailing

I said trailing was next. It is not. Fee is, for three reasons:

1. **It decides whether anything else matters.** 86% of the gross edge goes to
   fees and break-even sits 16% above the assumed cost. If the edge dies at
   realistic execution costs, trailing and doubles are irrelevant.
2. **It expands nothing.** Varying the fee is a re-scoring of the same trades,
   not a new search dimension — so it cannot manufacture a lucky-looking
   winner. It is the cheapest possible test in selection-risk terms.
3. **It was unreachable until now**, which is the strongest argument that it
   has never been examined.

Order, one variable per run:

    cycle 12   fee sweep      0.10 / 0.125 / 0.20 / 0.30 / 0.40 per leg
    cycle 13   trailing on    singles, fee fixed at whatever 12 says is real
    cycle 14   doubles        trailing fixed at whatever 13 concludes
    later      band, weekdays, minTrades

Each with its own null, its own declared rule, and the two-minute preflight
first.
