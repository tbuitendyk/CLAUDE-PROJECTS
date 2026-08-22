# Ways to make a run cost less — proposals, nothing built

Owner order, 2026-08-22: *"if there are ways you can fix the back end to use
resources in an efficient or alternate way to avoid running into hard-stop
resource constraints then you need to propose those so we can build them"*.

Nothing here is built. Each item says what it would change, what it would save
with a number where I have measured one, what it would cost, and what it would
give up — because two of them give something up, and that is the owner's call
rather than mine.

Ordered by what I would do first.

---

## 1. Stop storing what nothing reads — the copies' per-row detail

**The problem, measured.** One row is written per promoted unit per declared
config. With 40 null boards, 40 of every 41 of those rows belong to a scrambled
copy. The owner's run would have written 413 million rows; 403 million of them
are copies.

**What reads them.** Nothing, row by row. The table on the Boards section uses a
copy's row for exactly one thing: to add 1 to a count of how many copies the
real result beat. The per-asset table underneath deliberately excludes them —
the code that draws it says so: *a null copy is machinery, not a result, and
listing one as an asset row would be a lie.*

**The change.** Keep a running count per (config, asset) instead of a row per
copy: how many copies, how many the real figure beat, and the middle copy's
figure. Real rows are still written one per row, unchanged.

**What it saves.** 41x at 40 null boards. The owner's run goes from about 60 GB
to about 1.5 GB. At 19 null boards it is 20x.

**What it gives up, and this is the part that is not mine to decide.** QC 74
says computed records are never deleted. A count is not the rows. If a question
is asked later that the count cannot answer — the shape of the copies'
distribution, say, rather than how many were beaten — it cannot be answered
without running the whole thing again.

**Middle option.** Keep the copies' rows in a separate file per run and let the
owner delete that file, per run, from the Boards section, once the reading has
been taken. Costs the disk once rather than for ever, and deletes nothing
without being asked.

---

## 2. Do not score declared configs the run cannot possibly match

**The problem.** The declared set is expanded from the full menus. A config
naming a stop the run does not compute — because `also try moving stops` is off
— can never be matched to a cell, so it produces nothing. Today the launch
refuses the whole run for that (correct), but there is a quieter version: a
run with a custom grid expands configs outside that grid and scores them for
nothing.

**The change.** At launch, drop from the declared set any config whose gate,
distance, hold, stop or arm is not in this run's own grid, and say how many were
dropped and why on the cost line.

**What it saves.** Depends entirely on the settings; nothing on a default grid,
a lot on a narrowed one. The real gain is that the count on screen becomes the
count that will actually be scored.

**Gives up:** nothing.

---

## 3. Send the big constant parts to each worker ONCE, not once per unit

**The problem, measured.** Each unit's payload carries `params`, and `params`
carries `declaredSet` — 1.4 MB of it on the owner's run. That whole object is
structured-cloned across the thread boundary for every unit: 50,184 clones of
1.4 MB is about 70 GB of copying that does no work.

**The change.** Give the pool an "everyone gets this" message sent once per
worker when it starts, holding the settings that do not vary between units.
Per-unit payloads then carry only the combo, the branch and the copy number.

**What it saves.** The copying. On a run with a big declared set that is most of
what the main thread does between units, and it is also why the main thread's
memory climbs during a sweep. On a run with no declared set it saves little.

**Cost:** the pool gains a notion of per-worker state, which it does not have
today. Worth care: state that arrives out of order, or a worker that restarts
mid-run and misses it, would silently score with the wrong settings. Needs the
worker to refuse a task it has not been initialised for.

---

## 4. Compress the stored rows

**The problem.** Rows are stored as JSON arrays under a shared header — 148
bytes each against 611 as objects, which was the big win. What is left is still
text, and the same asset names and labels repeat every row.

**The change, cheapest first.**
- A dictionary in the file header for the repeating strings (`declaredLabel`,
  `trade`, `geometry`), each row storing a small number instead. Rough estimate:
  148 bytes down to about 60. Not measured.
- Or gzip each file as it is written. Roughly 4-6x on text like this, at the
  cost of not being able to read a row without decompressing from the start of
  the block — so it wants block framing, which is more work.

**Gives up:** a stored row stops being readable with `less`. Worth it at the
top end, not worth it at the bottom.

---

## 5. Build the per-unit payloads as they are needed

**The problem.** `slimPayloads` is built with `.map` over every unit before the
first one runs: 123,624 objects held for the whole pass, and the same again for
the promote stage.

**The change.** Hand the pool a function that produces the next payload rather
than an array of all of them.

**What it saves.** Tens of megabytes on a big run, and it removes one more thing
that grows with the size of the job. Small next to items 1 and 3, but cheap.

---

## 6. Let a run stop itself at a cost the owner sets

**The problem.** A run that exceeds the disk stops by failing. There is no
"stop cleanly when this gets expensive".

**The change.** Two boxes beside the cost line: stop after N hours, stop after
N GB. On reaching either the run finishes the unit it is on, marks itself
stopped-on-budget with everything it recorded intact, and says so. `Resume run`
then picks it up if the owner wants to carry on.

**Gives up:** nothing. The resume already exists and this is a clean stop rather
than a crash.

---

## 7. Share the candle cache between workers

**The problem.** Each of the four workers keeps its own cache of decoded
candles. Four copies of the same few hundred megabytes.

**The change.** Decode once on the main thread into a `SharedArrayBuffer` and
have the workers read from it.

**What it saves.** Three copies of the candle cache — hundreds of megabytes of
resident memory, which is most of what the service holds while a sweep runs.

**Cost.** The biggest job on this list. The candle format would have to become
a flat typed array rather than objects, and every reader of it would change.
I would not start here, but it is the one that most changes what this box can
hold at once.

---

## What I would do first

1 and 3, in that order. Item 1 is where the size actually is, and item 3 is
where the time goes on a wide run. Both are contained changes with tests.

Item 1 needs the owner's ruling on QC 74 before anything is written.
