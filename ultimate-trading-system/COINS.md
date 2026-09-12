# Coins — vetting a coin's history before anything is trained

Dictated by the owner on 2026-09-12 and written down here in their words, then
completed on the same day by folding in everything technical from
`TREND-TRAINING-DESIGN.md` that belongs to this tab.

**Nothing in this document is built.** The **Coins** tab exists as a screen with
nothing on it, and every piece below waits for the owner, one at a time.

**Three kinds of thing are in here and they are kept apart on purpose**, the
same way `TREND-TRAINING-DESIGN.md` keeps them apart:

- **The owner's design** — sections 1 to 11. Recorded as given.
- **Findings read out of the code** — section 14. Read out of the named file,
  in the session that wrote it. Findings, not decisions.
- **What I proposed** — section 15, and it is marked as mine at the top of it.
  Recording is not agreeing.

**Where this sits.** `TREND-TRAINING-DESIGN.md` is the design for sorting
history into rising and falling stretches and training on it, spoken by the
owner on 2026-09-09. This document is the **Coins** tab specifically: what that
tab does, what it produces, and what it hands to **Sweep**. Everything about
how the two sets of `members` are actually trained stays in that document.

---

## Read this first: there are almost no screen words yet

**Coins** today carries exactly one control label — `Coins`, the tab itself —
and nine printed sentences. That is the whole of its vocabulary
(`SCREEN-WORDS.md`, the **Coins** list). So almost everything below is
described by what it DOES, not by what it will be called, and where a name is
needed this document says plainly that there is no name for it yet.

| Word here | Where it comes from |
|---|---|
| `rising`, `falling` | On the **Coins** screen today, in the sentences it prints. The owner's words for the same thing are **up action** and **down action**. They are the same thing, and this document says `rising` and `falling` because that is what the screen says. |
| **type** | Rising overall, or falling overall. The owner's word for it in conversation. **There is no name for this on any screen**, because nothing on any screen does it yet. |
| `window layout` | On **Sweep**. Its two choices are `61/13/13/13 (sealed exam)` and `70/15/15`, quoted from the **Sweep** list. |
| `train`, `test`, `held`, `reserve` | The four parts a coin's history divides into. The owner's four words, used exactly as they are (RULE ONE-D). |
| period | One step of the system's clock. With `chunk shape` set to a daily choice, one day. `chunk shape` is on **Sweep**, **Boards** and **Funnel**. |
| stretch | A number of periods one after another, with no gaps. |
| `member`, `members` | One forecast, and the group of them. On **Sweep** and **Boards**. |
| the `committee` | The whole group of forecasts that vote on one coin. On **Sweep** and **Boards**. |

**Two things that have no name and are not given one here.** Every control this
tab will carry. And the way **Sweep** picks which coins a run covers — the
**Sweep** word list names `singles`, `doubles` and `triples`, and nothing that
is plainly a coin picker. Where this document says Coins picks coins "the way
**Sweep** does", it means the same kind of choice, not a label anybody can
point at.

**The naming decision is made: the word is `coin`.** Owner, 2026-09-12: *"The
word is coins, not pair."* This tab says `coin`, the same as **Sweep**,
**Boards**, **Funnel**, **Verify** and **History**. **Data** was the one screen
still saying `pair` and it was changed to match in 3.114.1, so there is no
longer a neighbour to disagree with.

---

## 1. What Coins is for

**To vet, in advance, which shapes of history are good — meaning they hold a
mix of both `rising` and `falling` action.**

Two things come out of that, and they are the whole point of the tab:

1. **Better choices at Sweep.** You go into a sweep knowing which coins have
   history worth training on, instead of finding out afterwards. **The list of
   coins Sweep works from comes out of Coins rather than being typed in** — but
   Coins never decides that list on its own. It shows what each coin's history
   holds and the owner picks from it (section 8).
2. **The numbers a coin needs to be trained two ways** — how many `rising`
   stretches and how many `falling` stretches it has, where they fall, and how
   the time divides between them, recorded against that coin's history.

Coins sits between **Data** and **Sweep** because a record set built the second
way is a different thing from one built the first way. The vetting has to
happen before the sweep, not after it.

## 2. Why it exists: Sweep is going to run two ways

**Sweep** will offer a choice of how a coin's `members` are trained.

- **Two sets of `members`.** One set trained towards the `rising` stretches,
  which is silent on the `falling` ones. One set trained towards the `falling`
  stretches, which is silent on the `rising` ones. Each set votes only inside
  its own kind of action, so **roughly half the `committee` is silent at any
  moment**.
- **One set of `members`.** The way it works today: one set trained on all of a
  coin's history, voting everywhere.

**Every model still trains across the WHOLE history, not part of it.** Outside
its own type the right answer is "no call", and the model is trained on that
silence rather than trusted to produce it. This is the part that removes the
sample-size cost: no model sees less data than it would have, and silence
becomes something learned rather than assumed. So when this document says a
type needs "enough" stretches, it is not about how many rows a model gets — it
is about how many separate occasions it has to learn the difference from.

