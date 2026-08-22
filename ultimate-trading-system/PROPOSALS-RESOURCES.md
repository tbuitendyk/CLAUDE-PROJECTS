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

> **PARKED 2026-08-22 — it fails the owner's own condition.** The instruction
> was *"if we don't lose functionality with your two first resource proposals
> then GO NOW!"*. This one loses functionality: a count is not the rows, and
> QC 74 says computed records are never deleted. So it was not built, and the
> decision stays with the owner. **Item 4 is the lossless way to get part of the
> same benefit** — the same rows, fewer bytes — and needs no ruling.

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

> **IMPLEMENTED AND DEPLOYED 2026-08-22, commit `ad20010`.** It loses nothing —
> the same settings reach the same tasks by a different route. Measured on the
> owner's own run shape: one payload went from **1,305,292 bytes to 212**, and
> the copying across the thread boundary from about **65 GB to about 10 MB**.
> A worker asked for settings it was never given refuses the task, on both the
> worker and the inline path, so the saving can never turn into a unit scored
> with the wrong settings.

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

> **BUILT 2026-08-22, NOT DEPLOYED — a run is going and a deploy would stop it.**
> Loses nothing: same rows, same fields. Measured after building it, on rows
> that vary the way real ones do: a replication row **324 bytes to 82**, a
> census row 244 to 75, a scored row 111 to 27. The wide shape that started all
> this drops from **7.3 GB to 1.9 GB** on the cost line.
>
> Every file already written stays exactly as it is, including the run going
> right now: the reader picks its format from which file exists, and a resumed
> run appends to the plain file it already has rather than starting a second one
> beside it.

**The problem.** Rows are stored as JSON arrays under a shared header — the big
win over one object per line, whose field names were most of the file. What is
left is still text, and the same words repeat on every row: the asset name, the
chunk shape, and the setting's own name, which is 38 characters on its own.

**CORRECTED 2026-08-22.** This section first said a stored row was 148 bytes.
It is not, and the figure was written by eye rather than measured. Measured
through the store itself, on rows that vary the way real ones do — several
assets, several chunk shapes, every number different:

| | per row | on a 413,114,688-row shape |
|---|---|---|
| as stored today | 334 B | 129 GB |
| each repeated word listed once, a number in the row | 259 B | 100 GB |
| **the file squashed** | **74 B** | **28 GB** |
| both together | 68 B | 26 GB |

The first estimate in this section — "148 down to about 60" — was wrong twice
over: wrong about where it started, and wrong about which of the two changes
does the work. Listing the words once barely helps. Squashing the file is 4.5x
on its own, and doing both adds almost nothing over squashing alone.

**The change.** Squash the file, in independently-readable blocks so a page of
rows can still be fetched without unpacking everything before it.

**Gives up:** a stored row stops being readable in a plain text viewer, and
reading one row from the middle means unpacking from the nearest block start.
Same rows, same fields, fewer bytes — no record is lost.

---

## 5. Build the per-unit payloads as they are needed

**The problem.** The whole list of jobs is built before the first one runs — one
object per unit, held until the pass ends, and again for the second pass.

**The change.** Hand the pool a function that produces the next job rather than
an array of all of them.

**CORRECTED 2026-08-22, and it shrank.** Before item 3 each job carried the
whole settings block, so the list was the same 65 GB item 3 removed. Measured
since: a job object is **71 bytes**, so a 50,184-unit run holds about **7 MB**.
Tidy and cheap, and it removes one more thing that grows with the run — but it
is no longer where anything meaningful is.

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

## Where this stands

| | | |
|---|---|---|
| 1 | copies stored as counts | **parked** — loses recorded detail, needs a ruling on QC 74 |
| 2 | drop configs the run cannot match | not built — loses nothing, cheap |
| 3 | settings sent once per worker | **done and deployed**, `ad20010` |
| 4 | compress the stored rows | **built, awaiting a deploy** — 4x smaller, loses nothing |
| 5 | build payloads as needed | not built — and now worth about 7 MB, so barely worth doing |
| 6 | stop at a cost the owner sets | not built — loses nothing |
| 7 | share the candle cache | not built — the biggest job here |

**If item 1 is wanted anyway**, the middle option in that section keeps every
row and lets the owner delete the copies' file per run, from the Boards
section, once the reading has been taken. That costs the disk once rather than
for ever and deletes nothing without being asked.

**Next, if anything:** item 2 (drop settings the run cannot match) and item 6
(let a run stop itself at a cost you set). Both lose nothing. Item 5 has shrunk
to about 7 MB since item 3 landed and is no longer worth its own change.
