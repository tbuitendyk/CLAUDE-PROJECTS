# Coins — vetting a coin's history before anything is trained

Dictated by the owner, 2026-09-12, and written down here in their words.
**Nothing in this document is built.** The **Coins** tab exists as a screen
with nothing on it, and every piece below waits for the owner, one at a time.

## Read this first: there are almost no screen words yet

**Coins** today carries exactly one control label — `Coins`, the tab itself —
and nine printed sentences. That is the whole of its vocabulary
(`SCREEN-WORDS.md`, the **Coins** list). So almost everything in this document
is described by what it DOES, not by what it will be called, and where a name
is needed the document says plainly that there is no name for it yet.

Two words the screen already uses, and this document uses them the same way:

| On the **Coins** screen | The owner's word for it |
|---|---|
| the stretches in which each coin was `rising` | up action |
| the stretches in which it was `falling` | down action |

They are the same thing. `rising` and `falling` are what the screen prints, so
they are what this document says.

One more, from **Sweep**: `window layout` is the control that picks between the
two divisions of history. This document uses that name for it.

And one that has no name yet: **Sweep** has no control on its word list for
picking which coins a run covers — what it names is `singles`, `doubles` and
`triples`. Where this document says Coins picks coins "the way Sweep does", it
means the same kind of choice, and the label is not something anybody can point
at yet.

---

## 1. What Coins is for

**To vet, in advance, which shapes of history are good — meaning they hold a
mix of both `rising` and `falling` action.**

Two things come out of that, and they are the whole point of the tab:

1. **Better choices at Sweep.** You go into a sweep knowing which coins have
   history worth training on, instead of finding out afterwards.
2. **The numbers a coin needs to be trained two ways** — how many `rising`
   stretches and how many `falling` stretches it actually has, recorded against
   that coin's history.

Coins sits between **Data** and **Sweep** because a record set built the second
way is a different thing from one built the first way. The vetting has to
happen before the sweep, not after it.

## 2. Why it exists: Sweep is going to run two ways

**Sweep** will offer a choice of how a coin's `members` are trained.

- **Two sets of `members`.** One set trained on the `rising` stretches, which
  is silent on the `falling` ones. One set trained on the `falling` stretches,
  which is silent on the `rising` ones. Each set votes only inside its own kind
  of action.
- **One set of `members`.** The way it works today: one set trained on all of a
  coin's history, voting everywhere.

**A note on one word.** In the budget rule, "judging" means a claim about what
will happen, spent once. That is not what `members` do. Throughout this
document `members` **vote**; nothing they do is called judging. The owner's
instruction, 2026-09-12: *"Don't use the word judging there if it's gonna
confuse things. Voting, training, something like that."*

Two sets of `members` only works if a coin's history actually holds enough of
both kinds of action, in the right places. Working out whether it does is what
Coins is for.

## 3. What Coins does

**It makes passes through the history data.**

On each pass it works out the parameters that establish where the `rising`
stretches and the `falling` stretches are, and then checks that there are
enough of both **inside every part of the history that has to confirm the
functionality** — not just enough across the whole span.

### Scope

Three ways, the owner's choice each time:

- every coin;
- one coin at a time;
- a selection of coins, the same kind of choice **Sweep** offers.

### The parameters, and tuning them

The parameters that define the `rising` paths and the `falling` paths are
**tunable, not fixed**. Coins carries an algorithm that tunes them.

What the algorithm is tuning FOR is the thing that makes this different from a
general trend detector: **a history structure that can actually train two sets
of `members`.** Each set needs enough of its own kind of action, in the part of
history where the models learn, or it has nothing to learn from. Parameters
that carve beautiful trends but leave one set with three stretches to train on
are the wrong parameters.

### How much of each kind, per type of history

**Worked out in advance, and separately for each of the three jobs a stretch
can do:**

| type | what it needs enough of |
|---|---|
| **fitting** | enough `rising` and enough `falling` for BOTH sets of `members` to be trained |
| **choosing** | enough of both that a choice made here is not a choice about one direction |
| **judging** | enough of both that the claim is a claim about trading, not about a market that only went one way |

This is a per-type requirement. One number for the whole span does not answer
it — a span can be beautifully mixed and still have a stretch inside it that
runs one way from end to end.

## 4. Both window layouts, every coin

**Coins works out and tunes the parameters for BOTH `window layout` choices —
61/13/13/13 and 70/15/15 — for every coin.**

