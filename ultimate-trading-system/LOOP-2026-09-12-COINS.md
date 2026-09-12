# Loop record — building the Coins tab (owner `LOOP NOW!`, 2026-09-12)

**The owner's words:** *"You are to build the Coins tab functionality and data
structures and launch adversarial testing and deploy as a single authorized
loop until finished. LOOP NOW!"*

The design is `COINS.md`, agreed with the owner over the preceding hours. This
file is the loop's record: **the steps and their success rules, written down
BEFORE any number exists**, and then what actually happened, step by step.

RULE SIX: *"What makes this safe is not permission — it is committing in
advance. The thing that stops a result being talked into something it is not is
that the success rule and the expected outcome were written down BEFORE the
numbers existed."* That is what section A below is for, and nothing in it is
edited after a step runs. Section B is the running log.

---

## What is IN this loop

Everything `COINS.md` describes as this tab's work:

- typing a coin's history into `rising` and `falling` stretches;
- searching for the fall-back percentage per coin;
- cutting stretches at every boundary and counting what is left;
- the per-period training weight this tab produces;
- the traditional score, both numbers;
- the per-coin record, both `window layout` choices, with provenance;
- the endpoints and the screen, every figure exposed (RULE FIVE);
- the help entry;
- tests, adversarial review, the suite, the deploy chain, the guards.

## What is OUT, and stays out

- **How the two sets of `members` are trained.** That is **Sweep**, and it is
  written in `TREND-TRAINING-DESIGN.md`. This loop produces the numbers; it
  does not apply them.
- **Any change to an existing record set.** Coins changes nothing already on
  the box.
- **The four things RULE SIX never softens**: anything arming real money;
  anything that cannot be undone; anything reaching outside the established
  channels; anything conflicting with what the owner has written down. Any of
  those is PARKED with a reason, not decided at 3am.

## What this tab must never do, carried in from the design

**It reports. It does not refuse.** No cut-offs on any reading, on any step
below. Owner, 2026-09-12: *"We're not even blocking coins with this anyways.
We're only reporting."* A step that produces a refusal has failed its own
success rule even if every number in it is right.

---

# A. The steps and their success rules — written before any of it ran

## C1 — the typing, and the percentage search

**What it does.** Walk the price forward keeping the running high; when price
has fallen back from that high by more than a set percentage, mark the high as
the end of the `rising` stretch. Same rule inverted. From returns, never price
levels. Boundaries snap to period boundaries.

