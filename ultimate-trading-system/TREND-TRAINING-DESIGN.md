# Sorting history into trending up and trending down, and training on it

The owner's design, spoken across 2026-09-09 and written down here so it is not
lost with the conversation. **Nothing in it is built and nothing will be until
the owner says so, part by part.**

Three kinds of thing are in this file and they are kept apart on purpose:

- **What the owner designed.** Sections A to F. Recorded as given. Where a
  choice was theirs, it says so.
- **What I found in the code that the design collides with.** Every one of
  these was read out of the named file in the session that wrote this. They are
  findings, not decisions.
- **What I proposed.** Section G, and the two risks near the end. The owner has
  asked for these to be recorded here; recording is not agreeing, and none of it
  is their decision yet.

It is a companion to `SELECTION-DESIGN.md` and `VERIFY-DESIGN.md`, and does not
overlap either. Those two are about how a setting earns the right to be
believed — the first holds the doctrine and the choosing screens, the second
holds everything that belongs to **Verify** (they were one document until
2026-09-12). This one is about how the
forecasts are trained in the first place. The two are independent and can be
built in either order.

## Read the words first

| Word here | What it means |
|---|---|
| period | One step of the system's clock. With `chunk shape` set to a daily choice, one day. `chunk shape` is on **Sweep**, **Boards** and **Funnel**. |
| stretch | A number of periods one after another, with no gaps. |
| train, test, held, reserve | The four parts a coin's history is divided into. Those four words are the owner's and are used exactly as they are (RULE ONE-D). On screen, **Sweep** offers the division as `window layout` with two choices, `70/15/15` and `61/13/13/13 (sealed exam)`. |
| the `committee` | The whole group of forecasts that vote on one coin. On **Sweep** and **Boards**. |
| `member` | One forecast inside it. On **Sweep** and **Boards**. |
| `logreg`, `boost` | The two different ways a forecast is worked out. Both on **Sweep** and **Boards**. |
| type | Trending up overall, or trending down overall. The owner's word for it in conversation. **There is no name for this on any screen, because nothing on any screen does it yet.** |
| the new tab | It exists now: the **Coins** tab, and its design is written in `COINS.md`. Where stage zero would live. The owner said "something like coins", sitting between **Data** and **Sweep**. It does not exist, so it has no screen name and none is used here. |
| `always long` | Open a position on every period in the up direction, at the setting's own horizon and costs. On **Funnel**, **Verify** and **History**. |
| the short version of `always long` | The same on every period in the down direction. **There is no name for this on any screen.** In the code it sits beside `always long` and is built the same way. |

One naming point, **settled by the owner on 2026-09-12: the word is `coin`.**
It used to be that **Data** said `pair` while **Sweep**, **Boards**, **Funnel**,
**Verify** and **History** said `coin`, so a new tab between them had to pick
one and disagree with a neighbour. **Data** was changed to say `coin` in
3.114.1. Every screen agrees, and this document says `coin` throughout.

---

# A — stage zero, and what it decides

**The owner's design.** A pass that decides which coins are eligible, run before
anything else. A new tab between **Data** and **Sweep**, so the order on screen
is: get the price history, decide which coins are eligible, then sweep. The list
of coins **Sweep** works from comes out of stage zero rather than being typed in.

**Eligibility is judged against the division the run will use.** The two
divisions give different amounts of history to train and test on:

| `window layout` | train + test | kept back |
|---|---|---|
| `61/13/13/13 (sealed exam)` | 74% | held 13%, reserve 13% |
| `70/15/15` | 85% | held 15% |

A coin can pass for one and fail for the other, so eligibility is per division,
not a single yes or no.

**Held and reserve are never opened by any of this.** Stage zero looks only at
the part that train and test will use.

---

# B — two types, and how a stretch is typed

**The owner's design.** Two types only: trending up overall, and trending down
overall. No third bucket. Every stretch is one or the other, so nothing is left
unclassified.

**How a turn is found: by how far price falls back.** Walk the price forward and
keep the highest point seen. When price has fallen back from that high by more
than a set percentage, mark the high as where the up stretch ended and the down
one began. Same rule the other way. Between two turns the stretch is up or down
by construction.

This was chosen over two alternatives, both of which were offered:

- price against its own average over the last N days, rejected because it flips
  back and forth in a flat market and produces one-week trends that are noise
- the slope of a straight line fitted through a window of price, rejected
  because it still flickers where the slope crosses zero

The chosen way was preferred because it gives a start date and a stop date
rather than a per-period vote, cannot produce a one-day trend, and has one
setting with a plain meaning: how far price has to fall back before you call it
a change of direction.

**Per coin, not one market-wide clock.** Two coins will disagree about the same
week. That is wanted: a coin that fell while everything else rose is exactly the
case the down models should be learning.

**The boundaries snap to period boundaries**, so every period is wholly one type
and never half of each.

**The type is only ever used to build what the forecasts are trained towards.**
Nothing reads it at trade time. That is what removes the need for anything to
work out the market type live, and it is why the typing is free to look forward
across the whole stretch without leaking anything.

---

# C — the fall-back percentage is solved per coin

**The owner's design.** The percentage is not a setting fixed across coins. What
is set is roughly how many changes of direction are wanted across train and
test. Each coin gets whatever percentage delivers that.

Why: a fixed percentage gives a calm coin two stretches and a wild coin forty,
and then the down models on the calm coin have one era to memorise. Targeting
the count fixes the thing that matters for training, which is how many separate
stretches of each type exist. It also keeps every coin on its own scale, which
is consistent with typing each coin on its own history.

**Two things to settle before this is built.**

- **The count moves in whole steps**, so it can jump from six to nine with
  nothing between. The rule I would recommend, not yet the owner's: take the
  largest percentage that gives at least the number asked for. Largest keeps the
  trends clean, at-least means never coming up short.
- **Do not assume the count only rises as the percentage falls.** An earlier turn
  moves where later ones land. Walk the percentage across a range and read the
  count off each. That is cheap and it gives a shape to look at per coin.

**The percentage found per coin becomes a stored result**, because the type
labels depend on it and stage 1 needs those labels. It is tied to the price data
as it stood on the day.

---

# D — what the test stretch must hold

**The owner's design.** At least two of each type inside test. If satisfying
that pushes the test stretch past a cap, the coin is rejected.

Two of each means the test stretch holds at least four stretches and three
changes of direction, so it actually exercises whether the forecasts hand over.
A weaker demand, some number of periods of each type, could be met by one long
up and one long down with a single handover, which tests almost nothing.

One cap does two jobs: how much test is too much, and which coins are out.

**Four things about it, all recorded as open.**

- **The two settings pull on the same lever.** The number of changes across train
  and test, and the demand for two of each inside test, are both satisfied by
  lowering the fall-back percentage. Changes are not spread evenly in time, so
  squeezing four stretches into the last 13% may need far more total changes than
  would otherwise be asked for. Solve for both at once per coin rather than in
  sequence, or they fight.
- **Two will be the usual figure among the coins that need the boundary moved**,
  because the move stops the instant the condition is met. Coins that already
  clear it at the default cut do not move at all and may sit comfortably above.
  The gap between those two groups is worth showing.
- **Say the cap in the same units as the division.** "Test may not exceed 25%"
  reads straight against "test is normally 13%".
- **This chooses test stretches that turn.** Demanding a change of direction
  inside test means every coin's test stretch is, by construction, a turning one.
  A clean one-way stretch would never be tested on. That is probably right, since
  turning is the hard case, but held and reserve are whatever they are, so a rule
  can be tuned on switching and judged on a stretch that never switches.

**Moving the boundary costs the most relevant training data.** Train comes first
and test follows, so moving the boundary earlier takes the most recent part of
training and gives it to test. Those are the periods closest to what the
forecasts will face.

---

# E — the balance number, and making silence not win

**The owner's design.** The balance between the two types is saved per coin, and
the weighting is set from it so a model that always stays quiet cannot score
well.

**Number of changes is not the same as balance.** A coin can give ten changes and
still spend 85% of its time going up. Then the down models see a tenth of the
periods as real calls and the rest as stay quiet. So stage zero needs both
numbers: how many changes, and how the time divides. The second decides whether
a coin is trainable at all.

**Train and test each have to satisfy it, not just the total** (the owner said
this before I did). If the changes all land in the train part, the test stretch
could be one long up-trend and testing then says nothing about handing over.