**Where it lands across the stages** (the owner's placement): stage 1 types
each period, filters the coins and masks the labels; stage 2 holds the
`committee` and the bar; stage 3 is affected too, because the number of
`members` sets how many rungs the agreement dial offers, and that list
multiplies against every other dial in the block.

**Cost.** Twice the `members` is twice the stage 1 training. Stage 3 grows worse
than twice, for the reason above. **Neither has been measured.**

**A note on one word.** In the budget rule, "judging" means a claim about what
will happen, spent once. That is not what `members` do. Throughout this
document `members` **vote**; nothing they do is called judging. The owner's
instruction, 2026-09-12: *"Don't use the word judging there if it's gonna
confuse things. Voting, training, something like that."*

## 3. How a stretch is typed — the algorithm

**Two types only: rising overall, and falling overall.** No third bucket. Every
stretch is one or the other, so nothing is left unclassified.

**How a turn is found: by how far price falls back.** Walk the price forward
and keep the highest point seen. When price has fallen back from that high by
**at least** a set percentage, mark the high as where the `rising` stretch ended
and the `falling` one began. Same rule the other way. Between two turns the
stretch is `rising` or `falling` by construction.

*This paragraph said "more than" until 2026-09-12. The code has always read "at
least", and at the exact boundary those are different rules. The wording was
corrected to the code rather than the code to the wording: changing the
comparison moves every number on the tab, and neither side of that boundary is
more defensible than the other.*

**Two alternatives were considered and rejected**, and the reasons are kept
here so nobody re-proposes them:

- **Price against its own average over the last N days** — rejected: it flips
  back and forth in a flat market and produces one-week trends that are noise.
- **The slope of a straight line fitted through a window of price** — rejected:
  it still flickers where the slope crosses zero.

The fall-back rule was preferred because it gives a start date and a stop date
rather than a per-period vote, cannot produce a one-day trend, and has one
setting with a plain meaning: **how far price has to fall back before you call
it a change of direction.**

**Four hard requirements on it:**

- **Worked out from returns, never from price levels**, so a 10% move counts
  the same at $50 and at $5,000. Otherwise a model can learn this price level
  and this volatility rather than what a falling market looks like — it would
  look perfect in training and fail on a future stretch of the same type at a
  different price.
- **Per coin, not one market-wide clock.** Two coins will disagree about the
  same week. That is wanted: a coin that fell while everything else rose is
  exactly the case the falling models should be learning from.
- **The boundaries snap to period boundaries**, so every period is wholly one
  type and never half of each.
- **The type is only ever used to build what the forecasts are trained
  towards.** Nothing reads it at trade time. That is what removes any need to
  work out the market type live, and it is why the typing is free to look
  forward across a whole stretch without leaking anything.

## 4. The fall-back percentage is solved per coin

**The percentage is not a setting fixed across coins.** What is set is roughly
**how many changes of direction are wanted**, and each coin gets whatever
percentage delivers that.

Why: a fixed percentage gives a calm coin two stretches and a wild coin forty,
and then the falling models on the calm coin have one era to memorise.
Targeting the count fixes the thing that matters for training — how many
separate stretches of each type exist — and it keeps every coin on its own
scale, which is consistent with typing each coin on its own history.

**Two things about the search, both of which shape the build:**

- **The count moves in whole steps**, so it can jump from six to nine with
  nothing between. **The rule, decided by the owner on 2026-09-12: take the
  LARGEST percentage that gives AT LEAST the number asked for.** Largest keeps
  the stretches clean — a smaller percentage would chop them finer than needed.
  At-least means the search never comes up short of what was asked. Where the
  count jumps straight past the target, the percentage on the near side of the
  jump is the one taken, and the count it actually delivered is reported
  alongside the one that was asked for, so a coin that overshot says so.
- **The count does NOT simply rise as the percentage falls.** An earlier turn
  moves where later ones land. So walk the percentage across a range and read
  the count off each one. That is cheap, and **the shape of that walk, per
  coin, is the visual this tab wants** — it shows you at a glance whether a
  coin's count is stable across a band of percentages or balanced on a knife
  edge.

**The percentage found per coin becomes a stored result**, because the type
labels depend on it and stage 1 needs those labels. It is tied to the price
data as it stood on the day it was worked out.

## 5. Cutting stretches at the boundaries, and counting what is left

**A stretch does not respect the divisions.** The fall-back rule walks price
forward across the history and marks a turn wherever price falls back far
enough. It knows nothing about where `train` ends and `test` begins. So a
`rising` stretch can start in `train` and finish in `test`.

**Owner's decision, 2026-09-12: cut at EVERY boundary.** `train` / `test`,
`test` / `held`, and `held` / `reserve`. Every stretch then belongs to exactly
one part of the history, and every count in this document is unambiguous about
which part it is a count of.

### And each part is drawn by a walk that stops at that part's own end

**Added 2026-09-12, after the adversarial pass found the first build breaking
section 7.** The first build drew the stretches with ONE walk over the whole
span and only then cut them. The percentage it found was clean and stayed clean
under attack. The stretches were not.

A high only becomes a turn once price has fallen back from it, and that
fall-back can arrive in `held` or in the sealed `reserve`. Until it does, the
walk's last stretch runs to the end of ALL the data. So whether a piece sitting
inside `test` was a whole stretch or a left-over end depended on price the
reading is forbidden to consider — and the median those left-over ends are
measured against is built from that same set. Two price series identical for
every period of `train`, `test` and `held`, differing only inside the sealed
`reserve`, reported different medians and a different count of stretches **in
`train`**.

**So: `train` is read from a walk over `train`; `test` from a walk over
`train` + `test`; `held` from a walk out to the end of `held`; `reserve` from
the whole span.** The walk is prefix-deterministic — every stretch a turn
closed is identical in any walk that reaches that far — so the only thing this
changes is the unfinished run at the end, which is exactly the thing that was
reaching back. Nothing later can move an earlier part's figures now, at any
distance.

**The one coupling that remains is stated rather than hidden.** The median is a
`train` + `test` quantity by design (below), so a change inside `test` does move
`train`'s stub arithmetic. That is the rule as written and it is what the
owner asked for. What is not defensible, and no longer happens, is anything
past the end of `test` moving either of them.

**An unfinished run is a left-over end.** No turn ended it — it ran out of
data — which is exactly the definition below. It was not marked as one, so the
last part of every span counted an unfinished run as a whole stretch.

### The stubs that cutting creates

Cutting produces **stubs**: a stretch bounded by a turn on one side and a
calendar cut on the other. There are **at most two per part of the history**,
one at each end, because only the edges can be cut.

The question is whether a stub counts towards a demand like "two of each type
inside `test`". A stub of three days is not a trend; a stub of five weeks
plainly is. The owner, 2026-09-12: *"an algorithm that looks at the average
length of these stretches and figures out the stub pieces if they add up to
one."*

**The rule, and it needs no new parameter.** For each type, on each coin, take
the **median** length of that type's FULL stretches across `train` + `test`.
Then, for any part of the history:

> count = (full stretches of this type in it) + (that type's stub lengths) ÷ (that median)

Two half-length stubs add up to one. A three-day stub against a six-week median
contributes 0.07 and changes nothing.

**Median, not mean.** Stretch lengths are skewed — a few long trends drag a mean
upwards, which would make every stub count for less than it deserves.

**Fractions, not a threshold.** A threshold has a cliff: a stub one day under it
counts nothing, one day over counts as a whole stretch. That is the same fault
that sank the flat type in section 6 — a small move in a parameter flipping the
answer. A fraction has no cliff, and the median comes out of the coin's own
data rather than being typed.

### One demand does not need any of this

The stub rule serves ONE of the two demands. The other dissolves:

- **Balance** — how much of a part of the history is `rising` against `falling`
  — is about lengths. Stubs matter. Use the count above.
- **Handover** — does this part actually exercise the forecasts changing hands
  — is about **turns**. A turn either falls inside a window or it does not.
  **Turns never get cut.** So count them directly: two of each type means at
  least three turns inside the window, and no stub rule is involved.

One number cannot serve both. Two numbers, and only one of them reads the
median.

## 6. The training weight Coins produces

This section exists because of a question the owner asked on 2026-09-12, and
the answer changed the design. It began as *should there be a third type,
flat?* — and ended somewhere better.

### Why a third type was rejected, and what replaced it

A flat type would be a stretch that moved too little to be either. It has one
fatal problem, and the owner found it: **the typing has hindsight and a
`member` does not.** A turn is found by looking at where price went next, so
"flat" is a property of a whole stretch. At trade time a `member` sees only
what came before. Training it towards a target built from information it can
never have when it acts is training it towards something undetectable.

It is worse for flat than for the other two. Trends persist — thirty days into
a rise, the recent past looks like a rise. **A flat patch and the first days of
a trend look identical until the trend moves.**

So flat is not a type. **It is a weight.** Keep two types, keep exactly the
silence they already have, and weight down the periods where little was
happening so they teach each `member` less. Nothing has to be detected at trade
time; the model was simply taught less by the periods that had less to teach.

### What it buys, with the owner's own example

A `rising` stretch: 15% over six weeks. But twelve of those fifteen points
happen in one week, and the other three spread across five weeks.

On daily periods that is roughly 7 periods moving 1.6% each, and 35 periods
moving 0.086% each.

| | count | weight each | total pull |
|---|---|---|---|
| the fast week | 7 | 1 | 7 |
| the slow five weeks | 35 | 1 | 35 |

**Unweighted, the drift outvotes the real move 5 to 1**, and the `rising` set
learns the drift.

| | count | weight each | total pull |
|---|---|---|---|
| the fast week | 7 | 1.6 | 11.2 |
| the slow five weeks | 35 | 0.086 | 3.0 |

**Weighted, the fast week wins 3.7 to 1.** That reversal is the whole point.

### The mechanism

**One number per period, every period.** There is no chunking to invent: the
training already takes one weight per row and refuses unless the list is
exactly as long as the training rows, and one row is one period. On any
`daily-` chunk shape a period is a day, so per day and per period are the same
thing there; on `weekly-8d` a period is a week.

**The number is how far price moved over the span that period is about** — from
where its trade would open to where it would close. It needs no new parameter,
because it is already worked out: it is what that period's label comes from.

**Normalised so the average weight across the training rows is 1**, so what
changes is which rows matter relative to each other, not how much training
happens overall.

**Capped**, because one violent period would otherwise dominate everything. The
ceiling is a control on a screen, never a constant in a file (RULE FIVE).

### ONE weight vector, shared by both sets

This is the part that is easy to get wrong, so it is stated plainly.

**The same number applies to both sets of `members` on the same period. Not
mirrored, not inverted.** In a fast `rising` week the `rising` set learns hard
to call and the `falling` set learns hard to hold — because that is the week
where a falling model speaking would cost the most. In a slow drift both learn
faintly, for the same reason in reverse.

So it is one vector per coin and chunk shape, not one per set.

### What it does NOT change, and what it does NOT do

**It does not change who is silent.** The `rising` set is trained towards
silence across every `falling` stretch, and the `falling` set across every
`rising` stretch. That is unchanged and nothing here touches it. **The weight
says how hard to learn a row's lesson. It never changes which lesson that row
carries.** A falling-set row inside a `rising` stretch has the target "no call"
whether its weight is 0.1 or 3.0.

**It does not teach silence, either.** Down-weighting a period is not the same
as labelling it "no call". Those 35 drift periods still carry a target and the
`rising` set still votes on days that look like them — it has just been taught
about them faintly. **The thing that produces silence is the band**:
`balancedBandPct` already labels a period "nothing" when its move is under a
threshold, tuned so about one period in three says nothing.

So the two do different halves of one job and have to be set together:

- **the band is the cliff** — below it, no call at all
- **the weight is the taper above it** — small-but-not-tiny moves teach less

Without the weight the cliff is all there is, and 35 periods sitting *just*
above it still swamp the 7 that matter. That is the gap this fills.

### Why it is not a leak

It reads the period's own outcome, which the training already sees as that
period's label. It reads nothing from beyond the period that the label does not
already carry, and every weight is fixed before training starts. It is the same
shape as the class weighting already in use.

### The guard it needs, and the bet it makes

**It multiplies against weights that already exist** — the balance weighting,
the recency weighting on **History**, and the difficulty weighting proposed for
**Sweep** if that is ever built. Three or four multiplied together can leave
almost all of the effective training resting on a handful of periods. The
recency weighting already refuses when too little effective history is left.
**The same guard has to cover all of them together rather than each alone**, or
it passes three times and still leaves nothing.

**And the honest bet, recorded as a bet rather than a fact.** Weighting towards
the periods that moved means each `member` sees the big moves clearly and the
mild ones faintly. If what it actually meets is mostly mild, it has been
trained for the wrong thing. The counter is that mild periods do not need skill
— a fixed direction handles them and the four comparisons already price that —
but that is a claim about which kind of period will dominate, and nobody has
measured it.

### Where the work is split

**Coins works the number out and stores it** against the coin's history, beside
the type labels, per section 12. **Sweep multiplies it in** when it trains. How
the training applies it belongs with `TREND-TRAINING-DESIGN.md`, not here.

### Open, and not guessed at

**Whether the weight should act on runs rather than on single periods.**
Periods overlap in what they read: on `daily-4d` they start a day apart but
each reads back 96 hours, so neighbouring rows share three quarters of their
window. Four adjacent periods are not four independent observations — they are
closer to one seen four times. Which means down-weighting a single period
changes almost nothing, and **if this is going to bite it may have to act on
runs of periods rather than on rows one at a time.** Worth settling before it
is built.

## 7. Which stretches the search may read

**Owner's decision, 2026-09-12**, and it replaces what `TREND-TRAINING-DESIGN.md`
section A says. That document says *"Held and reserve are never opened by any of
this."* That is now half right, and here is the whole of it.

**The parameter is solved on `train` + `test` only.** The percentage is chosen
to hit the target count of direction changes across the two stretches the models
actually learn from. **`held` and `reserve` get no vote in choosing it.**

**Then the settled percentage is applied to `held` and `reserve`, and what is
there is reported.** Counts and balance per stretch, on the screen, and **never
fed back into the search**. So you find out before you sweep that a coin's
`held` runs 96% one way — instead of finding out at **Verify**, after the whole
sweep is spent, which is a failure that has already happened.

**It is never a gate.** The reading is shown, warned about and sortable, and
**any coin stays usable however it looks**. The owner, 2026-09-12: *"we can
override at any point and continue to use the data no matter how it looks."*

**And a one-directional `reserve` is a test case, not a defect.** It is exactly
where you would want to watch one set of `members` sit out while the other
votes, and see whether the thing still works. Rejecting those coins would throw
away the most informative ones.

**The bias this leaves, named rather than waved off.** If coins ARE dropped by
hand for a one-directional `held`, then the population **Verify** judges has
been selected for being measurable. That is mild — it selects for terrain, not
for profit, and the type labels never reach trade time — but it is a bias and
it is written down as one.

**Why holding the two stretches out entirely was rejected:** the worst tail
slice in section 11 is *defined* on the tail. Hold out the tail and the score
the owner asked for cannot be computed at all.

## 8. What is read, and where — reported, never enforced

**This tab reports. It does not refuse.** Owner's decision, 2026-09-12, and it
governs everything below: *"We're not even blocking coins with this anyways.
We're only reporting."*

That matters because the wording here used to say otherwise. It came out of
`TREND-TRAINING-DESIGN.md`, which opens stage zero as *"a pass that decides
which coins are eligible"* — and this document then carried both premises at
once, saying "never a gate" in one place and setting floors a coin "must stay
clear of" in another. **The owner's premise is the one that survives.** There
are no cut-offs anywhere on this tab. Every figure below is something you look
at and sort by, and you decide.

### What is read, per part of history

Worked out separately for each of the three jobs a stretch can do:

| type of history | what it is worth knowing |
|---|---|
| **fitting** | how many separate `rising` and `falling` stretches there are for the two sets of `members` to learn from, and whether either side is one era wearing a type's name |
| **choosing** | whether a choice made here would be a choice about one direction |
| **judging** | whether a claim made here is a claim about trading, or about a market that only went one way |

**Read per part, not per span.** A span can be beautifully mixed and still hold
a stretch inside it that runs one way from end to end. That is the whole reason
these are separate numbers rather than one.

### The readings

- **Turns inside each part.** Two of each type inside `test` means four
  stretches and three changes of direction — enough that it actually exercises
  the forecasts handing over. A weaker reading, some number of periods of each
  type, could be satisfied by one long rise and one long fall with a single
  handover, which shows almost nothing. **Counted as turns, per section 5** —
  turns never get cut at a boundary, so this reading needs no stub arithmetic.
- **Whether each type appears more than ONCE inside `train`, in SEPARATED
  stretches.** One long stretch of a type can be memorised as a period of the
  calendar rather than learned as a condition. A coin with one long rise and
  one long fall is worth knowing about before it is swept, not after.
- **The split of time, per part** — how much of `train` was `rising` against
  `falling`, and the same for `test`, `held` and `reserve`. Two numbers, one per
  type, reported. **Not a test, and there is no cut-off on either of them.**
- **The count of changes is NOT the same as the split of time.** A coin can turn
  ten times and still spend 85% of its time rising; the falling set then sees a
  tenth of the periods as real calls and the rest as stay-quiet. Both numbers
  are needed and neither substitutes for the other.
- **Where a side falls under the level the training arithmetic can correct
  for** — roughly one row in sixty, about 1.7%, from finding 5 in section 14.
  Below that the existing weight cap under-corrects and staying quiet starts
  winning. **This is shown beside the coin, not enforced.** It tells you the
  thin side of that coin will not be rescued by weighting, and you decide what
  to do about it.

### The boundaries do NOT move — owner's decision, 2026-09-12

`TREND-TRAINING-DESIGN.md` section D had the test boundary sliding earlier
until `test` held two of each type, with a cap on how far it could go and
rejection of any coin that needed more. **That is dropped.** The owner:
*"We're gonna keep those fixed instead, and we're gonna tune the parameters,
the percentages, which identify what is rising and falling instead."*

**So the `window layout` divides the history and nothing this tab does moves
it.** The one thing that is tuned is the fall-back percentage of section 3.
No cap, no boundary search, and no coin rejected for needing one.

Three things follow, and two of them are improvements:

- **`test` is no longer selected for turning.** Under the old design every
  coin's `test` was, by construction, a turning stretch — a clean one-way
  stretch would never have been tested on. A rule could then be tuned on
  switching and judged on a stretch that never switched. With the boundaries
  fixed, `test` is whatever the history actually put there, and section 7
  reports it either way.
- **No training data is given away.** Moving the boundary earlier would have
  taken the most recent part of `train` — the periods closest to what the
  forecasts will face — and handed them to `test`. That cost is gone.
- **The one lever is pulled towards two things at once.** The number of changes
  across `train` and `test`, and two of each type inside `test`, are both
  reached by lowering the same percentage. Changes are not spread evenly in
  time, so getting four stretches into the last 13% may need far more total
  changes than would otherwise be wanted. **Solve for both at once, per coin,
  rather than in sequence, or they fight** — and when no percentage reaches
  both, say so on the screen rather than moving anything or dropping the coin.

## 9. Both window layouts, every coin

**Coins works out and tunes the parameters for BOTH `window layout` choices —
`61/13/13/13 (sealed exam)` and `70/15/15` — for every coin.**

- `61/13/13/13 (sealed exam)` is `train` / `test` / `held` / `reserve`.
- `70/15/15` is `train` / `test` / `held`.

They give different amounts of history to learn and choose on:

| `window layout` | train + test | kept back |
|---|---|---|
| `61/13/13/13 (sealed exam)` | 74% | `held` 13%, `reserve` 13% |
| `70/15/15` | 85% | `held` 15% |

Both are provided for all coins, and **a coin's fitness is assessed per
layout**: a coin can be fit under one and not the other. So the metadata is per
coin **per layout**, and so is the ordering.

**And it is worth knowing on this screen** that a `70/15/15` run can never reach
**Greenlight** — it has no `reserve`. That is a property of the layout, decided
elsewhere, and it is repeated here because it changes what a coin's fitness
under `70/15/15` is actually for.

## 10. What a coin ends up with

**Three readings per coin.**

| reading | how many | what it answers |
|---|---|---|
| two-set voting, `61/13/13/13 (sealed exam)` | one per coin | can this coin be trained two ways under this layout? |
| two-set voting, `70/15/15` | one per coin | can this coin be trained two ways under this layout? |
| traditional one-set voting | one per coin, **not** per layout | is this coin worth trading at all, the way we do it today? |

The third is the one that decides whether a coin is worth sweeping at all.

## 11. The traditional score

This is the reading for the way the system works today — one set of `members`,
voting everywhere — and it is **one reading per coin, not per layout**.

### The problem it has to catch

The owner, 2026-09-12: *"we could have a setup where the held is all up, when
the reserve is all down, which is problematic potentially if the training
period was a general mix of up and down ... We've seen that on some of the
testing so far that it was hard to get good results when the verified data was
all in one direction."*

So the question is not "does this coin's history contain a mix". It is: **could
a stretch of this history land all one way?** A span can be perfectly balanced
overall and still hand `held` nothing but a rise.

### It is computed from an untuned reading of direction

**The traditional score must not be worked out from the tuned `rising` and
`falling` parameters.** Those exist for two-set training, and the traditional
configuration has no such split. If the traditional number were built on them,
re-tuning the parameters for two-set training would silently move every coin's
traditional score with it.

So: a plain, fixed reading of direction, with nothing tunable in it — and, per
section 3, worked out from returns rather than price levels, for the same
reason.

### Two numbers, both shown, both labelled

**Number one — the worst tail slice.** Slide a window the size the layouts
actually carve — the last 13% and the last 15% — across the whole span. At each
position measure how balanced `rising` and `falling` are. The score is the
**worst** balance found anywhere. It answers the failure above directly:
somewhere in this history there is a stretch that runs all one way.

**Number two — the drift.** Cut the span into equal parts, measure the balance
of each part, and score how much that balance moves from part to part. This
catches "the training part was a general mix and the last part was all one way"
head on, and it is what makes the visual useful: it shows you WHERE the
one-sided stretch is, not merely that one exists.

**Both are shown, and both are labelled on the screen so it is plain which is
which.** Never two bare figures side by side.

**And both move with how much history a coin has** (measured 2026-09-12, after
the adversarial pass). Each measures over a SHARE of the span, so a short coin
is measured over short windows. On a coin with no trend at all, 300 trials per
length:

| periods | worst tail slice reads 0 | mean worst tail slice | mean drift |
|---|---|---|---|
| 40 | 72.7% | 0.046 | 0.120 |
| 100 | 1% | 0.185 | 0.094 |
| 1000 | 0% | 0.393 | 0.030 |
| 2000 | 0% | 0.425 | 0.021 |

Nearly three quarters of trendless forty-period coins score the worst value the
first number has. **Two coins with different amounts of cached history are not
comparable on either number**, and ordering the table by one of them orders it
partly by how much history each coin happens to have. That is said on the
screen, in the note above the table, and the period count sits beside both
numbers so it can be read with them.

**What is NOT done about it, and why.** No cut-off, no normalising, no
adjustment: this tab reports (section 8), and an adjustment would be a second
arithmetic to argue with. A reference point — what a no-trend coin of that
length would have scored — is the obvious next thing and it is **an open item
for the owner**, not something a session decides. It is in section 17.

**The widths are the ones the layouts actually carve**, read out of the
engine's own split at that period count — the sealed `reserve` of the four-way
layout and the held-back stretch of the three-way one. Both layouts always, so
this stays one reading per coin. They are never typed here; the first build had
`0.13` and `0.15` as a default argument nothing ever passed, which is a second
copy of the arithmetic and a value with no control (RULE FIVE).

## 12. The metadata written on a coin's history

When the settings have been tuned on a coin's history, they are **saved as
metadata against that coin's history** — they belong to the coin, not to a run.

What is recorded:

- **the fall-back percentage found for that coin**, per `window layout`;
- **the shape of the walk** that found it — the count of changes at each
  percentage tried, which is what section 4's visual draws;
- **the type labels** the settled percentage produces, since stage 1 needs them;
- **the counts and the balance of each type, per stretch** — `train`, `test`,
  `held` and `reserve` separately, not just per span;
- **the three readings** from section 10;
- **the provenance: the total range the history data came from.**

The provenance is not decoration. A score cannot be read honestly without
knowing which span and which parameter values produced it, and a coin whose
history has since grown must read as **stale** rather than quietly wrong.

## 13. The screen

- A **score per coin**, with the coins **ordered by it**.
- The score reads **visually** — you can see what you are looking at per coin,
  not only a number. Section 4's walk and section 11's drift are what make that
  possible.
- Every figure labelled, per section 11.
- The `held` and `reserve` reading shown as a **warning, never a gate**, per
  section 7.

Nothing here has a name yet. Naming waits until the controls exist, are
deployed, and the word list is regenerated from what the box serves
(RULE ONE-A).

## 14. Findings read out of the code

Every one of these was read out of the named file. **They are findings, not
decisions.** Three bear directly on this tab; three belong to **Sweep** and are
listed so nobody thinks this tab solved them.

**Bearing on Coins:**

1. **The weight cap starts biting at about one row in sixty.**
   `lib/bracket.js` sets each answer's weight to the row count divided by the
   number of answers times that answer's rows, capped at 20. With three answers
   the cap binds once an answer falls below about 1.7% of rows. Below that the
   weighting under-corrects and staying quiet starts winning — the exact thing
   the owner said must not happen. **So this tab has a number worth SHOWING
   beside a coin** — not a limit it enforces (section 8). A coin whose thin
   side is under it will not be rescued by weighting, and that is a thing to
   know before sweeping it, not a reason for this tab to refuse it. The cap
   itself should be visible on a screen rather than a constant in a file
   (RULE FIVE).
2. **Weighting cannot manufacture data.** On a coin that is 90% one way, each
   real period of the other counts nine times, so a handful of unusual periods
   in one short stretch drive the whole model. Weighting repairs a mild
   imbalance; it cannot repair a thin one. That is why the split of time is
   worth reading on this tab rather than assumed away — not so this tab can
   refuse a coin, but so nobody expects the weighting to fix a side that is
   simply not there.
3. **The band that decides "too small to bother with" must be chosen AFTER the
   mask.** `balancedBandPct` in `lib/dataset.js` picks that band as the move
   size making about one period in three say nothing, computed from the training
   periods only. If everything outside a type is then overwritten to silence,
   the band was tuned for a population that no longer exists. It has to be
   chosen on the periods inside that model's own type. Coins does not fix this,
   but the counts this tab produces are what it would have to be recomputed
   against.

**Belonging to Sweep, listed so they are not lost:**

4. **The copy check would silently undo the doubling.** `voiceGroups` in
   `lib/agreement.js` measures likeness as the share of ALL moments two
   `members` agree on. Two falling models are both silent through every rising
   stretch, so on a coin that rises 70% of the time they agree 70% of the time
   before either has said anything — and the default likeness threshold is 98.
   The fix is small: measure likeness only over the moments where at least one
   of the pair speaks.
5. **A bar set as a share of all the `members` becomes unreachable.** With half
   the `committee` structurally silent, a bar set as a share of the `members`
   that exist cannot be cleared above roughly a half. The `its own history` bar
   already handles this; `all of them` stops being a sensible bar for these
   committees.
6. **`families` should not treat a type as a kind of evidence.** A type is a
   different job, not different evidence. Left alone, a rising model and a
   falling model would look like two kinds of evidence agreeing when only one of
   them is awake.

## 15. The risk that is mine, not the owner's

> Proposed 2026-09-09 and recorded at the owner's request. Recording is not
> agreeing.

**The whole thing can collapse into following the trend.** If, inside a falling
stretch, nearly every real call is short, then the falling models have learned
"short" and the system reduces to a trend detector plus follow-the-trend.

This is not hypothetical. On the `reserve` of the set already on the box, going
short every period made money. A system whose entire skill was detecting the
fall and following it would have scored beautifully there, and against the money
gate as it stands today it would be indistinguishable from real signal.

**The comparison that separates them is the best of all four**, which is Part 2
of `VERIFY-DESIGN.md`. Nothing built out of this document should be judged
without it.

## 16. Decisions taken

- **2026-09-12 — the budget rule does not apply to this tab.** Coins reads all
  of the history, including `held` and `reserve`. A session raised that as a
  possible conflict with the rule that a judging stretch must not influence a
  choice. The owner's ruling: *"We are picking instruments that are useful for
  training and getting bent out of shape on making choosing at this stage is
  completely irrelevant."* Settled. Not to be reopened.
- **2026-09-12 — the parameter search reads `train` + `test` only; `held` and
  `reserve` are read and REPORTED, never fed back.** Section 7. This replaces
  `TREND-TRAINING-DESIGN.md` section A's "held and reserve are never opened".
- **2026-09-12 — the `held` / `reserve` reading is never a gate.** Warn, show,
  sort, override. A one-directional `reserve` is a test case, not a defect.
- **2026-09-12 — `members` vote; they do not judge.** Section 2.
- **2026-09-12 — the traditional reading is two numbers, not one combined
  figure**, and both are shown and labelled.
- **2026-09-12 — Sweep's coin list comes out of Coins**, rather than being
  typed in.
- **2026-09-12 — the fall-back percentage search takes the LARGEST percentage
  that gives AT LEAST the number of changes asked for.** The owner, asked
  directly, answered yes to the recommendation that had been sitting in
  section 4. That was the last thing genuinely blocking a build of this tab.
- **2026-09-12 — this tab REPORTS and never refuses.** No cut-offs anywhere on
  it, on any reading. The owner: *"We're not even blocking coins with this
  anyways. We're only reporting."* This replaces the premise inherited from
  `TREND-TRAINING-DESIGN.md`, which opens stage zero as a pass that decides
  which coins are eligible. Every figure is shown and sortable; the choice is
  the owner's at the screen. Section 8.
- **2026-09-12 — stretches are CUT AT EVERY BOUNDARY**, so each belongs to
  exactly one of `train`, `test`, `held`, `reserve`. Stubs count as fractions
  of that type's median full length; turns are counted directly and need no
  stub rule. Section 5.
- **2026-09-12 — there is no third type. Flatness is a WEIGHT, not a label.**
  A flat type cannot work: the typing has hindsight and a `member` does not,
  so it would be trained towards something undetectable at trade time. The
  weight does the same job with no detectability requirement. Section 6.
- **2026-09-12 — ONE weight vector, shared by both sets of `members`.** Not
  mirrored, not inverted. And it changes nothing about who is silent: the
  weight says how hard to learn a row, never which lesson that row carries.
  Section 6.
- **2026-09-12 — the word is `coin`, not `pair`.** This tab says `coin`, and
  **Data** was changed to say it too (3.114.1), so every screen now agrees.
- **2026-09-12 — the `train` and `test` boundaries are FIXED and this tab
  never moves them.** Only the fall-back percentage is tuned. This replaces
  `TREND-TRAINING-DESIGN.md` section D's sliding boundary, its cap, and the
  rejection of coins that needed the boundary moved too far. Section 8.

## 17. Open items

- **Whether the training weight acts on runs of periods rather than on single
  periods.** Neighbouring periods share most of their look-back window, so
  down-weighting one changes almost nothing. Section 6.
- **Which of the two traditional numbers orders the list** — the worst tail
  slice, or the drift.
- **What the screen should show first** for each of fitting, choosing and
  judging — which of the readings in section 8 leads, and which sit behind it.
  There is no bar to set, so this is a question about presentation, not about
  what a coin has to clear.
- **The name of every control on this screen.**
- **Every cost in this document. Not one of them has been measured.**

**Added 2026-09-12 by the adversarial pass, and every one of these is the
owner's call, not a session's:**

- **A reference point for the two traditional numbers.** Both move with how
  much history a coin has (section 11), so 0.05 cannot be told from alarming
  without knowing what a no-trend coin of that length would score. Working that
  out per coin is cheap — scramble the coin's own moves a few hundred times and
  read the same number off each — but it is a new reading on the screen and it
  is not in this document, so it waits.
- **What to do about a record written under an older shape.** Today the reader
  NAMES it and says to read the coin again; it does not migrate it. That is
  defensible here and only here, because a Coins reading costs seconds and can
  be re-taken, unlike a sweep set — but RULE NINE's default is migrate, so the
  owner should say which they want before a second shape change happens.
- **The engine's own class-weight ceiling is a constant in `lib/bracket.js`**,
  not a control (RULE FIVE). Section 14 finding 1 already said it should be on
  a screen. This tab now READS it, so the level it quotes is always the
  engine's — but the ceiling itself is still not the owner's to set.
- **The reserve share is typed twice in `lib/stagework.js`** (the sealed layout
  and the retrain layout). There is now one shared function beside
  `splitBounds` and this tab reads it; the engine still types its own. Pointing
  those two at it is an engine change and was not in this loop's work.
- **A percentage step small enough to be absurd is walked in full.** At a step
  of one ten-millionth over the default range that is roughly 290 million
  typings per coin, about 22 minutes with nothing else able to run. The box on
  the screen carries a smallest step, which is the owner's control; no cut-off
  was added in the code, because a cut-off is a number to argue with and this
  tab does not have those.

## 18. What is not in here

- **How the two sets of `members` are actually trained**, the masking, the
  balance weighting and the difficulty weighting. All of that stays in
  `TREND-TRAINING-DESIGN.md`; it belongs to **Sweep**. The one place this
  document crosses into it is section 6, and only as far as the boundary drawn
  there: **Coins works the training weight out and stores it; Sweep multiplies
  it in.**
- **The parameter values themselves.** This document says what is tuned and
  what it is tuned for; it does not pick numbers.
- **Anything about the record sets already on the box.** Coins changes nothing
  about them.
