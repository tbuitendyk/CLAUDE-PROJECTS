# The decision field: gating the members by what the coin did after moves like this one

The owner's design, spoken on 2026-09-20 and 2026-09-21 and written down here
so it is not lost with the conversation. **Nothing in it is built and nothing
will be until the owner says so, part by part.** The order that produced this
file was "write the design record GO NOW! without deploy" — a record, no code,
no deploy.

Three kinds of thing are in this file and they are kept apart on purpose:

- **What the owner designed.** Sections A to D. Recorded as given — the
  fourteen points in section B are the owner's words, numbered as they typed
  them, and the eight answers in section C are theirs too.
- **What I found in the code.** Marked FOUND, with the file it was read in.
  These are findings, not decisions.
- **What I proposed.** Marked PROPOSED. The owner has not agreed to these unless
  a section says they have. Where the owner said "you tell me", the proposal
  is marked as answering that.

**The measurement that led here is recorded in section A**, because the design
is a response to it, and **one false start of mine is recorded at the end**.

---

## A. Why: what the walk's votes turned out to be worth

Two record sets were built on the box to answer whether members trained on
what the walk found add anything. Thirteen units from the walk set the owner
named `test-walk-6`, one chain with the extra members and one without.

- **As voters, the extra members did nothing measurable.** Permuting the
  `plateau share` moved no number: FOUND (`lib/agreement.js`,
  `READS_LEANS` / `READS_NO_BAR`) that under the `trained` and `conviction`
  ways of weighing (the `quorum by` choice), the fold by share is never consulted, so the dial was a
  no-op on the sets the owner ran.
- **As a gate they did.** With `confirm` set to `strictly confirmed` — only
  trades the walk's lean actively agrees with are placed — the thirteen units
  made **+145 on held against −882** for the same units with `confirm`
  `off`, on 121 trades against 2,225, and better held money on twelve of
  the thirteen coins. Small counts; the direction was consistent.

The owner's reading of it, 2026-09-21: *"we really ought to pull the voting
mechanism entirely and only gate on the information"*, and then: the gate is
too coarse — one lean per unit, read at one look-back and one band, says yes
or no a few times a year. What is wanted is **many more decisions**, each
carrying a strength and not only a sign, so the gate can size as well as
block.

FOUND (`lib/coinscan.js`, `leanOver` / `signsBefore`): the lean a promoted
row carries today is learned **over the walk's whole history** — every period
the coin has, train, test, held and reserve alike — at the row's own look-back
and band. It is then read against the held and reserve stretches at
stage 3. The comment above `leanOver` says the owner chose whole history for
the walk's own purposes; carrying that lean into a stage 3 verdict on held is
a leak, and the +145 above was measured under it. **The field design below
removes that leak by construction** (point 5, and section D "No leak").

## B. The owner's design, in their words (2026-09-21)

Typed one point at a time, collected as asked, unchanged.

1. *"an init period and scrolling forward window is set, say 1500 days
   regardless of trade entry shapes"*
2. *"for each unique coin/hold shape, the data is scanned for each of the
   1500 days, moving forward one day at a time"*
3. *"each day gets its 900 point field constructed (30 x 30 on sit-out bands
   and look back days)"*
4. *"once the 1500 day table is filled for the coin / unique hold shape its
   ready to start contributing to decisions"*
5. *"there is absolutely no concern about train/test/held/reserve sections
   ... we are working with a single plane of history data and going forward
   day by day with current days added"*
6. *"(the actual size of the history window may be something we tune a bit)"*
7. *"we apply some kind of half-life mechanism to the accumulating data in
   the sliding window such that most current dates are full weight and dates
   at the end have there influence diminished to some pre-stated weighting"*
8. *"the mechanism for accumulating decisions and gating is as you previously
   described"* (that description is section D, recorded there as PROPOSED and
   then accepted by this point)
9. *"the maximum size of the sliding window should be restricted to the size
   of the train set of the data such that regardless of the window layout
   chosen full decision making will be active by the time the test window is
   trading, hence our stage 3 tables and forward will have access to all of
   this information to gate the trading"*
10. *"regardless of the entry period (daily, weekly, 24/5 periodic, depending
    on shape) the current accumulated field informs the currently triggering
    gate on Construct history and Trade real-time data"*
