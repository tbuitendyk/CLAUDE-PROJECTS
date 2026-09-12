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

## C2, C3, C4 — cutting, the weight, the traditional score (done, 3.116.0)

Eight more tests, fourteen in the file. Two pre-registered checks failed first
and one of them found something the design document had wrong.

**C3.3 REPRODUCED, first time.** The owner's own example: 7 periods moving 1.6%
and 35 moving 0.086%. Unweighted the slow group outpulls the fast **5.00 to
1**; weighted, the fast group outpulls the slow by **3.7209 to 1**, inside the
pre-registered band of 3.73 ± 0.05. The arithmetic written into `COINS.md`
section 6 stands.

**C3.1 found a claim in my own code that was false.** The comment said the
scale that leaves the average at 1 with nothing over the ceiling "exists
whenever the cap is above 1". It does not. A period that did not move weighs
nothing, so the whole average has to come from the periods that did: on five
periods where only one moved, no scale can lift the average past the ceiling
over five. The fixed point exists when **the ceiling is at least the period
count divided by how many periods moved.**

Below that it now says so and **names the ceiling that would work** — it does
not hand back a mean that is not 1 while calling itself normalised. It is not a
refusal of the coin: the weights are still produced and still say which periods
matter. The ceiling is the owner's control, so the honest answer is to tell
them what it needs to be.

**C4.1 held.** On a span balanced overall whose last 13% only rises, the whole
span reads 0.5 and the worst slice reads 0, and it points at the tail. The two
do not move together, which is the entire point of the number.

**Choices made inside the step:**

- **A stub with no full stretch of its type to measure against reads as
  UNANSWERED, not zero.** Zero would read as "none of it", and a stub that
  cannot be compared has not answered the question.
- **The scale is found by bisection**, not by scaling then clipping (which
  breaks the mean) or clipping then scaling (which breaks the ceiling).
- **The drift is the average step between neighbouring parts' balances**, which
  is the literal reading of "how much the balance moves from part to part", and
  the per-part balances come back with it because they are what the screen
  draws.
- **`trainingWeights` is tested for not knowing which set it is for.** Its body
  is scanned for `rising` and `falling`. One vector, shared — a function that
  learns which side it is weighting has already gone wrong.

## C5 — the per-coin record (done, 3.117.0)

`partsFor` and `coinReading`. Five more tests, nineteen in the file.

**The divisions are read from the engine's own `splitBounds`**, never typed
here as 61/13/13/13 and 70/15/15, and the sealed reserve comes off exactly the
way the engine seals it. Two copies of the same percentages drift; there is one.

**The strongest test in the file is `theSearchNeverReadsHeldOrReserve`.** It
rewrites everything after the end of `test` three different ways and asserts
the percentage the search picked — and the whole walk behind it — does not move
by a hair, while what is REPORTED about `held` does. That is `COINS.md` section
7 pinned rather than intended.

**HUNTED, not reported to me: a turn is confirmed later than the period it
marks.** Found by reading the smoke-test output. The rule marks a high as a
turn only once price has fallen back from it, which happens some periods later
— so a turn near the end of `test` cannot be confirmed from `train` and `test`
alone, because the fall-back that proves it is in `held`. Type the whole span
with the same percentage and that turn appears. On the probe path: the search
counted **6**, the whole-span typing shows **7** inside the same window.

**It is left as it is, on purpose, and reported.** Letting those turns into the
search would give `held` a vote in choosing the percentage, which section 7
forbids. What is not acceptable is the two numbers disagreeing silently, so the
record carries both and names the gap in a sentence. And the direction is
pinned by test: turns are only ever ADDED by later data, never taken away, so
the search's count is a floor.

**Two test faults of my own, both found by the tests failing:**

- The scan proving `trainingWeights` does not know which set it is for was
  reading past that function into `coinReading`, which legitimately talks about
  rising and falling.
- A "collapse" future built as `price / 6` is a **uniform rescale**, which
  leaves every return identical. The returns-not-levels property doing exactly
  what it is for, and the test was wrong to expect the reading to move.

**Choices made inside the step:**

- **The weight vector is NOT stored.** It is deterministic from the moves and
  the ceiling, and a stored copy is a second version of the same fact waiting
  to go stale (RULE NINE). The summary is stored; Sweep recomputes the vector
  from this same function.
- **The weight summary is over `train`**, because that is what gets trained on.
- A coin the search cannot satisfy **still gets a record**, with the
  traditional numbers on it and a sentence saying what happened. `perPart` is
  null rather than a row of zeros, because there is no typing to report.

## C6, C7 — the runner, the endpoints, the screen, the help (3.118.0)

`lib/coinsrun.js`, four routes under `/api/coins/`, the **Coins** screen in
place of the stub, and the help entry rewritten from "not built yet" to what it
does.

**The periods are the sweep's own periods.** The runner builds chunks with
`buildComboChunks`, the same function a stage 1 launch builds them with, so a
reading on this tab lines up period for period with the run it is vetting for.
Building them another way here would be a second definition of what a period
is.

