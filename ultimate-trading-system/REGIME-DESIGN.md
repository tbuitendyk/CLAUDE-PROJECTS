# Trading a falling market: what was measured, and what to build

Written 2026-09-16 after the owner asked for the whole investigation to be redone
against the real box, with concrete steps. **Nothing in here is built. Nothing
will be until the owner says so, release by release.**

It replaces the reasoning in two earlier documents, and says plainly where each
of them is wrong:

- **`TREND-TRAINING-DESIGN.md`** — the owner's design for sorting history into
  rising and falling stretches and training two sets of forecasts on it. Its
  shape survives. Its section F does not, for a reason measured below.
- **`LEAN-DESIGN.md`** — written 2026-09-15. Its Part A rests on a premise that
  its own success rule falsifies. Do not build from it unrewritten.
- **`COINS.md`** section 11 — the design of the `confirm` dial. Built, shipped,
  run on real data, and measured below. It loses money.

Three kinds of thing are kept apart, as in `TREND-TRAINING-DESIGN.md`:

- **What was measured**, Part 1. Every figure was read off the owner's box
  through a named read-only probe, listed in the appendix so any of it can be
  re-derived.
- **What that means for the existing designs**, Part 2. Findings, not decisions.
- **What I propose**, Parts 3 to 5. Mine. The owner's decisions are listed
  separately in Part 5 and none of them is made here.

---

## Read the words first

Every word below is either on a screen, or plain English, or explained here.
Where a thing has no name on any screen, this says so rather than borrowing one
out of a file (RULE ONE-A).

| Word | Where it is legal | What it means |
|---|---|---|
| Data, Coins, Sweep, Boards, Funnel, History, Tune, Held, Reserve, Greenlight, Help | the tab strip | read out of `TABS` in `public/construct.js` this session |
| `confirm` | **Sweep** (a box), **Boards** (a column) | the dial this document retires. Its three values are `off`, `confirmed only` and `sized` |
| `verdict`, `held-back verdict` | **Boards** (columns) | the word the `confirm` dial's own scoring prints: `adds nothing`, `just leverage`, `adds value`, `better signal` |
| `unconfirmed ×` | **Sweep** (a box) | the size given to a trade the coin's own pull disagreed with |
| `window layout` | **Sweep** | the division of a coin's history. Two choices: `70/15/15` and `61/13/13/13 (sealed exam)` |
| `chunk shape` | **Sweep**, **Boards**, **Funnel** | which shape of period the system steps in |
| `decision`, `band % (or auto)` | **Sweep** | two of the four plain dials a block permutes |
| train, test, held, reserve | the owner's words | the four stretches a coin's history divides into. Used exactly as they are, at every reading level (RULE ONE-D) |
| **the regime** | **nowhere yet** | whether a coin has been rising or falling lately. Nothing on any screen does this, so nothing on any screen names it. Everywhere below it is spelled out: "whether the coin's own move over the last K periods was up or down". If it is built it gets a screen name then, and this document is rewritten to use it |
| **the gate** | **nowhere yet** | the proposed new control that reads that number and decides whether to trade. No name until it exists |
| the coin's own pull | hover text on **Boards** and **Sweep**, not a name | a fixed pair of signs per coin and `chunk shape`, one for when the coin's window move was above a level and one for below, saying which way a trade should go. This is what `confirm` reads |
| the window move | **nowhere** | how far the coin moved across the stretch of prices a forecast reads, ending at the price it enters at |

**`SCREEN-WORDS.md` is stale.** `SERVED.json` is pinned at 3.148.0 and the box
runs 3.156.0, so the generator cannot be trusted right now and every name above
was read out of the rendering code in this session instead. Re-capturing the
served record is on the deferred list and is not part of this design.

---

# Part 1 — What was measured on the box

Eighteen coin records exist on the box, read 2026-09-13 under release 3.127.2,
with the sit-out band saved at 50 and chosen automatically. Eleven coin-and-shape
pairs name a plateau: BCH (Weekly 8-day, Daily 1-day), LTC (Weekly 8-day,
Daily 3-day, Daily 4-day), ATOM (Daily 2-day), DOT (Weekly 8-day), ETH
(Daily 4-day), XLM (Daily 2-day), XRP (Daily 2-day), ZEC (Daily 4-day).

Six stage 3 record sets froze those findings onto themselves. Two of them ran
with `confirm` set to `sized` on every row; four ran with it permuted, so those
priced all three of its values.