11. *"we are looking to overlay the gating on regular ongoing normal voting
    member decisions such that it rarely fully blocks a trade (only in cases
    of member direction voting is against the field's consensus), but rather
    usually moderates in terms of sizing"*
12. *"the sizing question can itself be handled as parameters to tune that
    generate a range around the system standard $100 trade size"*
13. *"somehow a minimum agreement level to constitute a pass on the gate
    should probably be set"*
14. *"somehow we need to recognize the realistic range of agreement from
    minimal/passable to strong/somewhat rare so the range is actually
    accessible"*

## C. The eight answers (owner, 2026-09-21)

I put eight things I could not find in the fourteen points. The owner's
answers, as given:

1. **The yardstick.** *"yes, sit out bands for each look back are
   continuously calculated weighted within the sliding window"* — the coin's
   usual move, which every sit-out band is a share of, is worked out inside
   the same weighted window as the field itself, not on the whole history.
2. **One field per day.** *"no problem ... every decision day has its unique
   instance of the current state of the decision field"* — the field is
   rebuilt (rolled forward) for every decision day, and a decision reads the
   field as it stood on its own day.
3. **The outcome a point records is the chunk's own hold.** *"yes"* (see
   answer 8 for the full shape).
4. **When the gate blocks.** *"rarely block ... only when 'field's sign is
   against the members OR its agreement fails to clear the minimum' (field
   size below minimum does block -- but perhaps we allow an override on that
   to ONLY consider the sign)"* — so two ways to be blocked, and a tick that
   turns the second off.
5. **Where the dials live.** *"the windows must be initialized with their
   parameters as a new section on Coins -- stage 3 sweep permutations AND
   available for sorts/filters on stage 3 record sets"* — and, clarified later
   the same day: *"we are not only specifying the fields parameters on Coins,
   but also launching the build and wanting to see stats on the state of the
   field once its loaded, etc."*