**Prices and moves come off the same chunk**: `c1`, the price a trade would
open at, gives a price series already on period boundaries with nothing
rounded; `diffPct` is the move over that period's own trade window, which is
what its label is made from. So the weight reads the period's own outcome and
nothing beyond it — the not-a-leak argument, made by construction rather than
by assertion.

**Choices made inside the step:**

- **One coin that cannot be read is recorded and the run carries on.** One
  missing cache must not cost the other sixteen their reading.
- **The defaults are served by the server**, not typed into the page, so the
  screen and the run cannot disagree about what an unset box means.
- **The record is per coin per chunk shape**, one file each, because a reading
  is about a coin's history rather than about a run.
- **The walk is drawn.** A bar per percentage tried, the picked one marked. It
  is the cheapest way to see whether a coin's count is steady across a band or
  balanced on an edge, which is the thing section 4 says the walk is for.
- **The screen remembers what it was looking at** — chunk shape, layout, order
  — the way the other screens do.
- **`order by` is a control, not a decision.** The open item asking which of
  the two traditional numbers should order the list is answered by not
  answering it in code.

## C7a — two guards caught the new screen, and both were right (3.118.1)

The full suite on 3.118.0 came back with two failures. Both were real gaps in
the new screen, and both were fixed at the cause rather than in the test.

**`cLayout` was drawing its own two options.** Those values are the ENGINE'S —
they are what `lib/coins.js` keys a reading by and what a sweep launches with.
It now draws from the same vocabulary `#swLayout` draws from, so there is one
list rather than a copy that can drift. Better than registering an exception,
which is what the lazy fix would have been.

**`cOrder` genuinely reaches no backend** — it decides which row the owner
wants at the top of a list they are reading, and nothing is posted when it
changes. Declared as screen state where the guard looks, with the reason.

**Eight column headings carried no description.** All eight now say what they
hold, including why the walk is worth looking at and why the two traditional
numbers do not move when the fall-back percentage is re-tuned.

Second time in this loop the suite caught something in shared files that the
narrow checks could not. Both times the risk was named before committing rather
than discovered after.

## C8 — the adversarial pass: the screen reviewer's findings, triaged

Four reviewers were launched, each told to REFUTE rather than confirm. The one
on the screen and the rules came back first. Its findings, sorted by whether
they are a lie, a breach, or a cost — and every one of them is inside this
loop's named work, so they get fixed here rather than parked.

### MUST FIX — the screen says something untrue

1. **`worst tail slice` sorts backwards.** Low is bad — the note on the screen
   says so — and the ordering puts the largest first, so choosing it buries the
   one-sided coins at the bottom and puts the healthiest at the top. Four of
   the five orderings put the worst first; this one runs the opposite way.
2. **The `read over` hover promises staleness detection that does not exist.**
   Nothing compares the record's span against what is cached now, and neither
   `capturedAt` nor the release is rendered. A month-old reading looks exactly
   like one taken a minute ago.
3. **Stop is indistinguishable from finished.** The note is set and then wiped
   on the next line, and `stop` is not in the status, so a run stopped at coin
   4 of 17 reads word for word like a completed 4-coin run.
4. **Stop's refusal is swallowed.** The route answers 200 with a reason and the
   page throws it away, so pressing it when nothing runs does and says nothing.
5. **"nothing read yet" over a full table.** The run state is in memory, so
   after a restart the line says nothing has been read while the table below it
   shows every record on disk.
6. **"a type appears only once" fires when it appears ZERO times**, and never
   says which type.

### MUST FIX — a doctrine breach

7. **A hardcoded forty-period minimum REFUSES a coin** (`lib/coinsrun.js`).
   This tab reports and never refuses. That is the rule the whole design turns
   on and I wrote a refusal into the loader.

### MUST FIX — it destroys what the owner typed

8. **The two-second poll rebuilds the panel and blanks every box.** The coin
   list has no value attribute at all, the six number boxes snap back to the
   server defaults, and none of them is disabled while the run is going — so
   the screen invites typing and throws it away twice a second. It also flashes
   the full-screen wait box, which swallows clicks. Boards already solved this
   with a quiet redraw and Coins does not use it.
9. **The boxes are filled from the server defaults, never from the record's own
   parameters.** Run at twelve changes wanted and the table shows readings made
   at twelve while the box reads six, with nothing saying which produced what.

### SHOULD FIX — self-contradiction, waste, RULE FIVE

10. **`0.13` is typed in `partsFor`, directly under a comment saying the
    percentages are never typed here.** My own comment, contradicted eight
    lines later.
11. **`tailShares` is a real knob with no control and no caller.**
12. **`LAYOUTS` is typed in the runner** while the dropdown reads the
    vocabulary; add a layout there and every cell renders empty.
13. **`traditional` is stored twice per record**, byte-identical, because it is
    computed per layout and does not depend on the layout.
14. **`capped` is written and never shown**, and the flat-coin sentence can
    never render because `reachedMean` is undefined on that path.
15. **A record file that fails to parse is dropped in silence**, and the screen
    then says nothing has been read.
16. RULE FOUR: one raw colour, a note nested in a note that shifts the status
    line below its buttons, and two rows per coin with no separator where the
    page already has a convention for exactly that.
