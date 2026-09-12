# Coins — vetting a coin's history before anything is trained

Dictated by the owner on 2026-09-12 and written down here in their words, then
completed on the same day by folding in everything technical from
`TREND-TRAINING-DESIGN.md` that belongs to this tab.

**Nothing in this document is built.** The **Coins** tab exists as a screen with
nothing on it, and every piece below waits for the owner, one at a time.

**Three kinds of thing are in here and they are kept apart on purpose**, the
same way `TREND-TRAINING-DESIGN.md` keeps them apart:

- **The owner's design** — sections 1 to 11. Recorded as given.
- **Findings read out of the code** — section 12. Read out of the named file,
  in the session that wrote it. Findings, not decisions.
- **What I proposed** — section 13, and it is marked as mine at the top of it.
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
   coins Sweep works from comes out of Coins rather than being typed in.**
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
more than a set percentage, mark the high as where the `rising` stretch ended
and the `falling` one began. Same rule the other way. Between two turns the
stretch is `rising` or `falling` by construction.

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
  nothing between. Recommended rule, **not yet the owner's decision**: take the
  largest percentage that gives at least the number asked for. Largest keeps
  the stretches clean; at-least means never coming up short.
- **The count does NOT simply rise as the percentage falls.** An earlier turn
  moves where later ones land. So walk the percentage across a range and read
  the count off each one. That is cheap, and **the shape of that walk, per
  coin, is the visual this tab wants** — it shows you at a glance whether a
  coin's count is stable across a band of percentages or balanced on a knife
  edge.

**The percentage found per coin becomes a stored result**, because the type
labels depend on it and stage 1 needs those labels. It is tied to the price
data as it stood on the day it was worked out.

## 5. Which stretches the search may read

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
slice in section 9 is *defined* on the tail. Hold out the tail and the score
the owner asked for cannot be computed at all.

## 6. How much of each kind, and where

Worked out in advance, and **separately for each of the three jobs a stretch
can do**:

| type of history | what it needs enough of |
|---|---|
| **fitting** | enough separate `rising` and `falling` stretches for both sets of `members` to learn the difference, not memorise one era |
| **choosing** | enough of both that a choice made here is not a choice about one direction |
| **judging** | enough of both that the claim is a claim about trading, not about a market that only went one way |

**This is a per-type requirement.** One number for the whole span does not
answer it — a span can be beautifully mixed and still have a stretch inside it
that runs one way from end to end.

### The concrete demands

- **At least two of each type inside `test`.** Two of each means `test` holds at
  least four stretches and three changes of direction, so it actually exercises
  whether the forecasts hand over. A weaker demand — some number of periods of
  each type — could be met by one long rise and one long fall with a single
  handover, which tests almost nothing.
- **Each type must appear more than ONCE inside the training stretch, in
  SEPARATED stretches.** One long stretch of a type can be memorised as a
  period of the calendar. This belongs in this tab's filter, alongside "both
  types present".
- **Both `train` and `test` have to satisfy the balance, not just the total.**
  If the changes all land in the training part, `test` could be one long rise,
  and testing then says nothing about handing over.
- **The count of changes is NOT the same as the balance.** A coin can give ten
  changes and still spend 85% of its time rising. Then the falling models see a
  tenth of the periods as real calls and the rest as stay-quiet. So this tab
  needs **both** numbers: how many changes, and how the time divides. The
  second decides whether a coin is trainable at all.
- **There is a floor the balance must stay clear of, and it comes out of the
  code.** See finding 5 in section 12: below roughly one row in sixty (~1.7%),
  the existing weight cap under-corrects and staying quiet starts winning
  again. That is a number this tab must not let a coin sit under.

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
  fixed, `test` is whatever the history actually put there, and section 5
  reports it either way.
- **No training data is given away.** Moving the boundary earlier would have
  taken the most recent part of `train` — the periods closest to what the
  forecasts will face — and handed them to `test`. That cost is gone.
- **The one lever has to satisfy two demands at once.** The number of changes
  across `train` and `test`, and two of each type inside `test`, are both
  reached by lowering the same percentage. Changes are not spread evenly in
  time, so getting four stretches into the last 13% may need far more total
  changes than would otherwise be asked for. **Solve for both at once, per
  coin, rather than in sequence, or they fight** — and when no percentage
  satisfies both, say so on the screen rather than moving anything.

## 7. Both window layouts, every coin

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

## 8. What a coin ends up with

**Three readings per coin.**

| reading | how many | what it answers |
|---|---|---|
| two-set voting, `61/13/13/13 (sealed exam)` | one per coin | can this coin be trained two ways under this layout? |
| two-set voting, `70/15/15` | one per coin | can this coin be trained two ways under this layout? |
| traditional one-set voting | one per coin, **not** per layout | is this coin worth trading at all, the way we do it today? |

The third is the one that decides whether a coin is worth sweeping at all.

## 9. The traditional score

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

