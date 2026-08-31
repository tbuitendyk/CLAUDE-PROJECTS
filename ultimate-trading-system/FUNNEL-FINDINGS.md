# Found while building the Funnel — reported, NOT fixed

RULE SIX: work discovered inside a loop is not in the loop. Each of these is
written down and left for the owner to decide on. Nothing here has been touched.

---

## 1. The sealed window records where it starts and never where it ends

**Where:** `lib/bracketwork.js:333` and `lib/stagework.js:163`, both identical:

```js
reserve = { chunks: nReserve, fromTs: sealed[0].startTs, toTs: sealed[sealed.length - 1].endTs };
```

**What is wrong:** a chunk has no `endTs`. `endTs` appears nowhere in the
codebase except these two lines, so `toTs` has always been `undefined` and is
dropped on write. Read back from a real record on this box:

```
s1-mtdzekjr-9  reserve = {"chunks":50,"fromTs":1780790400000}
```

**Why it has not bitten:** `startReserveGrade` binds on `reserveFromTs` only, and
the end is recoverable from `chunks` plus the geometry. So nothing is wrong
today — but a field that is always undefined reads as a field that exists.

**What the fix would be:** either take the end from the last chunk's start plus
its span, or drop `toTs` so nothing looks like it is recording something it is
not. One line either way. It is in both code paths, so it is one decision.

---

## 2. The noise twin for funnel steps 1 to 3 cannot exist on any set written so far

Not a defect — a consequence, recorded so it is not discovered later as a
surprise.

Stage 3 stores `beat`, `pairs` and `lead` per record, but never the per-deal
MONEY. Steps 1 to 3 of the Funnel want the same reading computed on a noise
board, which needs each shuffled world's money for every setting. No set has it,
at any `null set size`.

So **split-half is the only comparison available today**, on every existing set,
at every step — which is exactly what the owner's second ruling anticipated. The
noise twin becomes available only if step 9 (board-wide noise capture) is built.

**A cheaper reading that IS available from stored data, and is NOT being built
without a say-so:** ask whether a dial moves `beat its own null set` the same way
it moves money. A dial that moves the money and not the beat share is moving
something other than skill. That is a new reading, not a small choice inside an
approved step, so it stays here.

---

## 3. NOT DONE: steps 8 and 9 of the build order

The loop ended here with two steps of `FUNNEL-DESIGN.md` section 13 unbuilt.
Neither is blocked — I ran out of room to do them well, and half-doing them
would be worse than leaving them.

**Step 8 — re-point Verify, History, Tune and Greenlight at Stage 4 sets.**
All four still gate on `doc.selection`, which is written only by
`POST /api/bracketlab/:id/select` and no screen calls it. So all four still say
"select a row on Boards first" for a control that does not exist. The Stage 4
set they should read instead now exists, is written, and replays; nothing reads
it yet. Until this is done the Funnel produces a record that nothing downstream
consumes.

**Step 9 — the kept scrambles.** Ordered by the owner on 2026-08-31 at ten kept,
backfill included, and being built now. Two corrections to what was written here
on 2026-08-30: it is SECOND-digit work, not first, because it adds columns and
changes no existing number; and it CAN be backfilled, because the scrambles are a
hash of the set's name and so reproduce exactly. Measured cost of the backfill on
the owner's set: 52.5M pricings against a run that did 332.6M in 12.63 hours, so
about two hours.

One thing found while building it, and it is not what the design assumed: the
scrambles are priced on the HELD-BACK window only. Every test-window call passes
deal index -1, the real calendar. The Funnel runs on test money, so its scrambles
are new pricing rather than figures already computed and thrown away. The
held-back ones are free; the test ones are the two hours.

## 4. Not verified by me: the tab on screen

The owner drives UI evaluation. 3.34.1 is deployed, healthz is green, the suite
is green and the word list is generated from what the box serves. What I have
NOT done is open the Funnel tab and use it. The first walk through it is the
owner's, and anything it does wrong is still to be found.

---

## 5. The owner's stage 3 set carries no sealed window

Found while probing the Funnel's read on the box:

```
sealed: { layout: "reserve61", sealed: false, missing: 10,
          why: "10 of 10 units carry no sealed window" }
```

The set's layout IS `reserve61`, so a final 13% of history WAS withheld from
training and pricing. But `reserve` is null on all ten of its parent's records,
so nothing records WHERE that window is.

The sealed window is therefore real and unreachable for this set: the one-touch
grade at the end of the chain would have nothing to bind to.

It affects nothing the Funnel does — that reads test money — and the tab states
it plainly rather than leaving the line blank. Whether it is worth recovering
(the bounds are recomputable from the stored parameters, at the risk of
disagreeing with what was actually priced if the price files have moved) is the
owner's call, not a session's.
