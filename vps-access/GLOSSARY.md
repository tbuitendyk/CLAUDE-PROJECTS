# GLOSSARY — the fixed vocabulary (owner-ordered, 2026-08-01, v2)

One term per thing, forever. Ordered top-down: containers first, then
what runs inside them, in the sequence the system actually uses them.
Any new term is added HERE with a plain definition before first use in
any email, table, screen or report. Renames are forbidden without the
owner's approval; replaced words go to the Retired list.

## A. The containers

| Term | Means exactly |
|---|---|
| setup | the biggest unit: one coin + one chunk length + one voting style; each setup is its own complete walk through that coin's history; there are 136 |
| fold | one step of a setup's walk: train on the past -> audition dials on the test window -> score once on the holdout window; ~25-45 folds per setup |
| train window | within one fold: all history before the fold; members learn from this and nothing else |
| test window | within one fold: the next 8 weeks; where dial combinations audition |
| holdout window | within one fold: the 8 weeks after that, never seen during training or auditioning; the only money that counts |
| chunk | the smallest data unit: one bite of history (1-4 days of price and volume) that a member reads and votes on; windows are made of chunks |
| trade slot | the fixed trading opportunity attached to each chunk: the set moment right after the chunk when a trade could be entered, and the horizon it runs in; one chunk, one trade slot |

## B. The committee (works inside each fold, reading chunks)

| Term | Means exactly |
|---|---|
| member | one of the six models: three data views (prices only / volume only / everything) x two learner types (straight-line / flexible) |
| committee | the six members of one setup, retrained fresh at every fold on that fold's train window |
| voting style | how a member turns its reading into a vote; two styles (the x2 in the 136): most-likely-wins (up/down/flat compete; flat = don't trade) and direction-hunter (up vs down only; abstains when unsure) |
| vote | one member's output for one chunk: up, down, or stand aside |
| agreement level | a number 1-6: how many members must concur on a direction before that trade slot gets traded; set by trade dial 5 |

## C. The five trade dials (turn agreed votes into orders, per trade slot)

| Term | Means exactly |
|---|---|
| trade dial | one adjustable setting governing how votes become orders; exactly five exist |
| dial 1 - entry method | market: enter immediately at the trade slot's opening price in the voted direction; breakout: place tripwires above and below and enter only if price crosses one |
| dial 2 - gate | breakout only: which tripwires are armed. directional = only the voted direction's tripwire; active = a vote is required but both tripwires armed, price's break picks the direction; always = both armed on every slot, votes ignored (the vote-free floor voting must outbid) |
| dial 3 - tripwire distance | how far above/below the price the tripwires sit, as a multiple of the coin's typical move; the untouched tripwire doubles as the emergency exit |
| dial 4 - time limit | maximum hours a trade stays open before forced close at the going price |
| dial 5 - agreement level | the 1-6 consensus threshold from section B, chosen fresh each fold |
| dial combination | one complete choice of all five dials; one playable configuration |
| the menu | the list of all possible dial combinations (a few thousand) |
| the pick | once per fold: the whole menu auditions on the test window; the best-paying dial combination (minimum 5 trades) is frozen and scored once on the holdout window |

## D. The judging (after the walks finish)

| Term | Means exactly |
|---|---|
| board | the results table: one row per setup, built only from holdout-window money |
| always-long line | the tide gauge: what going long on every trade slot would have earned on the same windows; context only, judges nothing |
| luck committee | the scrambled-votes twin of the whole system - same members, dials, menu, picks, but votes slid off their dates so they know nothing; the judge: real skill must beat it |

## Retired words — never use again

recipe / trade recipe, cell -> dial combination
experiment -> setup
stretch, slice -> window
quorum -> agreement level (owner-facing text)
null arm -> luck committee (owner-facing text)