## 1.1 — What the `confirm` dial actually bought

With `confirm` at `sized` and the two multiples at their defaults (×2 for a
trade the coin's own pull agreed with, ×1 for one it disagreed with), the dial's
entire effect on the money is to add the agreed-with money a second time. So the
comparison is exact, not modelled:

| record set | at one clip | under the dial | rows it made better / worse |
|---|---|---|---|
| S3-Pasers#3b — `sized`, 45,732 rows | −1,399,699 | **−2,307,102** | 6,091 / **31,131** |
| S3-Pasers#3c — `sized`, 7,052 rows | −2,046,860 | **−2,635,794** | 1,603 / **4,788** |
| S3-Pasers#1b — permuted, 13,416 rows carrying the numbers | −276,674 | −262,012 | 3,794 / 1,456 |

On both sets where the dial really ran, **doubling the trades the coin's own
pull agreed with lost money** — 907,403 on the first and 588,934 on the second.
Its own `verdict` column agrees: `adds nothing` on 31,373 of 45,732 rows on the
first and 4,854 of 7,052 on the second.

These are sums across tens of thousands of settings, most of which lose anyway;
the level is not the point and is not claimed to be. The point is the
**difference**, which is the dial's own contribution and nothing else's.

## 1.2 — Is there a falling stretch where selling pays?

**Yes, and it is knowable at the decision.** The label used is the sign of the
coin's own move over the last K periods, counted only from periods that finished
before the decision. It needs nothing from the future and it splits the history
roughly in half, so neither bucket is a rounding error.

**Daily 4-day, K = 60, pooled over all eighteen coins, gross per decision:**

| part | buying, after a fall | buying, after a rise | share of decisions after a fall |
|---|---|---|---|
| train | +0.182% (13,119) | +0.408% (15,942) | 45% |
| test | +0.208% (2,663) | +0.144% (3,800) | 41% |
| held | +0.237% (2,684) | +0.361% (3,779) | 42% |
| **reserve** | **−0.238% (4,187)** | **+0.211% (2,248)** | **65%** |

**That table is the answer to "the held worked great, the reserve completely
flopped."** The reserve stretch is two thirds falling-market decisions, where
buying loses 0.238% each. Train, test and held were all majority rising-market,
where buying wins. It is not a bug and it was not bad luck: the sealed stretch
is a different market from the three the rule was chosen on.

Weekly 8-day at K = 20 is starker still — 67% of reserve decisions after a fall,
buying −0.968% each against +0.385% after a rise. (That shape's figures carry a
fault; see 1.5.)

**But the label is not a signal.** Taking the side that paid on train and
carrying it forward untouched: in eight of the nine shape-and-horizon
combinations tried, train said buy in both buckets, so the rule was
indistinguishable from always buying. In the one case it said sell-after-a-fall
(Weekly 8-day, K = 60) it then **lost** on test (−0.065% against +0.107%) and on
held (+0.730% against +1.138%), and won only on reserve (+0.259% against
−0.521%). One win in nine, in the place that flatters it most, is not evidence.

**So the label describes which market you are in. It does not forecast.** That
distinction decides everything in Part 3.

## 1.3 — Could the forecasts see it? No.

All 21 per-asset measurements and all 5 cross measurements in
`lib/features.js` are computed from the candles of the chunk's own window and
nothing else. On Daily 4-day that window is 96 hours. `trend_slope`,
`max_drawdown` and `close_in_range` exist, but only inside those 96 hours.

Measured against the label above — how often the view a forecast actually has
agrees with the longer-horizon label:

| `chunk shape` | its own view | agrees with the K = 60 label |
|---|---|---|
| Daily 1-day | 1 period | 52.5% (against the K = 120 label) |
| Daily 4-day | 4 periods | **57.5%** |
| Weekly 8-day | 1 period | 52.2% |

**A forecast cannot tell which market it is in.** This is the finding that
decides against the shape of `TREND-TRAINING-DESIGN.md` section F, and it is
measured, not argued.

## 1.4 — What a new measurement block would cost (RULE ONE-C)

Read off the box, nothing running: **28 record sets carry a stamp. Thirteen are
on measurement block 3** — every stage 1, stage 2 and stage 3 set. Fifteen stage
4 sets stand on those. Recorded run time on disk totals 184.6 hours, of which
**S3 #1c alone is 180.6 hours, paused**.

A new measurement block makes every one of those thirteen refuse as a parent, and
the fifteen that stand on them go with them. **That is the bill, and it is the
owner's decision, never a session's.**

## 1.5 — Faults in my own instrument, before anybody finds them

- **Weekly 8-day's figures above are contaminated.** The label is built from the
  window move, and on that one shape the window move averages six hours of price
  spanning three hours **past** the entry (`lib/dataset.js:213-218` against
  `entryOffsetH = 195`), and shares that average with the outcome it is measured
  against. The Daily shapes are clean; Weekly 8-day is not. Its numbers are
  reported for completeness and must not be built on.
- **The trailing sum over-weights recent periods on the longer shapes.** On Daily
  4-day a 96-hour move is counted every 24 hours, so each period enters roughly
  four times. It is a valid trailing trend; it is not a clean 60-day return, and
  a built version should compute the number from closes directly.
- **Every bucket figure is gross**, before the fee. The round trip on the owner's
  set is $0.25 on a $100 clip, which is 0.25% — larger than most of the
  per-decision figures in the table. That is deliberate: mixing the fee in would
  have hidden which half of the reserve failure is the market and which is cost.
- **My first attempt at this measurement was wrong** and is recorded so nobody
  repeats it: a fall-from-peak label measured in summed percentage points put
  90% of all decisions in the falling bucket, so it was measuring "not at a
  400-day high" and the buckets could not differ. The balanced label above
  replaced it.
- **Nothing here is per coin.** Everything is pooled over eighteen. A per-coin
  reading is the first thing release R3 must produce, because one coin driving a
  pooled figure is exactly the failure this section exists to catch.

---

# Part 2 — What that means for the three existing designs

## 2.1 — `COINS.md` section 11 and the `confirm` dial: retire it

Two independent reasons, either sufficient:

**It loses.** Measured in 1.1, on the only two sets where it truly ran.

**It is a hindsight filter, not a reading of the market.** The per-period colour
is honest on the Daily shapes — the window move ends exactly at the entry price.
But three of the four things that drive it are chosen knowing the answer:

- the **sign** is fitted on the train part of the coin record
  (`leansOn`, `lib/coinsignal.js:63-71`) — the one honest part;
- the **band** it is read at is picked by maximising per-decision edge measured
  on test plus held (`findPlateau`, `lib/coinsignal.js:180-213`);
- **whether a coin and shape carries a pull at all** is decided by that same
  test-plus-held plateau (`lib/coinsrun.js:489-490`);
- the **yardstick** the band is a share of is a median over the whole record,
  test and held included (`coins.medianAbsMove`, `lib/coinsrun.js:499`).

And the two divisions are never tied together. Coins splits the coin's full
cached history; a stage 3 run splits its own pinned chunk list. Nothing checks
that a run's test stretch sits inside the Coins record's judging stretch, so on a
run pinned to older months **even the sign can be fitted on the very periods it
is later priced on.**

**And it can never reach live.** `lib/live/greenlight.js:66-70` refuses a
survivor priced with `confirm` past `off`, in words. The **Funnel** meanwhile
treats `confirm` as a dial it can cut on (`lib/funnel.js:31`). So the **Funnel**
can hand the owner a rule that passes **Held** and **Reserve** and can never be
greenlighted — after every hour of pricing is paid for.

## 2.2 — `TREND-TRAINING-DESIGN.md`: the shape survives, section F does not

Sections A to E are sound and mostly unaffected. Section B's central claim is
right and is the key that unlocks Part 3:

> "The type is only ever used to build what the forecasts are trained towards.
> Nothing reads it at trade time."

Section F is where it breaks. It asks every forecast to be doubled, with each
copy trained across the **whole** history and taught to say nothing outside its
own type. **A forecast has no input that tells it its type** (1.3: 57.5% at
best). Silence cannot be learned from numbers that do not carry the distinction.
A model asked to do it will learn something else that correlates locally and
will fail out of sample — which is precisely the failure mode the reserve
stretch exists to catch.

## 2.3 — `LEAN-DESIGN.md` Part A: the premise is falsified

Part A assumes the committee leans long, and its own success rule A1 is the test
of that. On the owner's LTC/DOGE/LINK unit the capture reads 50.8% long on train.
The lean it sets out to remove is not there on that unit. **Releases 5 and 6 of
that document must not be built unrewritten.** Part B (a second pass before
Reserve) and Part C (the two sizing controls) are untouched by any of this and
stand on their own.

---

# Part 3 — The architecture that works

One sentence: **compute which market it is outside the forecasts, and let that
decide which forecasts trade.**

Everything follows from it:

- **Nothing needs the future.** The number is a trailing one, from candles that
  closed before the entry. There is no lookup of a stored pull, no band fitted on
  a judging stretch, no yardstick over the whole record.
- **Nothing needs a forecast to know its own market.** 1.3 says it cannot. Under
  this arrangement it does not have to: the gate knows, and the gate chooses.
- **Silence stops being something to learn.** Section F needed each forecast
  trained on the whole history so it could learn to be quiet outside its type.
  Here a forecast is trained only on its own type's periods and only ever trades
  in them. It is never asked a question it cannot answer.
- **No new measurement block.** Nothing is added to what a forecast reads, so
  every set on the box stays readable and the 184.6 hours stay spent. **This is
  the single largest practical difference between this design and putting the
  regime into the measurements**, and it is why 1.4's bill is deferred to the
  very last release and made conditional on evidence.
- **It is a USER function throughout (RULE FIVE).** K, the threshold, and which
  markets a rule may trade in are all controls on **Sweep**, permutable like any
  other dial, and cut on by the **Funnel** like any other dial. Nothing about
  which market a coin is in is decided in code.

**The one cost, stated up front:** each forecast sees roughly 41% to 56% of the
periods it sees today (1.2's share column). That is a real loss of training data
and it is the thing release R4's success rule must earn back. It is measurable
before anything is trusted, and R4 is written so that it is measured.

**The discipline that stops this becoming the `confirm` dial again:** K and the
threshold may never be chosen by looking at test, held or reserve. Either they
are declared before the run, or they are swept as ordinary dials and judged by
the **Funnel**'s scrambled copies at the bar the owner sets — the machinery that
already exists for exactly this question. A value that cannot beat its own
scrambled copies is not kept, whatever it made.

---

# Part 4 — The releases, with their success rules written first

Each is small enough to ship on its own, each says which digit it moves, and each
carries a success rule **pre-registered here, before the numbers exist**. A
release whose rule is not met is reverted, not renegotiated (RULE SIX).

They are ordered so the cheap disproof comes before the expensive build. **R3 is
the one that decides whether R4 and R6 are worth anything at all.** If R3's
success rule fails, stop: the regime does not separate on this data and nothing
downstream can rescue it.

## R1 — the **Funnel** stops selling a dead end (third digit)

**What.** `confirm` is removed from the **Funnel**'s list of dials it may cut on
(`lib/funnel.js:31`). Existing record sets keep every number they have; only the
walk changes.

**Why.** The live path refuses such a survivor (2.1). Today the **Funnel** can
spend a full walk producing a rule that is dead at the last gate.

**Success rule.** No path through the **Funnel** can produce a rule pinning
`confirm` past `off`; every existing Stage 4 record set still opens and reads
exactly as it does now; the suite is green.

**Cost.** Minutes. Nothing on disk changes.

## R2 — the `confirm` dial deleted whole (second digit)

**What.** The box and the two multiple boxes on **Sweep**, the columns on
**Boards**, `lib/confirm.js`, the frozen findings written onto a set at launch,
the refusal in `lib/live/greenlight.js`, the help entry, the tests and the
mutation guards. All of it, in one cut (RULE TEN).

**The obstacle, and it is the owner's to resolve (RULE NINE).** Six stage 3 sets
carry `confirm` on roughly 65,000 ranked rows and carry frozen findings in their
own parameters. A reader that has to ask "was this written before the dial went"
is the legacy branch RULE NINE forbids. So one of two things must happen, and
**only the owner chooses which**:

- **migrate** those six sets beside themselves — same row count, same block
  boundaries — dropping the dial's fields and rebuilding the totals from the
  migrated records; or
- **delete** the six sets. They are S3-Pasers#1a, #1b, #2a, #3a, #3b, #3c and the
  Stage 4 set that stands on #3c. Recorded run time across them is about one
  hour; re-running is cheap.

**Success rule.** No screen names the dial; nothing in `lib/` reads it; the box's
remaining sets open and read identically; the suite is green; the count of sets
carrying the dial's fields on disk is zero, measured, not assumed.

**Cost.** Half a day, plus whichever of the two the owner picks.

## R3 — the gate, as a dial, measured before it is believed (second digit)

**What.** One number per period per coin: the coin's own move over the last K
periods, computed from closes that are complete before the entry candle. A new
box on **Sweep** — K, a threshold, and which markets a rule may trade in
(rising only, falling only, either) — permutable, cut on by the **Funnel**,
carried onto every record and shown on **Boards** like any other dial.

Nothing about the forecasts changes. The same committee, the same members, the
same training. Only whether a trade is taken.

**Success rules, all three required.**

1. **It separates, per coin, not just pooled.** On the four Daily shapes, with K
   and the threshold declared before the run, the gross per-decision money in the
   two markets must differ in the same direction on train, test **and** held, for
   at least twelve of the eighteen coins. (1.2 shows it pooled; one coin driving
   a pooled figure is the failure this rule exists to catch.)
2. **It beats its own scrambled copies.** A gated rule must clear the
   **Funnel**'s check at the bar the owner sets, on the same terms as every other
   dial. No exception, no special pleading.
3. **It pays on the sealed stretch.** On one unit chosen before the run, the best
   gated rule's money per trade on reserve beats the same rule ungated, **net of
   the fee**, by more than the scrambled copies allow.

Rule 3 is the one that matters and it is deliberately the hardest. Rules 1 and 2
are cheap and come first, so a failure costs hours, not days.

**What failure means.** If rule 1 fails, the label is noise on this data and R4
and R6 are abandoned — that is a real and acceptable outcome of this design. If
rules 1 and 2 pass and 3 fails, the gate is kept as a measurement and not as a
trading control, and R4 is reconsidered on its own evidence.

**Cost.** Two to three days. No re-run of anything on disk.

## R4 — two committees, chosen by the gate (second digit)

**Only if R3's rules 1 and 2 pass.**

**What.** Stage 1 trains one committee on the rising periods and one on the
falling periods of the same coin, using the same measurements. The gate decides
which is in force at each period. Neither ever sees the other's market, and
neither is asked to be silent — it simply is not consulted.

This is `TREND-TRAINING-DESIGN.md` section F's intent, with the part that cannot
work removed.

**Success rule.** On held, before reserve is opened: each committee's money on
its own market's periods beats the single committee's money on those same
periods, on at least twelve of eighteen coins — and the two together beat the
single committee overall. The training-data cost named in Part 3 has to be
earned back, in the open, or this is reverted.

**Cost.** Roughly twice the stage 1 training, plus the stage 3 growth from more
members. Neither has been measured; measuring both is the first task of R4, and
the number is reported to the owner before the build continues.

## R5 — the reserve's other half: cost (second digit, independent)

**Buildable in parallel; it depends on nothing above.**

1.2 explains the market half of the reserve failure. The other half is already
measured and was reported earlier: the plain rule made **+41.33 gross a setting,
0.227% a trade, against a 0.25% round trip**. Its break-even fee is 0.1137% a
leg against the 0.125% actually priced. It was 0.013 percentage points from
paying for itself.

**What.** A floor, set by the owner on screen, that refuses a setting whose gross
per trade does not clear the round trip by a stated margin — shown on **Boards**
beside the money, so a setting that only looks profitable is visible as such
before it reaches **Held**.

**Success rule.** On the owner's existing sets, every setting the floor refuses
has gross-per-trade below the round trip plus the margin, and no setting above it
is refused — checked by arithmetic on the stored rows, not by eye.

**Cost.** A day.

## R6 — the regime inside the measurements (FIRST DIGIT — the owner's call)

**Only if R3 and R4 both pass, and only if their evidence says the forecasts
would do better still with the number in their own inputs.**

**What.** Trailing long-horizon measurements added to the block: the coin's
return over the last 30, 60 and 120 periods, its position within its trailing
range, and its fall from a trailing peak — every one computed from candles that
close before the entry.

**The bill, restated from 1.4 because it must not be buried:** thirteen record
sets on measurement block 3 refused, the fifteen Stage 4 sets standing on them
gone with them, and **S3 #1c, paused at 180.6 hours, lost**. The owner decides,
having read that sentence, and nothing in this document decides it for them.

**Success rule.** On one unit, with everything else held identical, a committee
trained with the new measurements beats the R4 arrangement on held before reserve
is opened. If it does not, the block is reverted before any further set is built
on it.

---

# Part 5 — What only the owner can decide

Nothing below is assumed. No release starts before the ones it depends on are
answered.

1. **R2's six sets: migrate or delete?** Roughly 65,000 rows carry the dial.
   Re-running them costs about an hour; migrating costs a day and carries its own
   risk. (RULE NINE says one or the other must happen; it does not say which.)
2. **Is R1 wanted at all, or does R2 make it moot?** R1 is minutes and stops a
   wasted walk today; R2 removes the dial entirely a few days later. Doing both
   is honest; doing only R2 is cheaper.
3. **R3's declared K and threshold.** They must be fixed before the run. My
   recommendation, which is a recommendation and not a decision: K = 60 periods
   and a threshold of zero on the Daily shapes, because that is what 1.2
   measured and changing it afterwards is the exact fault this document exists
   to end.
4. **Which unit R3's success rule 3 is judged on.** Named before the run.
5. **Whether Weekly 8-day is fixed or excluded.** Its window move reads three
   hours past the entry (1.5). Until that is fixed, no measurement on that shape
   means anything — including the ones in this document.
6. **R5's margin.** How far above the round trip a setting has to clear before
   it is believed.
7. **R6's bill**, in full, and only when R3 and R4 have earned the question.
8. **Whether `LEAN-DESIGN.md` Parts B and C proceed separately.** They are
   untouched by any of this and could run in parallel with R3.

---

# Part 6 — Defects found and reported, not fixed

Carried forward so none of them is lost. **None has been touched** (RULE ZERO).

1. `setStopChoice` replaces the whole choice record while `setSizingChoice`
   merges, so applying a stop or pressing the save on the reason silently deletes
   a sizing choice. Live risk on the half-life set's
   `conviction 50% own market t89h · argmax auto 24/7`.
2. A trade taken when no member agrees is sized at a full clip, because the
   multiple lookup falls back to 1.
3. The conviction sweep's bucket loop starts at 1, so the no-agreement bucket is
   in every total and in no bucket.
4. `committee.COPY_DEFAULT` is undefined in `lib/live/stagesignal.js`.
5. Reserve chunks keep a band-free label.
6. A stale comment describes a `window layout` that was deleted.
7. Half a committee can be trained two ways.
8. **Weekly 8-day's window move reads three hours past the entry and shares its
   average with the outcome** (`lib/dataset.js:213-218`). This one is a real
   look-ahead in shipped code and is the most serious on the list.
9. The Coins sweet-spot band and the passer choice are fitted on test plus held,
   whose held overlaps the sealed reserve. Goes away with R2.
10. Two false statements on screen and in code: "Sweep trains with this same
    number" (`public/construct.js:8727-8731`, already recorded as untrue in
    `COINS.md:509-514`) and "the two never overlap" (`lib/windowmove.js:27-28`,
    false for Weekly 8-day).
11. A board row carries `confirm` but not the six numbers or the word
    (`boardRowOf`, `lib/stages.js:1138-1165`), so a single-unit board loses them.
    Goes away with R2.

---

# Appendix — where every number came from

Each is a read-only script on the `vps-access` branch, run against the box
through `bash .claude/vps-run.sh <name>`. None writes anything or starts
anything. Any figure in Part 1 can be re-derived by running these.

| script | what it produced |
|---|---|
| `uts-coins-status.sh` | the 18 records, the 11 plateaus, the saved band |
| `uts-confirm-used.sh` | which sets froze findings and which ran the dial |
| `uts-confirm-rows.sh` | the dial's values across the ranked rows, per set |
| `uts-confirm-six.sh` | the `verdict` word counts and the six numbers |
| `uts-overlay-ledger.sh` | table 1.1 — at one clip against under the dial |
| `uts-regime-truth.sh` | the first, badly-scaled attempt, kept for the record (1.5) |
| `uts-regime-truth2.sh` | tables 1.2 and 1.3 |
| `uts-block-cost.sh` | 1.4 — the sets, their blocks, and 184.6 hours |

**One correction belongs in this appendix.** An earlier reading of this same
question reported that the box held no coin records, had never been configured,
and had never run the dial. That was read out of the sandbox this session runs
in, not out of `/opt/ultimate-trading-system/data/` on the box, and every part of
it was false. The owner caught it. Every figure in this document is from the box.
