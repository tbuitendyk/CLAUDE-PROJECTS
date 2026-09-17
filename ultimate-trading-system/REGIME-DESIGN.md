# Knowing which market you are in, and what that is allowed to decide

Written 2026-09-16. **Nothing in here is built. Nothing will be until the owner
says so, release by release.**

## Why this document was rewritten on the day it was written

The first version was called "Trading a falling market". The owner's answer:

> "If you've made a document specific to trading in a falling market that's bad
> design of the design itself. Why would we target 'a falling market'? Makes no
> sense... rewrite it properly to deal with market movements generally."

They are right, and the fault is worse than a title. That version decided **in
code** that there are exactly two markets and that the thing separating them is
direction. Both of those are the owner's to choose and neither was exposed
(RULE FIVE). It is the same fault as the `confirm` dial it was written to
replace, one level up: `confirm` hardcoded a pull per coin, and I hardcoded the
axis the whole design turns on.

And the measurements agree with the owner. Asked properly — five different
backward-looking readings, each cut and judged the same honest way — **direction
performs exactly at chance and no better than any other reading.** I had picked
it because `TREND-TRAINING-DESIGN.md` picked it. That is inherited framing, not
evidence, and Part 1.3 is what it looks like when it is tested.

## What this replaces

- **`TREND-TRAINING-DESIGN.md`** — the owner's design for sorting history into
  rising and falling stretches and training two sets of forecasts on it. Its
  section B insight survives and is the key to Part 3. Its section F does not,
  for a reason measured in 1.4. Its two-states-and-they-are-directions shape is
  the thing this document generalises.
- **`LEAN-DESIGN.md`** — written 2026-09-15. Part A rests on a premise its own
  success rule falsifies. Parts B and C are untouched and stand on their own.
- **`COINS.md`** section 11 — the design of the `confirm` dial. Built, shipped,
  run on real data, measured in 1.1. It loses money.

Three kinds of thing are kept apart, as in `TREND-TRAINING-DESIGN.md`:
**what was measured** (Part 1, every figure read off the owner's box through a
named read-only probe listed in the appendix), **what that means for the
existing designs** (Part 2, findings not decisions), and **what I propose**
(Parts 3 and 4). The owner's decisions are Part 5 and none is made here.

---

## Read the words first

Every word below is on a screen, or plain English, or explained here. Where a
thing has no name on any screen this says so rather than borrowing one out of a
file (RULE ONE-A).

| Word | Where it is legal | What it means |
|---|---|---|
| Data, Coins, Sweep, Boards, Funnel, History, Tune, Held, Reserve, Greenlight, Help | the tab strip | read out of `TABS` in `public/construct.js` this session |
| `confirm` | **Sweep** (a box), **Boards** (a column) | the dial this document retires. Values `off`, `confirmed only`, `sized` |
| `verdict`, `held-back verdict` | **Boards** (columns) | the word the `confirm` dial's scoring prints: `adds nothing`, `just leverage`, `adds value`, `better signal` |
| `unconfirmed ×` | **Sweep** (a box) | the size given to a trade the coin's own pull disagreed with |
| `window layout` | **Sweep** | the division of a coin's history. `70/15/15` or `61/13/13/13 (sealed exam)` |
| `chunk shape` | **Sweep**, **Boards**, **Funnel** | which shape of period the system steps in |
| `decision`, `band % (or auto)` | **Sweep** | two of the four plain dials a block permutes |
| train, test, held, reserve | the owner's words | the four stretches a coin's history divides into. Used exactly as they are, at every reading level (RULE ONE-D) |
| **a reading** | **nowhere yet** | one number about a coin's recent past, worked out only from periods that finished before the decision. Five are measured below |
| **a state** | **nowhere yet** | which band a decision falls in, once a reading is cut into bands. Nothing on any screen does this, so nothing names it. If it is built it gets a screen name then and this document is rewritten to use it |
| **coverage** | **nowhere yet** | how much of a rule's evidence came from each state. Spelled out everywhere below |
| the coin's own pull | hover text on **Boards** and **Sweep**, not a name | a fixed pair of signs per coin and `chunk shape`, one for when the coin's window move was above a level and one for below, saying which way a trade should go. What `confirm` reads |
| the window move | **nowhere** | how far a coin moved across the stretch of prices a forecast reads, ending at the price it enters at |