**Weighting cannot manufacture data.** On a coin that is 90% up, each real down
period counts nine times, so a handful of unusual periods in one short stretch
drive the whole down model. Weighting repairs a mild imbalance; it cannot repair
a thin one. That is the argument for the balance being a pass or fail at stage
zero rather than something the weighting is expected to rescue.

**A direct check on "silence does not win", recommended, not yet the owner's.**
Score a model that always says nothing, on the same weighted terms, and put that
number on screen beside the model's own score.

---

# F — doubling the members, with silence as the target

**The owner's design.** Every forecast there is one of today becomes two, one for
each type. All of them vote on every period. Since only one type is in force at
a time, roughly half the `committee` is silent at any moment.

**Each model trains across the WHOLE history, not part of it.** Outside its
own type the right answer is "no call", and the model is trained on that silence
rather than trusted to produce it. This is what removes the sample-size cost: no
model sees less data than it would have, and silence becomes something learned
rather than assumed.

**The owner's placement**, stated at the time as stages 1 and 2 and corrected by
them afterwards to include stage 3: stage 1 types each period, filters the coins
and masks the labels; stage 2 holds the `committee` and the bar; stage 3 is
affected because the number of `members` sets how many rungs the agreement dial
offers, and that list multiplies against every other dial in the block.

**Cost.** Twice the `members` is twice the stage 1 training. Stage 3 grows worse
than twice, for the reason above. Neither has been measured.

---

# G — weight the training by difficulty

> **Mine, not the owner's, proposed 2026-09-09 and recorded here at their
> request.** Sections A to F are their design. This is an addition to it and
> they have not decided on it.

## What it is for

Sections E and F make a model direction-neutral. They do not make it skilled.
A direction-neutral model with no edge does not make money in both kinds of
market; it pays the fees in both. Balance removes a bias. It does not create
signal, and nothing else in this design does either.

## The change

Weight each training period by how hard that period was for a fixed direction.
Periods where simply leaning one way lost are worth more. Periods where leaning
won are worth less.

A model that has learned nothing except "go long" then scores badly on its own
training objective, because the periods carrying the most weight are exactly the
ones where going long lost. It has to find something else or fail visibly during
training, rather than a year later on the reserve.

## Where it goes

The same place the balance weighting of section E goes: one weight per period,
multiplied in beside the existing weighting. Training already accepts per-period
weights, so nothing new has to be built to carry them.

## Why it is not a leak

It reads the period's own outcome, which the training already sees as that
period's label. It reads nothing from after the period beyond what the label
already carries, and every weight is fixed before training starts. It is the
same shape as the class weighting already in use.

## What has to be decided

- **Which direction bet defines "hard".** Weighting by how badly `always long`
  did would punish a long lean and reward a short one, which just moves the bias.
  Weighting by how badly the BETTER of the two directions did is symmetric: a
  period is easy only if some fixed direction would have taken it, and hardest
  when neither would. That is the one I would use.
- **The shape of the weight, and its cap.** One enormous period could otherwise
  dominate the whole training. There has to be a ceiling and it has to be
  visible, not a constant in a file.
- **Whether it is on by default.** It is a setting the owner sets (RULE FIVE),
  not something the code decides.

## What it interacts with, and the guard it needs

This multiplies against the balance weighting of section E, and against the
recency weighting that already exists. Three weightings multiplied together can
leave almost all of the effective training resting on a handful of periods.

The recency weighting already refuses when it leaves too little effective history
behind. **The same guard is needed here, applied to all three together rather
than to any one of them.** A refusal on each in isolation would pass three times
and still leave nothing.

## The honest risk

Weighting toward the hard periods means the model sees the easy ones faintly.
If what it actually meets is mostly easy periods, it has been trained for the
wrong thing.

The counter is that easy periods do not need skill — a fixed direction handles
them, and the four comparisons already price that. So the model is being asked
to earn its keep only where earning it matters. But that is a bet about which
kind of period will dominate, and it is recorded here as a bet rather than a
fact.

## One thing not to do

Do not switch this on at the same time as the type masking of section F. Two
changes to the training at once and the result cannot be read. One at a time,
and the first one is theirs, not mine.