- 61/13/13/13 is `train` / `test` / `held` / `reserve`.
- 70/15/15 is `train` / `test` / `held`.

Both are provided for all coins, and **a coin's fitness is assessed per
layout**: a coin can be fit under one and not the other. So the metadata is per
coin **per layout**, and so is the ordering.

## 5. What a coin ends up with

**Three readings per coin.**

| reading | how many | what it answers |
|---|---|---|
| two-set voting, 61/13/13/13 | one per coin | can this coin be trained two ways under this layout? |
| two-set voting, 70/15/15 | one per coin | can this coin be trained two ways under this layout? |
| traditional one-set voting | one per coin, **not** per layout | is this coin worth trading at all, the way we do it today? |

The third is the one that decides whether a coin is worth sweeping at all.

## 6. The traditional score

This is the reading for the way the system works today — one set of `members`,
voting everywhere — and it is **one reading per coin, not per layout**.

### The problem it has to catch

The owner, 2026-09-12: *"we could have a setup where the held is all up, when
the reserve is all down, which is problematic potentially if the training
period was a general mix of up and down ... We've seen that on some of the
testing so far that it was hard to get good results when the verified data was
all in one direction."*

So the question is not "does this coin's history contain a mix". It is:
**could a stretch of this history land all one way?** A span can be perfectly
balanced overall and still hand `held` nothing but a rise.

### It is computed from an untuned reading of direction

**The traditional score must not be worked out from the tuned `rising` and
`falling` parameters.** Those exist for two-set training, and the traditional
configuration has no such split. If the traditional number were built on them,
re-tuning the parameters for two-set training would silently move every coin's
traditional score with it.

So: a plain, fixed reading of direction, with nothing tunable in it.

### Two numbers, both shown, both labelled

**Number one — the worst tail slice.** Slide a window the size the layouts
actually carve — the last 13% and the last 15% — across the whole span. At each
position measure how balanced `rising` and `falling` are. The score is the
**worst** balance found anywhere. It answers the failure above directly:
somewhere in this history there is a stretch that runs all one way.

**Number two — the drift.** Cut the span into equal parts, measure the balance
of each part, and score how much that balance moves from part to part. This
catches "the training part was a general mix and the last part was all one
way" head on, and it is what makes the visual useful: it shows you WHERE the
one-sided stretch is, not merely that one exists.

**Both are shown, and both are labelled on the screen so it is plain which is
which.** Never two bare figures side by side.

## 7. The metadata written on a coin's history

When the settings have been tuned on a coin's history, they are **saved as
metadata against that coin's history** — they belong to the coin, not to a run.

What is recorded:

- the tuned parameters that define the `rising` and `falling` stretches;
- the counts of each, per `window layout`, per stretch;
- the three readings from section 5;
- **the provenance: the total range the history data came from.**

The provenance is not decoration. A score cannot be read honestly without
knowing which span and which parameter values produced it, and a coin whose
history has since grown must read as stale rather than quietly wrong.

## 8. The screen

- A **score per coin**, with the coins **ordered by it**.
- The score reads **visually** — you can see what you are looking at per coin,
  not only a number.
- Every figure labelled, per section 6.

Nothing here has a name yet. Naming waits until the controls exist, are
deployed, and the word list is regenerated from what the box serves.

## 9. Decisions taken

- **2026-09-12 — the budget rule does not apply to this tab.** Coins reads all
  of the history, including `held` and `reserve`, to count `rising` and
  `falling` stretches. A session raised that as a possible conflict with the
  rule that a judging stretch must not influence a choice. The owner's ruling:
  *"We are picking instruments that are useful for training and getting bent
  out of shape on making choosing at this stage is completely irrelevant."*
  Settled. Not to be reopened.
- **2026-09-12 — `members` vote; they do not judge.** See section 2.
- **2026-09-12 — the traditional reading is two numbers, not one combined
  figure**, and both are shown.

## 10. Open items

- **Which of the two traditional numbers orders the list** — the worst tail
  slice, or the drift. Not settled, and not guessed at here.
- **What counts as "enough"** for each of fitting, choosing and judging: a
  number the owner types, or one Coins recommends. Either way it is exposed
  through the interface, never baked in.
- **The name of every control on this screen.**

## 11. What is not in here

- How the two sets of `members` are actually trained. That belongs with
  **Sweep**, and it is a separate piece of work.
- The parameters themselves. This document says they are tuned and what they
  are tuned for; it does not pick their values.
- Anything about the record sets already on the box. Coins changes nothing
  about them.