**`SCREEN-WORDS.md` is stale** — `SERVED.json` is pinned at 3.148.0 and the box
runs 3.156.0 — so every name above was read out of the rendering code in this
session instead. Re-capturing the served record is deferred and is not part of
this design.

---

# Part 1 — What was measured on the box

Eighteen coin records, read 2026-09-13 under release 3.127.2. Six stage 3 record
sets froze coin findings onto themselves; two ran with `confirm` set to `sized`
on every row, four ran with it permuted.

## 1.1 — What the `confirm` dial actually bought

With `confirm` at `sized` and the multiples at their defaults (×2 for a trade the
coin's own pull agreed with, ×1 for one it disagreed with) the dial's whole
effect on the money is to add the agreed-with money a second time. The
comparison is exact, not modelled:

| record set | at one clip | under the dial | rows it made better / worse |
|---|---|---|---|
| S3-Pasers#3b — `sized`, 45,732 rows | −1,399,699 | **−2,307,102** | 6,091 / **31,131** |
| S3-Pasers#3c — `sized`, 7,052 rows | −2,046,860 | **−2,635,794** | 1,603 / **4,788** |
| S3-Pasers#1b — permuted, 13,416 rows carrying the numbers | −276,674 | −262,012 | 3,794 / 1,456 |

On both sets where it truly ran, doubling the agreed-with trades **lost** —
907,403 and 588,934. Its own `verdict` says `adds nothing` on 31,373 of 45,732
rows and 4,854 of 7,052.

These are sums over tens of thousands of settings, most of which lose anyway.
The level is not the claim. The **difference** is, and the difference is the
dial's own contribution and nothing else's.

## 1.2 — The finding that has no direction in it: the mix moves

Five readings of a coin's recent past, every one worked out only from periods
that finished before the decision, every one cut into thirds **using the train
part's own distribution and then applied unchanged to test, held and reserve.**
So train is even thirds by construction, and any imbalance elsewhere is the
market changing under the rule.

**Daily 4-day, eighteen coins pooled — the share of decisions in each third:**

| reading | train | test | held | **reserve** |
|---|---|---|---|---|
| which way it has gone | 33 / 33 / 33 | 27 / 44 / 28 | 27 / 46 / 27 | **49 / 38 / 13** |
| how much it has been moving | 33 / 33 / 33 | 68 / 24 / 8 | 51 / 30 / 19 | **73 / 20 / 7** |
| where it sits in its range | 33 / 33 / 33 | 33 / 36 / 32 | 29 / 38 / 33 | **52 / 29 / 19** |
| how far off its high | 33 / 33 / 33 | 32 / 37 / 31 | 35 / 38 / 27 | **21 / 29 / 50** |
| how the plain trade has done | 33 / 33 / 33 | 26 / 50 / 24 | 20 / 51 / 28 | **44 / 43 / 13** |

Read the "which way it has gone" row against the money. The third that made the
rule its money on train (+0.515% a decision, against +0.195% and +0.216%)
supplies **33% of train's decisions and 13% of the reserve's**. On "how much it
has been moving" the best third on train (+0.698%) supplies **7%** of reserve.
Daily 2-day says the same: 33% falling to 13%.

**That is the whole held-against-reserve result, with no direction in it at all.**
Held's mix is close to train's — 27/46/27 against 33/33/33 — and the rule worked
on held. Reserve's mix is nothing like train's, and the rule failed. The sealed
stretch is a market the rule barely saw, measured five different ways, and every
one of the five says so.

It is also why this cannot be fixed by choosing a better reading. They are all
reading the same underlying fact.

## 1.3 — No reading predicts. Direction least of all.

The honest test: on train, find the third that paid best and the third that paid
worst. Carry those two thirds forward untouched. Does the good one still beat the
bad one? Per coin, so one coin cannot carry a pooled figure.

**Coins out of 18 keeping train's order:**

| reading | Daily 2-day held / reserve | Daily 4-day held / reserve |
|---|---|---|
| which way it has gone | **9** / 8 | **9** / 11 |
| how much it has been moving | 5 / 5 | 6 / 6 |
| where it sits in its range | 3 / 12 | 7 / 10 |
| how far off its high | 8 / 12 | 11 / 12 |
| how the plain trade has done | 9 / 10 | 8 / 8 |

**Chance is 9 of 18.** The median across the ten combinations is 8.5 on held and
10 on reserve. Direction lands on exactly 9 and 9. Nothing here separates, and
the two readings that look best on reserve (12 of 18) are well inside what
eighteen coin flips produce.

Two things follow, and the second is the important one.

**Direction has no claim to be the axis.** It is one reading among five, at
chance, and the design must not be built around it — which is what the owner
said before any of this was measured.

**Cutting the thirds on train alone is what makes them look unimpressive.** That
is not a disappointment, it is the point. `COINS.md` chose its band by
maximising money on test plus held and produced a plateau that looked
convincing and then lost real money (1.1). Done honestly, this is what a
backward-looking reading of the market actually delivers: it tells you where you
are. It does not tell you what happens next.

## 1.4 — Could the forecasts see any of it? No.

All 21 per-asset and 5 cross measurements in `lib/features.js` are computed from
the candles of the chunk's own window and nothing else — 96 hours on Daily
4-day. `trend_slope`, `max_drawdown` and `close_in_range` exist, but only inside
those 96 hours.

Measured against a 60-period reading: a Daily 4-day forecast's own 4-period view
agrees on **57.5%** of decisions; Daily 1-day on 52.5%; Weekly 8-day on 52.2%.

A forecast cannot tell which market it is in, whatever reading names it. That is
measured, not argued, and it decides against `TREND-TRAINING-DESIGN.md`
section F.

## 1.5 — What a new measurement block would cost (RULE ONE-C)

Read off the box, nothing running: 28 record sets carry a stamp; **thirteen are
on measurement block 3** — every stage 1, stage 2 and stage 3 set. Fifteen stage
4 sets stand on those. Recorded run time on disk is 184.6 hours, of which
**S3 #1c alone is 180.6 hours, paused.**

A new block makes all thirteen refuse as parents and the fifteen go with them.
**That is the bill. It is the owner's decision, never a session's.**

## 1.6 — Faults in my own instrument, before anybody finds them

- **One line of the five-reading probe is broken and its number must be
  ignored.** It printed "a forecast's own window lands in the same third on
  100.0% of decisions" — because I passed the same geometry to both sides of the
  comparison, so it compared the reading with itself. The real figure is the
  57.5% in 1.4, from a different probe that genuinely shortens the window.
- **Weekly 8-day is excluded from everything above.** Its window move averages
  six hours of price spanning three hours **past** the entry
  (`lib/dataset.js:213-218` against `entryOffsetH = 195`) and shares that average
  with the outcome. Anything measured on that shape is contaminated. The first
  version of this document reported Weekly figures anyway; they are gone.
- **The trailing readings are built from window moves, which overlap.** On Daily
  4-day a 96-hour move is counted every 24 hours, so each period enters about
  four times. Valid as a trailing reading, not a clean 60-day return; a built
  version computes from closes directly.
- **Every figure is gross.** The round trip is 0.25% on a $100 clip — larger
  than most of the per-decision numbers above. Mixing the fee in would have
  hidden which half of the reserve failure is the market and which is cost.
- **An earlier attempt was wrong and is kept on the record**: a fall-from-peak
  label measured in summed percentage points put 90% of decisions in one bucket,
  so it was measuring "not at a 400-day high" and the buckets could not differ.
- **The per-coin test in 1.3 is a coin flip on 18 coins.** Twelve of eighteen is
  not significant; it is reported as the raw count precisely so nobody reads
  significance into it.

---

# Part 2 — What that means for the existing designs, including my own

## 2.1 — The `confirm` dial: retire it

**It loses** (1.1), and **three of the four things driving it are chosen knowing
the answer**: the sign is fitted on train (`leansOn`, `lib/coinsignal.js:63-71`,
the one honest part), but the band is picked by maximising edge on test plus held
(`findPlateau`, `lib/coinsignal.js:180-213`), whether a coin carries a pull at
all is decided the same way (`lib/coinsrun.js:489-490`), and the yardstick is a
median over the whole record (`lib/coinsrun.js:499`). The Coins split is never
tied to a run's split, so on a run pinned to older months even the sign can be
fitted on the periods it later prices.

**And it can never reach live.** `lib/live/greenlight.js:66-70` refuses a
survivor priced with `confirm` past `off`, in words, while the **Funnel** treats
`confirm` as a dial it may cut on (`lib/funnel.js:31`). So the **Funnel** can
hand the owner a rule that passes **Held** and **Reserve** and can never be
greenlighted — after every hour of pricing is paid for.

## 2.2 — `TREND-TRAINING-DESIGN.md`: section B is the key, section F cannot work

Section B's central claim is right and everything in Part 3 rests on it:

> "The type is only ever used to build what the forecasts are trained towards.
> Nothing reads it at trade time."

Two things generalise out of it. **Two types is a choice, not a fact** — the
number of states and what divides them belong on a screen (RULE FIVE). And 1.3
says direction has no claim to be the divider.

Section F breaks on 1.4. It asks each forecast to be doubled and each copy taught
to say nothing outside its own type. **A forecast has no input that carries the
distinction** — 57.5% at best. Silence cannot be learned from numbers that do
not contain it; a model asked to will learn something that correlates locally and
fail out of sample, which is exactly what the reserve stretch exists to catch.

## 2.3 — `LEAN-DESIGN.md` Part A: the premise is falsified

Part A assumes the committee leans long and its own rule A1 is the test. On the
owner's LTC/DOGE/LINK unit the capture reads 50.8% long on train. **Releases 5
and 6 of that document must not be built unrewritten.** Parts B and C are
untouched by any of this.

## 2.4 — And the first version of this document

It targeted a falling market, which fixed the number of states at two and the
divider at direction, in code. Recorded here rather than quietly replaced,
because it is the same class of failure as 2.1 and it happened while writing the
fix for it.

---

# Part 3 — The design, with no direction in it

Three pieces, in strict order of how much they claim. **Each is a separate
control and each is judged separately.** The first claims nothing and is
therefore the one the measurements already support.

## 3.1 — A reading, a cut, a state. All of it the owner's.

A **reading** is one number about a coin's recent past, worked out only from
candles complete before the entry. The system offers readings; it does not choose
them. Five are already measured (1.2) and there is nothing special about the
five:

- which way it has gone, over the last K periods
- how much it has been moving, over the last K periods
- where it sits inside its own recent range
- how far it is off its recent high
- how the plain trade has been doing lately

A **cut** turns a reading into bands: how many, and where. Thresholds are the
coin's own quantiles taken from **train alone**, or numbers the owner types.
Never, under any circumstance, chosen by looking at test, held or reserve —
that is 2.1's fault and it is what makes a reading look good and lose money.

A **state** is which band a decision lands in. One reading cut in three gives
three states; two readings cut in three give nine. **The system does not care and
must not care.** The owner composes the state on **Sweep** from the readings, the
lookbacks and the cuts, exactly as they compose every other block, and the
**Funnel** cuts on it like any other dial.

The floor that keeps this honest: a minimum number of decisions per state, set on
screen. More states means fewer decisions each and more ways to fit noise. A
composition that puts fewer than the floor in any state is refused in words, not
silently averaged away.

## 3.2 — Coverage: what a rule's evidence is made of. Claims nothing. Always on.

For every rule, in every state: how many of its decisions came from there, and
what it made there. On **Boards**, on **Held**, on **Reserve**, beside the money
it already shows.

**This is not a prediction and it does not gate anything.** It is arithmetic on
records that already exist. It is true whether or not any reading predicts
anything, which is precisely why it comes first — 1.3 says no reading predicts,
and 1.2 says the mix moves anyway, and coverage is the part of the design that
only needs the second to be true.

What it buys, in one sentence: **a rule that earned all its money in a state the
sealed stretch barely contains is visible as such before it is trusted, instead
of afterwards.** On Daily 4-day that is the difference between 33% and 13% of the
decisions, and it is the whole of the owner's "the held worked great, the reserve
completely flopped".

## 3.3 — The mix line: how far the market has moved under the rule

One line per rule: how train's mix of states compares with test's, held's and
reserve's. The tables in 1.2 are that line, computed once per rule instead of
once by hand in a document.

Also arithmetic. Also claims nothing. It is the warning that a rule is about to
be judged on a market it was not chosen in.

## 3.4 — Gating, training and sizing: three things a state MAY be allowed to
decide, each optional, each earned separately

Only once 3.2 and 3.3 exist, and only on their evidence:

- **Gating** — a rule may be barred from trading in states where its evidence is
  thin. Justified by coverage, not by forecasting: the claim is "I do not know
  what happens here", which 1.3 supports, and not "I know what happens here",
  which 1.3 refutes.
- **Training** — a committee per state, which is section F's intent with the
  impossible part removed. A forecast is trained only on its own state's periods
  and only consulted there, so it is never asked to recognise a market it cannot
  see (1.4). The cost is real and stated: each forecast sees a fraction of the
  periods it sees today, and release R7's success rule is written to make that
  cost visible before anything is believed.
- **Sizing** — size scaled by the evidence in the state being traded. This is
  what the `confirm` dial tried and failed at (1.1); the difference is that the
  multiple would come from the rule's own measured record in that state rather
  than from a pull fitted on the judging stretch.

**No new measurement block is needed for any of it.** Nothing is added to what a
forecast reads, so every set on disk stays readable and 1.5's bill is deferred to
the last release and made conditional on evidence.

---

# Part 4 — The releases, with their success rules written first

Each ships on its own, names the digit it moves, and carries a success rule
**pre-registered here, before the numbers exist**. A release whose rule is not
met is reverted, not renegotiated (RULE SIX).

Ordered so that what claims least is built first, and so the cheap disproof comes
before the expensive build.

## R1 — the **Funnel** stops selling a dead end (third digit)

`confirm` removed from the **Funnel**'s list of dials it may cut on
(`lib/funnel.js:31`). Existing records keep every number; only the walk changes.

**Success.** No path through the **Funnel** produces a rule pinning `confirm`
past `off`; every existing Stage 4 record set opens and reads exactly as now;
the suite is green.

**Cost.** Minutes. Nothing on disk changes.

## R2 — the `confirm` dial deleted whole (second digit)

The box and the two multiple boxes on **Sweep**, the columns on **Boards**,
`lib/confirm.js`, the frozen findings written onto a set at launch, the refusal
in `lib/live/greenlight.js`, the help entry, the tests, the mutation guards. All
of it in one cut (RULE TEN).

**The obstacle, and it is the owner's (RULE NINE).** Six stage 3 sets carry the
dial on roughly 65,000 ranked rows. A reader that asks "was this written before
the dial went" is the legacy branch RULE NINE forbids, so one of two things must
happen and **only the owner chooses which**: migrate those six beside themselves
— same row count, same block boundaries, totals rebuilt — or delete them
(S3-Pasers#1a, #1b, #2a, #3a, #3b, #3c and the Stage 4 set standing on #3c;
about an hour of recorded run time between them).

**Success.** No screen names it; nothing in `lib/` reads it; the remaining sets
open identically; the suite is green; the count of sets carrying its fields on
disk is zero, **measured, not assumed**.

**Cost.** Half a day plus whichever the owner picks.

## R3 — readings, cuts and states, as controls (second digit)

The readings listed in 3.1, the lookback, the number of bands and the thresholds,
all on **Sweep**, all permutable, all cut on by the **Funnel**, all carried onto
every record and shown on **Boards**. Plus the floor on decisions per state,
refusing in words.

**No trading changes.** Nothing is gated, nothing is sized, no forecast is
retrained. A record simply gains which state each of its decisions was in.

**Success, all three.** (1) Every threshold on every record is reproducible from
the train part of that run alone — checked by recomputation, not by reading the
code. (2) A composition leaving any state under the floor is refused by name, and
no state under the floor ever reaches a table. (3) The suite is green and no
existing record set's money changes by a cent.

**Cost.** Two to three days. No re-run of anything.

## R4 — coverage and the mix line (second digit)

3.2 and 3.3 on screen: each rule's decisions and money broken down by state on
**Boards**, **Held** and **Reserve**, and the line saying how far each stretch's
mix has moved from train's.

**Success.** On the owner's existing sets, the per-state decision counts sum
exactly to the rule's total decision count and the per-state money sums exactly
to its total money — arithmetic, checked on stored rows. And, stated before it is
run: on the LTC Daily 4-day unit, the reserve mix line must show the largest
movement of the four stretches. **If it does not, 1.2 is wrong and R5 onward are
abandoned** — that is a real and acceptable outcome, and it costs four days, not
four weeks.

**Cost.** Two days.

## R5 — gating, optional, judged like any other dial (second digit)

A control letting a rule be barred from states where its evidence is thin, with
the bar the owner's to set.

**Success, all three.** (1) It clears the **Funnel**'s scrambled copies at the
owner's bar, on the same terms as every other dial, with no exception and no
special pleading. (2) Every parameter was fixed before the run. (3) On one unit
named before the run, the gated rule beats the ungated rule per trade on
**reserve**, **net of the fee**, by more than the scrambled copies allow.

Rule 3 is the hard one and is meant to be. Rules 1 and 2 are cheap and come
first, so a failure costs hours.

**Cost.** Two to three days.

## R6 — the cost floor (second digit, independent of everything above)

The other half of the reserve failure, already measured: the plain rule made
**+41.33 gross a setting, 0.227% a trade, against a 0.25% round trip.** Its
break-even fee is 0.1137% a leg against the 0.125% priced — 0.013 percentage
points from paying for itself.

A floor, set by the owner on screen, refusing a setting whose gross per trade does
not clear the round trip by a stated margin, shown on **Boards** beside the money.

**Success.** Every setting the floor refuses has gross-per-trade below the round
trip plus the margin and no setting above it is refused, checked by arithmetic on
stored rows, not by eye.

**Cost.** A day. Buildable in parallel with anything.

## R7 — a committee per state (second digit)

**Only if R5 passes.** Stage 1 trains one committee per state on the same
measurements; the state decides which is consulted. No forecast is asked to
recognise a market it cannot see.

**Success.** On held, before reserve is opened: each committee beats the single
committee on its own state's periods for at least twelve of eighteen coins, and
the set of them beats the single committee overall. **The first task of R7 is to
measure the training and pricing cost and report it to the owner before the build
continues.**

## R8 — readings inside the measurement block (FIRST DIGIT — the owner's call)

**Only if R5 and R7 both pass, and only if their evidence says the forecasts
would do better with the readings in their own inputs.**

Trailing readings added to the block, every one computed from candles that close
before the entry.

**The bill, restated because it must not be buried: thirteen record sets on
measurement block 3 refused, the fifteen Stage 4 sets standing on them gone with
them, and S3 #1c, paused at 180.6 hours, lost.** The owner decides having read
that sentence, and nothing here decides it for them.

**Success.** On one unit, everything else identical, a committee trained with the
new measurements beats the R7 arrangement on held before reserve is opened.
Otherwise the block is reverted before any further set is built on it.

---

# Part 5 — What only the owner can decide

1. **R2's six sets: migrate or delete?** About 65,000 rows carry the dial.
   Re-running is about an hour; migrating is a day and carries its own risk.
2. **Is R1 wanted, or does R2 make it moot?** R1 is minutes and stops a wasted
   walk today; R2 removes the dial entirely days later.
3. **Which readings ship in R3.** The five in 3.1 are what has been measured.
   None is privileged and I am not proposing one — that is the whole correction
   this document exists to make.
4. **The floor on decisions per state**, and the default number of bands.
5. **Which unit R5's third rule is judged on.** Named before the run.
6. **Whether Weekly 8-day is fixed or excluded.** Its window move reads three
   hours past the entry (1.6). Until that is fixed, no measurement on that shape
   means anything — including any in this document.
7. **R6's margin** above the round trip.
8. **R8's bill**, in full, and only when R5 and R7 have earned the question.
9. **Whether `LEAN-DESIGN.md` Parts B and C proceed in parallel.** They are
   untouched by any of this.

---

# Part 6 — Defects found and reported, not fixed

**None has been touched** (RULE ZERO).

1. `setStopChoice` replaces the whole choice record while `setSizingChoice`
   merges, so applying a stop or pressing save on the reason silently deletes a
   sizing choice. Live on the half-life set's
   `conviction 50% own market t89h · argmax auto 24/7`.
2. A trade taken when no member agrees is sized at a full clip — the multiple
   lookup falls back to 1.
3. The conviction sweep's bucket loop starts at 1, so the no-agreement bucket is
   in every total and in no bucket.
4. `committee.COPY_DEFAULT` is undefined in `lib/live/stagesignal.js`.
5. Reserve chunks keep a band-free label.
6. A stale comment describes a `window layout` that was deleted.
7. Half a committee can be trained two ways.
8. **Weekly 8-day's window move reads three hours past the entry and shares its
   average with the outcome** (`lib/dataset.js:213-218`). A real look-ahead in
   shipped code, and the most serious on this list.
9. The Coins sweet-spot band and the passer choice are fitted on test plus held,
   whose held overlaps the sealed reserve. Goes with R2.
10. Two false statements: "Sweep trains with this same number"
    (`public/construct.js:8727-8731`, already recorded as untrue in
    `COINS.md:509-514`) and "the two never overlap" (`lib/windowmove.js:27-28`,
    false for Weekly 8-day).
11. A board row carries `confirm` but not the six numbers or the word
    (`boardRowOf`, `lib/stages.js:1138-1165`). Goes with R2.

---

# Appendix — where every number came from

Read-only scripts on the `vps-access` branch, run through
`bash .claude/vps-run.sh <name>`. None writes anything or starts anything.

| script | what it produced |
|---|---|
| `uts-coins-status.sh` | the 18 records, the 11 plateaus, the saved band |
| `uts-confirm-used.sh` | which sets froze findings and which ran the dial |
| `uts-confirm-rows.sh` | the dial's values across the ranked rows, per set |
| `uts-confirm-six.sh` | the `verdict` word counts and the six numbers |
| `uts-overlay-ledger.sh` | 1.1 — at one clip against under the dial |
| `uts-regime-truth.sh` | a badly-scaled first attempt, kept for the record (1.6) |
| `uts-regime-truth2.sh` | 1.4's 57.5% — the only sound reading of what a forecast can see |
| `uts-state-readings.sh` | 1.2 and 1.3 — five readings, thirds cut on train alone |
| `uts-block-cost.sh` | 1.5 — the sets, their blocks, and 184.6 hours |

**Two corrections belong here.** An earlier reading of this question reported
that the box held no coin records and had never run the dial; that was read out
of the sandbox this session runs in rather than
`/opt/ultimate-trading-system/data/` on the box, and every part of it was false.
And the first version of this document, written hours earlier, built its whole
design on direction. The owner caught both.

---

## Part 7 — Choose early, read late (3.161.0, written before the numbers)

Every figure the walk prints was priced knowing only what sat behind it, so the
money was never the doubt. **The choice was.** The look-back and the band that
produce the best-looking rows were picked by reading the whole table — 7,850
rows of it on 2026-09-17 — and a choice made with the answer in view is not a
choice anybody could have made at the time.

**The reading.** For each coin and shape, cut its windows in two. Rank its rows
on the **early** windows alone, take the best one, and report what that one row
did on the **late** windows, which the choosing never saw. Nothing is re-walked
and no window is re-priced: the per-window strip the walk already keeps carries
everything.

**The null is picking blind.** A pick must beat what a row taken at random from
the same coin and shape would have paid on those same late windows — because a
coin whose every row pays looks like a good choice however the choice was made.
The pick's percentile among its own rows on the late windows says it more
finely: with no skill in the choosing, a pick lands at about 50.

**The pass mark, fixed before the run (RULE SIX):**

- **PASS** — the picks beat picking blind on **at least 60 of 90** pairs (45 is
  chance), **and** the picks' pooled late money clears the **0.25% round trip**
  the system charges itself (0.125% a leg, `lib/paper.js`).
- **FAIL** — 50 of 90 or fewer, **or** pooled late money at or under 0.25%.
- **51 to 59** — inconclusive, and to be reported as inconclusive rather than
  argued either way.

**What it cannot settle.** One market epoch, 2019–2026, measured once. A pass
says the choosing carried something across that stretch; it does not say the
same look-backs will be the right ones in five years.

**What was measured.** The run was started with the owner's own parameters,
read back off the box before the deploy that carried this code: window 6
months, 12 months behind the first window, bands 200/250/300/350, no
sweet-spot band, usual move trailing, leaning learned before each window, 100
copies each way, floor 3, every coin, look-backs 24h to 504h in 24s. 7,920
rows, finished 2026-09-17 08:55 UTC. Read at `minTrades` 30 and the cut at
half.

**PASS.** 76 of the 90 coin-and-shape pairs had 30 trades in both halves. The
picks beat picking blind on **56 of 76** (chance 38; the bar scales with the
readable count, which was written into the code before the run, and came to
51). Pooled late money **+0.874%** a trade, **+0.624%** after the 0.25% round
trip. 55 of 76 picks pay after that round trip. The average pick landed at the
**65.8th** percentile of its own rows on the late windows, where 50 is no
skill. 32 of 76 chose a look-back of 240 hours or more.

**And the pass survives the one thing that could have killed it.** Once a
look-back is given in HOURS, a chunk shape's own span no longer decides what is
looked at; all that is left of the shape is when the trade opens and closes,
and those coincide in pairs. `daily-1d` opens 25 hours into its chunk and
closes at 42; `daily-2d` at 49 and 66 — exactly one 24-hour step later, so its
chunk *i* is `daily-1d`'s chunk *i+1*. `daily-3d` (73, 114) and `daily-4d`
(97, 138) are the same pairing. So the four daily shapes are **two units seen
twice**, and 90 pairs are about 45.

Collapsed by hold length — 17 hours, 41 hours, and the weekly shape's 60 — the
76 pairs become **40 units**, and the same pass mark still passes: **29 of 40**
beat picking blind against a bar of 27, pooled late unchanged at +0.874%,
average percentile 66.8. It is a pass by two units, not a comfortable one.

Measured rather than assumed: of the 36 units where both twins were readable,
12 agreed to within 0.02% and the widest disagreement was 2.585%. They are
heavily overlapping, not identical — the divergence is mostly where the early
half chose a different look-back for each twin.

**What is weak in it, found before anybody asked:**

- **The pass is narrow on the honest count** — 29 of 40 against a bar of 27.
- **The late half is thin.** 377 late windows across 40 units, about nine each,
  and some rest on far fewer: TRX at the 17-hour hold reads the 96th percentile
  on **two** late windows, and XRP at 60 hours on three. Those are noise
  wearing a score.
- **Picking blind already paid.** Median blind late money was +0.436% a trade —
  above the round trip on its own. So of the +0.874% pooled, only about a
  quarter of a point is the CHOOSING; the rest is the whole family of rows
  being positive on this history. The lead column is the part this test earned.
- **One epoch**, cut once: early is roughly 2019–2022, late 2022–2026.
- **It is not one coin.** The best picks are XLM, ZEC, XRP and ATOM; LTC is
  fifth and seventh. The earlier every-window-up filter put LTC in ten of its
  eleven rows, which was a different question and a different answer.