---

# What I found in the code, and what it means for this design

Every one of these was read out of the named file. They are findings.

## 1. The copy check would silently undo the doubling

`voiceGroups` in `lib/agreement.js` groups `members` that make the same call
often enough, and gives each group one vote between them. It measures likeness
as the share of ALL moments on which two `members` agree.

Two down models are both silent through every up stretch. On a coin that spends
70% of its time going up they agree 70% of the time by construction, before
either has said anything. The default likeness threshold is 98, so they need
only a little genuine similarity on top of that free 70 to be merged into one
voice.

**The doubling would be paid for and then undone, quietly.** The fix is small:
measure likeness only over the moments where at least one of the pair speaks.

## 2. A bar set as a share of all the `members` becomes unreachable

`sides` in the same file counts up-votes and down-votes and ignores silence, so
a quiet `member` never votes against anything. That part is already right.

But with half the `committee` structurally silent, a bar set as a share of the
`members` that exist cannot be cleared above roughly a half. `count` against the
`all of them` bar would offer settings that can never fire.

The `its own history` bar already fixes this and the code says so for exactly
this reason: a bar set as a share of what exists only makes sense when the thing
weighed actually reaches its maximum. So the answer exists. It means `all of
them` stops being a sensible bar for these committees.

## 3. Three of the five ways of weighing cope with no change

`trained` adds up every `member`'s lean and takes the sign, with no gate at all.
A model trained to keep quiet leans near zero and contributes nothing.
`conviction` adds up the leans and requires the sign to back the majority. Both
degrade cleanly. Only `count` and `voices` break, per 1 and 2 above.

## 4. The band that decides "too small to bother with" must be chosen after the mask

Each period is labelled down, nothing, or up, where nothing means the move was
smaller than a band. `balancedBandPct` in `lib/dataset.js` picks that band as the
move size making about one period in three say nothing, computed from the
training periods only.

If the band is picked that way and everything outside the type is THEN
overwritten to silence, the band was tuned for a population that no longer
exists. It has to be chosen on the periods inside that model's own type, after
the mask, not before.

## 5. The weight cap starts biting at about one row in sixty

`lib/bracket.js` sets each answer's weight to the row count divided by the number
of answers times that answer's rows, capped at 20. With three answers the cap
binds once an answer falls below one row in sixty, about 1.7%. Below that the
weighting under-corrects and staying quiet starts winning again — the exact thing
the owner said must not happen.

**So the balance test at stage zero has a number it must stay clear of**, and the
cap should be something visible rather than a constant in a file.

## 6. `families` should not treat a type as a kind of evidence

It asks how many different kinds of evidence agree. A type is a different job,
not different evidence. Left alone, an up model and a down model would look like
two kinds of evidence agreeing when only one of them is awake.

---

# Two risks that are not in the code, and are mine

## The models can learn the era rather than the conditions

A model can learn this price level and this volatility rather than what a
falling market looks like. It would look perfect in training and fail on a
future stretch of the same type at a different price.

Two guards, both general rather than fitted to any dataset:

- work the type out from returns, never from price levels, so a 10% move counts
  the same at $50 and at $5,000
- require each type to appear more than once in the training stretch, in
  separated stretches, so it cannot be memorised as one period of the calendar.
  That belongs in stage zero's filter alongside "both types present".

## The whole thing can collapse into following the trend

If, inside a down stretch, nearly every real call is short, then the down models
have learned "short" and the system reduces to a trend detector plus
follow-the-trend.

This is not hypothetical. On the reserve of the set already on the box, going
short every period made money. A system whose entire skill was detecting the
fall and following it would have scored beautifully there, and against the money
gate as it stands today it would be indistinguishable from real signal.

**The comparison that separates them is the best of all four**, which is Part 2
of `VERIFY-DESIGN.md`. This design should not be judged without it.

---

# What is not decided

- What the tab, its controls and its columns are called. None of them exist, so
  none of them has a name, and none is invented here.
- The rule for picking the fall-back percentage when the count jumps past the
  target. A recommendation is in C; it is not the owner's decision yet.
- The cap on how far the test boundary may move.
- Whether the balance test is one number or two, and where it is set.
- Every cost in this document. Not one of them has been measured.