Then search: walk the percentage across a range, count the changes of
direction at each, and take **the largest percentage giving at least the number
asked for** (owner's decision, 2026-09-12).

**Success rule, pre-registered:**

1. On a built price path with exactly **K** turns at known indices, the typing
   returns exactly K turns at those indices, for every percentage in a band
   around the built swing size.
2. Every index belongs to **exactly one** stretch. Stretches alternate. None
   is empty.
3. On a path that only rises, **one** stretch and **zero** turns, at every
   percentage tried.
4. The search returns the LARGEST percentage in the walked range whose count
   reaches the target. When nothing reaches it, it **says so and reports the
   best it found** — it does not quietly hand back the smallest percentage.
5. When the count jumps past the target, the delivered count is reported
   beside the asked-for one.

**What I expect to go wrong, written before looking:** the count against
percentage will **not** be a clean staircase. An earlier turn moves where later
ones land, so a higher percentage can give a higher count than a lower one.
**If I never see a non-monotonic case in the built paths, my walk is not
exploring properly and the test is too easy** — that is a failure of the test,
not a success of the code.

## C2 — cutting at the boundaries, stubs, and the two counts

**Success rule, pre-registered:**

1. A stretch straddling a boundary becomes exactly two pieces whose lengths
   **sum to the original**, each wholly inside one part.
2. **Turn counts are IDENTICAL before and after cutting.** Turns never get cut.
   If this fails, the design's claim that handover needs no stub arithmetic is
   wrong and the whole of section 5 has to be reopened.
3. A stub contributes `stubLength ÷ median(full lengths of that type)` and a
   full stretch contributes 1.
4. Two stubs of half the median add to **1.0** within floating-point tolerance.
5. There are **at most two stubs per part of history**, one at each end. A
   result with three is a bug in the cutter, not a property of the data.

## C3 — the per-period training weight

**Success rule, pre-registered:**

1. The mean weight across the training rows is **1.0** within 1e-9.
2. The cap is applied and is a value the caller passes, never a constant.
3. **The owner's own example must reproduce.** 7 periods moving 1.6% and 35
   moving 0.086%: unweighted the slow group outpulls the fast **5.00 to 1**;
   weighted, the fast group outpulls the slow by **3.73 ± 0.05 to 1**
   (11.2 against 3.0). A number outside that band means the arithmetic in
   `COINS.md` section 6 is wrong and the section has to be corrected before
   anything else is built on it.
4. One vector, shared by both sets. The function takes no argument saying which
   set it is for — if it needs one, the design was wrong.

## C4 — the traditional score

**Success rule, pre-registered:**

1. On a path whose whole span is balanced but whose **last 13% only rises**,
   the worst tail slice reads at or near **0** while the whole-span balance
   reads near **0.5**. That difference is the entire point of the number; if
   they move together the number is measuring nothing.
2. On a path balanced everywhere, both read near 0.5.
3. Neither number reads the tuned percentage — pass a different tuned
   percentage and **the traditional numbers do not move at all**.

## C5 — the per-coin record

**Success rule:** one record per coin per `window layout`, carrying the
percentage found, the walk that found it, the type labels, the counts and the
split of time per part, the three readings, and the provenance — the total span
the history covered and the release it was written under. A reader can tell a
stale record from a current one **without guessing from its age**.

## C6/C7 — endpoints and the screen

**Success rule:** every figure in the record is reachable from the screen, and
every input is a control the owner sets (RULE FIVE). Nothing about which coins
are worth using is decided in code.

## C8 — tests and adversarial review

**Success rule:** the whole suite green, and every new test verified to FAIL
against the code it replaces — a test that passes both ways is worth nothing.
Then an adversarial pass whose job is to break the above, not to confirm it.

## C9/C10 — release, deploy, guards

**Success rule:** release bumped in the same commit (RULE ONE-C); `busy: none`
before deploying; healthz OK; served record captured; word lists regenerated
from what the box serves, not the working tree (RULE ONE-A); suite green after;
guards run AFTER the deploy and never gate it (RULE EIGHT).

---

# B. The log

*Written as it happens. Every non-obvious choice gets a line.*

## C0 — this file (done)

Pre-registration committed before any code. The numbers in C3.3 and C4.1 are
the ones to hold me to.

## C1 — the typing and the percentage search (done, 3.115.0)

`lib/coins.js`: `typeStretches` and `searchFallback`. `tests/test-coins.js`,
six tests, added to the runner.

**Both pre-registered checks earned their place, and both failed first.**

**C1.3 caught a real bug.** A one-way rising path came back with ONE turn, at
index 0. With no direction established yet, the rise away from the opening
price fired the falling branch, which closed a `falling` stretch that had never
existed. Nothing is in progress before the first period, so there is nothing
there to close: the first trigger now only sets the direction when the extreme
IS the start. The same bug was behind the first test's failure too — two
failures, one cause.

**The test of the test failed, and the test was what was wrong.** The loop
record said: if no path shows the count rising as the percentage rises, the
walk is not exploring and the test is too easy. It showed nothing across forty
smooth paths. A probe over four hundred rough walks found **five** — all at
high percentages where the turn count is small. So the effect documented in
`COINS.md` section 4 is real, it is rare (about one path in eighty), and smooth
paths cannot show it.

Without the pre-registration that would have been written up as "monotone after
all, claim withdrawn", and the search would have been safe to rewrite as a
bisection. It is not. The test now pins a known case by seed — 15.75% gives
five turns and 16% gives **six** — which a bisection fails.

**Choices made inside the step, recorded rather than asked about:**

- The price series is one price per period, and the natural one is the price a
  trade would open at, which a chunk already carries. Boundaries then snap to
  period boundaries for free rather than being rounded to a calendar.
- The extreme belongs to the stretch that ended AT it; the next stretch starts
  on the following period. That is what makes the stretches tile the span with
  nothing in two of them.
- A path that never moves far enough for a direction to exist still gets a
  type — whichever way it finished. Two types, no third bucket, no holes.
- The search walks the whole range rather than bisecting, and returns the walk
  itself, because the walk is what the screen draws.