## 10. The metadata written on a coin's history

When the settings have been tuned on a coin's history, they are **saved as
metadata against that coin's history** — they belong to the coin, not to a run.

What is recorded:

- **the fall-back percentage found for that coin**, per `window layout`;
- **the shape of the walk** that found it — the count of changes at each
  percentage tried, which is what section 4's visual draws;
- **the type labels** the settled percentage produces, since stage 1 needs them;
- **the counts and the balance of each type, per stretch** — `train`, `test`,
  `held` and `reserve` separately, not just per span;
- **the three readings** from section 8;
- **the provenance: the total range the history data came from.**

The provenance is not decoration. A score cannot be read honestly without
knowing which span and which parameter values produced it, and a coin whose
history has since grown must read as **stale** rather than quietly wrong.

## 11. The screen

- A **score per coin**, with the coins **ordered by it**.
- The score reads **visually** — you can see what you are looking at per coin,
  not only a number. Section 4's walk and section 9's drift are what make that
  possible.
- Every figure labelled, per section 9.
- The `held` and `reserve` reading shown as a **warning, never a gate**, per
  section 5.

Nothing here has a name yet. Naming waits until the controls exist, are
deployed, and the word list is regenerated from what the box serves
(RULE ONE-A).

## 12. Findings read out of the code

Every one of these was read out of the named file. **They are findings, not
decisions.** Three bear directly on this tab; three belong to **Sweep** and are
listed so nobody thinks this tab solved them.

**Bearing on Coins:**

1. **The weight cap starts biting at about one row in sixty.**
   `lib/bracket.js` sets each answer's weight to the row count divided by the
   number of answers times that answer's rows, capped at 20. With three answers
   the cap binds once an answer falls below about 1.7% of rows. Below that the
   weighting under-corrects and staying quiet starts winning — the exact thing
   the owner said must not happen. **So the balance test on this tab has a
   number it must stay clear of**, and the cap should be visible on a screen
   rather than a constant in a file (RULE FIVE).
2. **Weighting cannot manufacture data.** On a coin that is 90% one way, each
   real period of the other counts nine times, so a handful of unusual periods
   in one short stretch drive the whole model. Weighting repairs a mild
   imbalance; it cannot repair a thin one. That is the argument for the balance
   being decided on this tab rather than left for the weighting to rescue.
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

## 13. The risk that is mine, not the owner's

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

## 14. Decisions taken

- **2026-09-12 — the budget rule does not apply to this tab.** Coins reads all
  of the history, including `held` and `reserve`. A session raised that as a
  possible conflict with the rule that a judging stretch must not influence a
  choice. The owner's ruling: *"We are picking instruments that are useful for
  training and getting bent out of shape on making choosing at this stage is
  completely irrelevant."* Settled. Not to be reopened.
- **2026-09-12 — the parameter search reads `train` + `test` only; `held` and
  `reserve` are read and REPORTED, never fed back.** Section 5. This replaces
  `TREND-TRAINING-DESIGN.md` section A's "held and reserve are never opened".
- **2026-09-12 — the `held` / `reserve` reading is never a gate.** Warn, show,
  sort, override. A one-directional `reserve` is a test case, not a defect.
- **2026-09-12 — `members` vote; they do not judge.** Section 2.
- **2026-09-12 — the traditional reading is two numbers, not one combined
  figure**, and both are shown and labelled.
- **2026-09-12 — Sweep's coin list comes out of Coins**, rather than being
  typed in.
- **2026-09-12 — the word is `coin`, not `pair`.** This tab says `coin`, and
  **Data** was changed to say it too (3.114.1), so every screen now agrees.
- **2026-09-12 — the `train` and `test` boundaries are FIXED and this tab
  never moves them.** Only the fall-back percentage is tuned. This replaces
  `TREND-TRAINING-DESIGN.md` section D's sliding boundary, its cap, and the
  rejection of coins that needed the boundary moved too far. Section 6.

## 15. Open items

- **Which of the two traditional numbers orders the list** — the worst tail
  slice, or the drift.
- **The rule for picking the fall-back percentage when the count jumps past the
  target.** A recommendation is in section 4; it is not the owner's decision.
- **What counts as "enough"** for each of fitting, choosing and judging — a
  number the owner types, or one Coins recommends. Either way it is exposed
  through the interface, never baked in (RULE FIVE).
- **Whether the balance test is one number or two, and where it is set.**
- **The name of every control on this screen.**
- **Every cost in this document. Not one of them has been measured.**

## 16. What is not in here

- **How the two sets of `members` are actually trained**, the masking, the
  balance weighting and the difficulty weighting. All of that stays in
  `TREND-TRAINING-DESIGN.md`; it belongs to **Sweep**.
- **The parameter values themselves.** This document says what is tuned and
  what it is tuned for; it does not pick numbers.
- **Anything about the record sets already on the box.** Coins changes nothing
  about them.