6. **A breakout entry.** *"yes"* to the proposal in section D ("A breakout
   keeps one rail").
7. **What it retires.** *"yes -- but we should keep the color coding control
   and views of the coin/shape rows in Coins"* — the machinery of 3.202 to
   3.206 goes (section G); the colouring of the bars on Coins and the views
   of each coin and shape's rows stay.
8. **The outcome.** *"market entry, chunk's own hold, entry to exit as a
   share of price -- how it fits in with a breakout entry? you tell me"* —
   answered in section D.

And on the build (owner order with the GO NOW!): *"the build on coins can
take a single set-up or something like the sweep stage 1 selector with all
coins and chunk shapes being an option too."*

## D. How a point gets its information, and how the points gate (PROPOSED, accepted by point 8)

This is what point 8 refers to. It was proposed before the fourteen points
were typed and the owner accepted it by reference; it is written out here so
it exists somewhere other than a chat window. Where the owner's later points
changed a detail, the later point wins and the change is noted.

### The grid

For one coin and one chunk shape, a grid of **30 × 30 points**: thirty
sit-out bands across, thirty look-backs in days down (the counts are dials —
section E — 30 is the owner's example). A point is one pair: *this band, this
look-back*. It is the same pair a row on `Walk it forward` is, and the same
pair the nine-strong plateau of 3.203.0 fanned out around a promoted row; the
grid is that idea taken to the whole plane instead of nine cells.

### What a point keeps

Each point keeps **four numbers**: a weighted total and a weighted count of
the outcome after a **rising** reading, and the same pair after a **falling**
reading. A reading that **sat out** records nothing at that point. So a point
with a wide band is silent most days and a point with a narrow band speaks
most days, and neither is right or wrong for it — the strength comes out in
the count.

### How a day is recorded

On each decision day, for the coin and shape:

1. The coin's **usual move** is worked out from the window's own days, with
   the half-life weights (answer 1). Every sit-out band is a share of it.
2. For each look-back, the move into today over that look-back is read.
   Against each band it is `rising`, `falling` or sits out — the same three
   readings Coins draws today, FOUND (`lib/windowmove.js`,
   `readingsUnderBand`): rising when the move clears the threshold upward,
   falling when it clears downward, sitting out between.
3. The **outcome** of today is what the coin did from a market entry at the
   chunk's open to the chunk's own exit — **entry to exit as a share of
   price** (answer 8), signed, so a fall is negative. One number for the
   whole grid, because the outcome does not depend on which point is reading
   it. Fees are not in it; it is the coin's move, not a trade's money.
4. Every point whose reading today was rising adds `weight × outcome` to its
   rising total and `weight` to its rising count; falling likewise; sitting
   out adds nothing. The weight is today's half-life weight (point 7) — full
   weight today, decaying with age, never below the floor.
5. A day that falls out of the window at the back is subtracted the same way
   it was added, so the window slides (point 1) and no total is ever rebuilt
   from scratch after the first fill.

So the outcome is known only once the chunk has closed. **A point's totals on
a given day contain only chunks that had closed by that day.** That is the
whole of the no-leak guarantee and it holds by arithmetic, not by policy.

### What a point says on a decision day

Given today's reading at that point (rising, falling or sit out), the point
answers with the **weighted average outcome after that reading** — its total
over its count for that side — and the count is how much evidence stands
behind the answer. A point whose reading today sits out says nothing. A point
with no evidence on that side says nothing.

### How the points are brought together: the field

The **field** for the day is the sum over every speaking point of
`average × weight`, where the average is the point's weighted average
outcome after today's reading and the weight is the evidence behind the point
(PROPOSED: the count, capped so no single point can carry the field; the cap
is a dial). Its sign is the field's **sign** — the direction the coin has
tended to go after readings like today's, across every band and look-back at
once. Its size is the pull itself. Its size against the largest it could be
if every speaking point pulled the same way — |Σ average × weight| over
Σ |average| × weight — is the field's **agreement**: a share from 0 to 100.

**Changed in the loop (2026-09-21, LOOP-FIELD.md).** As first written this
summed `sign(average) × weight`. The first fabricated coin showed why that
cannot work: the bands at one look-back nest, so their points agree with each
other whether or not they know anything, and a slid copy with no signal is
exactly as unanimous as a coin whose outcome follows its move perfectly. The
signal lives in how far the average sits from zero, so that is what a point
brings. Certainty (below) ranks the field's size, not its agreement, for the
same reason. The owner's words in section B are untouched by this; it is a
PROPOSED line and theirs to reverse.

A field of zero — no point speaking, or the points cancelling — is a day the
field has nothing to say. That is distinct from a field that says *against*.

### Certainty, so that agreement means something (PROPOSED, answers point 14)

Agreement on its own is a share of points, and a share of points can be high
by chance on a quiet grid. The walk already answers this kind of question the
right way, FOUND (`lib/coinscan.js`, `scrambled` / `slidOffsets`): the same
arithmetic on copies of the coin whose outcomes are slid along by an offset,
so every outcome keeps its neighbours in time and only the link to the
reading is cut. PROPOSED: the field keeps **N slid copies of itself** — the
same points, the same weights, the outcomes offset — rolled forward day by
day beside the real one (a slid copy is a fixed offset, so it is incremental
too; a dealt copy is not and would have to be redone daily, which is why the
daily one is slid and the dealt check is taken only at fill). The day's
**certainty** is then the rank of the real field's agreement among its copies'
agreements. This is what makes the range in point 14 accessible: certainty is
0 to 100 by construction, "minimal/passable" is a rank near the copies, and
"strong/somewhat rare" is a rank above nearly all of them, on every coin
alike.

**Which of the two the gate reads — agreement or certainty — is a dial**, not
a decision made here. Both are recorded on every trade (section F) so the
owner can see which one separates good trades from bad before choosing.

**Slides only, decided (owner, 2026-09-21, after the difference was
explained).** The gate's certainty is ranked against slid copies only. A
scramble deals the outcomes into a random order and breaks up the coin's own
runs, so on a trending coin the real field beats its scrambles even when the
readings mean nothing; a slide keeps the runs and moves only which reading
each outcome sits under. The scrambles count is taken once, when the field
first fills, and shown on the state beside the slides count the way Coins
shows `scrambles as good` beside `slides as good`; the gate never reads it.

### How the field gates the members (point 11, answer 4)

The members vote exactly as they do today and the gate is laid over the
result. On each decision the members make:

- **Blocked** when the field's sign is **against** the members' call (the
  members say up, the field says the coin tends to fall after days like
  this); or when the field's agreement (or certainty, per the dial) is
  **below the minimum** (point 13) — and this second block has a tick that
  turns it off, so only the sign is consulted (answer 4).
- **Otherwise sized.** The trade is placed at a size chosen by which **rung**
  the field's agreement falls in: a ladder of rungs, each a range of
  agreement and a multiplier of the standard size (point 12). A field that
  says nothing (zero) places the trade at the standard size, on the rung the
  owner sets for it, so silence is never a block by accident.

Nothing is trained. The field is arithmetic over candles and its own dials,
and every number on every screen is reproducible from candles alone (RULE
SEVEN).

### A breakout keeps one rail (answers "you tell me", accepted as answer 6)

As RULE ONE-B in CLAUDE.md describes it (Sweep offers `breakout` under `entry`):
with `entry` set to `breakout`, two price levels are set either side of the
current price, `d` away on each side, and the position opens when price
reaches one of them. The **opposite rail** — the level on the far side, where
the position is closed if price goes the wrong way — is what a `static`
`trail` sits at: a stop that sits at a fixed price and does not move.

The outcome a point records is the same for a breakout unit as for a market
one: market entry at the chunk's open, the chunk's own hold, entry to exit as
a share of price. **The field does not know or care how the trade enters.**
What changes is the gate: on a breakout decision the field's sign says which
of the two levels may open a position. **Only the rail on the field's side
stands**; the level on the other side is not placed. The size rung applies to
the one that stands. With the sign-block turned off, both rails stand and the
rung applies to whichever fills.

### No leak

Because the outcome enters a point only when its chunk has closed, and
because a day's field is the field as it stood that morning, nothing in the
field on a test, held or reserve day contains anything from that day or after
it. There is no train/test/held/reserve inside the field (point 5). The
stretches still exist for the members and for the verdicts on Held and
Reserve, untouched; the field is simply a reading of the past that is
complete on every day the members trade.

Point 9 is what makes it complete: the window may be **no longer than the
train stretch**, so on the first test day the window has been full for the
whole of train. FOUND (`lib/stagework.js`, `windowLayout` `reserve61` /
`split70`; Coins offers `61/13/13/13 (sealed exam)` and `70/15/15`): the
split is by chunk count of the loaded range, and 61% is the smaller train
share of the two layouts, so a cap at 61% of a coin's history keeps the
window full at test start under either layout.

**The cap, decided (owner, 2026-09-21).** The window dial takes two forms:

- **a number of days**, held to **one system maximum** worked out from the
  shortest history on the server — 61% of its days, which is 1,335 today
  (the shortest current coin starts in late September 2020). A number above
  the maximum is refused in words with the maximum printed beside the box,
  never silently cut. The owner's example of 1,500 is above it on today's
  data, and they know it.
- **`max`** (the owner's word; it becomes a screen word only when rendered
  and deployed), meaning what is available: each coin gets 61% of its own
  history, so a coin from January 2018 gets about 1,943 days and the shortest
  gets 1,335.

Either way the field records, per coin and shape, the window it was actually
built with and whether it was full on the first test day, so a stage 3 set can
say which it read. The maximum is shown on the screen with the coin that sets
it and that coin's first candle date (RULE ELEVEN clause 3).

## E. The dials, and where they live (answer 5)

Every one of these is a control on the screen, never a constant (RULE FIVE).
Defaults are PROPOSED; the owner sets them. The names in the left column are
proposed captions, not screen words — nothing here is a screen word until it is
rendered and deployed (RULE ONE-A).

| dial | PROPOSED default | what it does |
|---|---|---|
| window, days | 1,335 today (the system maximum), or `max` | how many days the field remembers: a number is held to the system maximum, `max` gives each coin 61% of its own history (points 1, 6, 9; section D) |
| half-life, days | 500 | age at which a day's weight has halved (point 7) |
| weight floor | 0.10 | the least weight any day in the window keeps (point 7: "some pre-stated weighting") |
| sit-out bands | 30 from 10% to 300% of the usual move | the columns of the grid; PROPOSED as from/to/count with `Apply` into an editable list, the shape RULE ELEVEN clause 2 fixed on Coins |
| look-backs, days | 30 from 1 to 60 | the rows of the grid; same shape |
| evidence cap | 30 | the most one point may weigh in the field |
| slid copies | 50 | how many copies certainty is ranked against |
| read | `agreement` / `certainty` | which of the two the gate consults |
| minimum | 20 | the least the read must reach for a trade to pass (point 13) |
| sign only | tick, off | ignore the minimum; block only on an opposing sign (answer 4) |
| size rungs | 0–20: 0.5×, 20–50: 1×, 50–80: 1.5×, 80–100: 2× | the ladder of multipliers around the standard size (point 12) |
| silent | 1× | the multiplier when the field says nothing |

FOUND (`lib/history.js`, `ageWeights`): a half-life weight already exists —
`0.5 ^ (age / H)` — for the history retrain of AGEDIAL-DESIGN.md. It has no
floor. PROPOSED: the field's weight is that formula with the floor applied
(`max(floor, 0.5 ^ (age / H))`), in one place, so the two half-lives on the
box are the same arithmetic.

FOUND (`public/trade.html`, the setup form): the standard size on Trade is
the control labelled `Clip $`, whose hover text explains it as the position
size per entry in US dollars, with $100 given as the example. Stage 3 prices
every trade at size 1 (Boards prints `at size 1` and `Size:`). PROPOSED: the
rungs multiply size 1 at stage 3 and `Clip $` on Trade, so the same rung means
the same thing on both — which is exactly what `sized` does today with
`confirmed ×` and `unconfirmed ×`, FOUND (`lib/confirm.js`, `multipliersOf`
/ `combine`): money at a multiplied size is the multiple of the money at size
1, fees included, so no new simulator is needed.

### The new section on Coins (answer 5, and the owner's note on the build)

A new section on the Coins screen, below `Walk it forward`. **Names and
layout (owner order, 2026-09-21):** *"make rational, logical choices. ugly
mode zero ... Everything lined up. Map setups to existing setups and GUIs.
Make everything consistent ... Don't be sloppy."* So every control here copies
the shape of the control that does the same job on the walk section it sits
under, and where the walk has none, the Sweep stage 1 form. The captions in
the table above are the proposed names. None is a screen word until it is
rendered and deployed (RULE ONE-A). It holds:

- **The dials** above, in the house shape: captions over boxes, ticks
  bottom-aligned to the fields beside them, each button in a row of its own
  (RULE FOUR, FOUR-A, ELEVEN).
- **The build launcher.** Either **one set-up** — one coin and one chunk
  shape — or every coin and every shape, chosen the way stage 1 on Sweep
  chooses: FOUND (`public/construct.js`, the stage 1 form) a coins box
  `trade coins (blank = all` … `downloaded)`, a `chunk shape` choice offering
  one shape, and a `permute` tick beside it that runs every shape. (This
  record first said the choice offered `all of them`; it does not — `all of
  them` is a `quorum bar` value. Corrected 2026-09-21.) On Coins the same
  job already has a shape too, in the walk section this one sits under:
  `coins to walk (blank = all)`. The launcher copies that: a coins box, blank
  for all; a `chunk shape` choice with a `permute` tick beside it for every
  shape. Blank coins with `permute` builds every coin and shape on the box,
  one task per pair on the worker pool, the way `Walk it forward` already
  runs — FOUND (`lib/coinsrun.js`, `walkTasksFor` on the pool).
- **Progress and stop** while it builds, and a **name** for what it writes,
  the way the walk has `name for the set this walk writes` and `Stop`.
- **State, once built** (RULE ELEVEN clause 3 — if it is stored, show it),
  per coin and shape: days in the window and whether it is full; how many of
  the points have evidence on each side; today's sign, agreement and
  certainty; the **range of agreement** seen over the window — lowest,
  median, highest, and the share of days above the minimum — which is how
  point 14's "realistic range" is put in front of the owner rather than
  guessed at; and **the grid itself on demand** — thirty by thirty, each
  point's average outcome after rising and after falling with its count,
  drawn as a table the owner can read, not a picture.
- **What was built with what.** The dials a field was built under are
  written on it and shown beside it; a field built under other dials than
  the section now shows is said to be so, in words.

A built field is a **set on disk with a name**, listed the way `walk sets on
this box` are, so it can be opened, renamed and deleted from the screen and
so a stage 3 run can name the one it reads.

## F. Stage 3: permutations, records, sorts and filters (answer 5)

FOUND (`lib/stages.js`, `blockAxesFor`): stage 3 already carries four plain
axes per block — `decision`, `band % (or auto)`, `24/5` and `confirm` — each either one
value or permuted, and FOUND (`lib/stagework.js`, the record row) every
record carries `confirm` and, when a lean was priced, its six numbers and a
`verdict`. The field takes the place `confirm` holds:

- **On Sweep, stage 3**: the field's gate dials — `read`, `minimum`, `sign
  only`, the size rungs and `silent` — each with `permute` beside it where
  permuting makes sense (`minimum` over a list; `read` over both; `sign only`
  over both). The window, half-life, floor and grid shape are **not**
  permuted at stage 3: they are the field's, set when it was built on Coins,
  and a stage 3 run names the built field it reads. Re-building under other
  dials is a new field, built on Coins, so what a record set was priced
  against is always one thing on disk with a name.
- **On every stage 3 record**, per trade: the field's **sign**, **agreement**,
  **certainty** and the **size rung** that priced it, and whether the trade
  was **blocked** and by which of the two blocks. Per record row: trades
  placed, trades blocked by sign, trades blocked by the minimum, and money
  at the sized total against money at size 1 — the same pair `sized` prints
  today.
- **Sorts and filters on Boards**, FOUND (`lib/stages.js`, `S3_SORTS`,
  `S3_COIN_FILTERS`, `SORT_KEYS[3]`, `FILTER_DEFS[3]`): the two stage 3
  tables gain an order by each of the new numbers and a floor on each, in the
  same shape `avg test trades` and `share that agreed` have today (`avg test trades` came in 3.207.0).

**The rule, written before any number exists**, in the shape section 11 of
COINS.md used for `confirm`: a field setting **adds value** when its sized
money on held is above money at size 1 on the same trades AND above it
per unit of size deployed; it is **just leverage** when only the first holds;
it **adds nothing** otherwise. And the gate's blocks are judged on their own:
the trades it blocked must have lost money at size 1, on held, or the
block is costing more than it saves. FOUND (`lib/confirm.js`, `verdictOf`):
that ladder exists and is the one to reuse, with the three parts renamed for
what they now are.

**Expected result, written down now.** On the thirteen units of section A,
`sign only` with the minimum off should land near `strictly confirmed`'s
+145 on held or better, on **more** trades than 121, because the field
speaks on more days than one lean at one look-back does. If it lands on
fewer trades, the evidence cap or the bands are wrong before anything else is
looked at. If it lands on more trades and worse money, the field is not
better than the single lean and this record says so.

## G. What it retires (answer 7)

The owner's answer: the machinery goes; the colouring and the views stay.

**Goes**, once the field prices the same units and the comparison in section
F has been read:

- `split for extra members` and the walk-set member trained on its share of
  the whole history (3.202.0);
- the family of nine around a promoted row and its training at stages 1 and
  2 (3.203.0), and the nine folded to one voice (3.204.0);
- `plateau share` on Sweep and on every record (3.205.0, 3.206.2), and the
  `+plateau` reading on Boards;
- the lean carried on a promoted row and folded from the plateau's rows,
  and `confirm` with its four values and `confirmed ×` / `unconfirmed ×`
  (3.130.0, 3.206.0): the field's sign, minimum and rungs are what these
  were reaching for;
- `leave the extra members out`, which exists only to build the control arm
  for the members above (3.209.1).

**Stays**: on Coins, the bars coloured under the sit-out band, `LOOK ONLY`
and everything in that section; `Walk it forward` and its sets; `Choose
early, read late`; `Candidates for Sweep` and promotion; the views of each
coin and shape's rows. A promoted row still carries its look-back and band —
they are the row's provenance and the owner reads them — it just no longer
adds a member.

**The record sets on the box that were priced with `confirm` or a plateau
share keep reading as they are** until the owner decides otherwise; RULE
NINE says a schema change migrates or deletes, and which one is the owner's
call, stated with what each costs, when the time comes. Nothing in this
section happens before the field exists and has been compared.

## H. Trade: the field rolls forward daily (point 10)

FOUND (`lib/live/greenlight.js`, `stage4Refusal`): today a survivor priced
with `confirm` past `off` **cannot be greenlighted** — the live path has no
reading of the coin's own lean, so it refuses in words rather than trade at
size 1 what was priced at another size. The same refusal would apply to a
field gate the moment stage 3 prices with one, so point 10 is not optional:
**the live path has to carry the field or the gate cannot be traded.**

FOUND (`lib/live/stagesignal.js`, `stageCommitteeCallFor`): a live setup
rebuilds its members from the configuration and makes one call per target
chunk from the closed history it holds. PROPOSED: the field for the setup's
coin and shape is held beside the members, rolled forward once per closed
chunk from the same closed history, under the dials the greenlighted record
was priced with, and read at the moment of the call — sign, agreement,
certainty, rung — with the block and the rung applied to the order the same
way stage 3 applied them to the priced trade. What the field said is written
on every live decision so it can be read back on Trade, and RULE TWO holds:
Paper Books and Live Trading read and show it identically.

## I. What it touches, in the order I would build it

1. **The field itself**, as one pure module: points, weights, the daily add
   and subtract, the reading, the sum, the slid copies. No I/O. Tested on a
   fabricated coin whose outcome after rising is known, so the field's sign
   on it is known before the test is written.
2. **The build**: one task per coin and shape on the worker pool, the set on
   disk with a name, listed and deletable.
3. **The section on Coins**: dials, launcher (single set-up or the Sweep
   stage 1 shape), progress, state, range, the grid on demand.
4. **Stage 3 prices with it**: the gate dials on Sweep, the fields on every
   record, the sorts and filters on Boards, the verdict ladder reused.
5. **The comparison** in section F, run by the owner, read against the
   expected result written there.
6. **Trade**: the field beside the members on a live setup, both books alike.
7. **The retirements** in section G, only after 5 has been read and the
   owner says which.

**4 must not ship before 3**, because a stage 3 run names a built field and
there is nothing to name until Coins can build one. **7 waits on the owner.**

## J. The release number

PROPOSED: 1 to 4 are a **second-digit** move each — new behaviour and new
controls, and no record already on disk changes shape, because a stage 3
record gains fields beside the ones it has and a set built by the field is a
new kind of set that nothing older reads. 7 is where the digit question
really lives: removing `confirm` and `plateauPct` from the record row is a
schema change, and whether that is a first-digit move — every chain on the
box refused — or a migration that rewrites the rows to today's words is the
owner's call (RULE ONE-C, RULE NINE), read off `uts-sets-and-versions.sh`
first and costed before it is asked.

## K. Not verified

- Whether the live path's closed history reaches far enough back for a window
  of 1,335 days on every coin a setup trades.
- The names in section E are proposed; each becomes a screen word only when
  it is rendered, deployed, fingerprinted and generated into SCREEN-WORDS.md
  (RULE ONE-A).

Settled on 2026-09-21 and moved out of this list: the train stretch in days
(section D, the cap); the build time (the owner: *"Don't worry about the time
involved on the field setup ... Doesn't need to be measured in advance"*);
the certainty rank (section D, slides only).

## L. One false start, mine

**Train and test inside the field.** I proposed shielding the grid's fill
from held and reserve by splitting the field's own history into a part that
fills it and a part that is read, so that the field would be "trained" on
one stretch and "tested" on another. The owner: *"why EXACTLY do you need a
train AND a test section for this design? ... why can we not just sweep over
(for example) 1500 decision points of entries from the start of history to
the start of held and tune the grid through that entire walk, and then just
apply it in held or held/reserve?"* They were right and the reason is in
section D: a point's totals on a day contain only chunks closed by that day,
so the field is already clean on every day it is read, and a split inside it
would only throw away evidence. What DOES have to hold is point 9 — the
window no longer than train — and that is a cap, not a split.

And one word: I called the three readings of a window "colours" while
explaining this. The owner: *"what are you talking about colours for?"* The
readings are `rising`, `falling` and `sit out`, which is what the screen
prints; the bars on Coins are coloured, the readings are not.

## M. The loop (owner, 2026-09-21)

After the four decisions above were given, the owner wrote: **"GO NOW!  LOOP
NOW!   keep going until done including deploy"**. Under RULE SIX that names
this body of work: the record brought up to date (this section's commit),
then section I steps 1 to 4 and 6, built, tested and deployed in that order,
and step 5 handed to the owner to run. Step 7, the retirements, stays with
the owner as section I says. The running record of the loop — decisions,
parked items, what reached the box — is `LOOP-FIELD.md`.
