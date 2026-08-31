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
