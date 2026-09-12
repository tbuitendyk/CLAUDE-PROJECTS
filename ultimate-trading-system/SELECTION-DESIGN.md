# How a setting earns the right to be believed

Written 2026-09-09. **Split in two on 2026-09-12** (owner `GO NOW!`), after the
tabs were put in the order the work is actually done in — `Data · Coins ·
Sweep · Boards · Funnel · History · Tune · Verify · Greenlight · Help`.

**This document now holds two things**: the doctrine — how the four stretches
of history may be spent — and the parts that belong to the screens where
CHOOSING happens. **The parts that belong to Verify moved whole into
`VERIFY-DESIGN.md`**, which is now the one document for that screen: what was
built there, followed by what is still to come.

**The part numbers did not change**, so every pointer to "Part N" anywhere in
the code, the tests or the other documents still means the same part. Only the
file it is written in moved.

| Part | Screen | Written in | State |
|---|---|---|---|
| 1 — judge on several stretches, not one | **Verify** | `VERIFY-DESIGN.md` | the engine is built and reachable from no screen; the screen is next |
| 2 — the bar is the best of all four comparisons | **Verify** | `VERIFY-DESIGN.md` | BUILT, 3.100.0 and 3.101.0 |
| 3 — held-back numbers out of reach while choosing | **Boards**, **Funnel** | here | two pieces shipped, the larger half open |
| 4 — a cheap way to rule out a bad way of choosing | **Funnel** | here | BUILT, 3.102.0 |
| 5 — set the bar for the whole search | **Verify** | `VERIFY-DESIGN.md` | blocked |
| 6 — write down the claim before the stretch is opened | **Verify** | `VERIFY-DESIGN.md` | blocked |
| 7 — what the settings you threw away did on held-back | **Verify** | `VERIFY-DESIGN.md` | BUILT, 3.100.0 |
| 8 — judge the thing you would trade | **Verify** | `VERIFY-DESIGN.md` | not built |

**Nothing that is not marked BUILT has been built, and nothing will be until
the owner says so, part by part.**

Every screen name in this document was read out of `SCREEN-WORDS.md` in the
session that wrote it. A first draft of this document got two of them wrong,
and that draft was thrown away.


## Read the words first

The table below is the whole vocabulary of this document. Nothing outside it is
used to name anything. Where a word is also on a screen, the screen is named,
because the same word can mean different things on different screens.

| Word here | What it means |
|---|---|
| period | One step of the system's clock. With `chunk shape` set to a daily choice, one day. `chunk shape` is on **Sweep**, **Boards** and **Funnel**. |
| stretch | A number of periods one after another, with no gaps. |
| setting | One combination of `entry`, `gate`, `d`, `t`, `trail` and `arm` together, plus how much of the `committee` has to agree before it acts. The six are on **Sweep** and **Boards**; `committee` is on **Sweep** and **Boards**. One of these is a `setting` on **Sweep**, **Boards**, **Funnel**, **Verify**, **History** and **Greenlight**. |
| forecast | One prediction made by one part of the `committee`. A `member` is one of them. `forecast` is on **Sweep**, **Boards**, **Funnel**, **Verify** and **History**; `member` is on **Sweep** and **Boards**; the plural `members` also appears on **History**, **Tune** and **Greenlight**. |
| record set | What a stage writes when it finishes. On every tab. Where it matters I say which stage. |
| train | The stretch the forecasts learn on. On **Sweep**. |
| test | The stretch the choosing is done on. On **Boards**, **Funnel**, **Tune** and **Verify**. |
| held-back | The stretch kept aside to check against. On **Boards**, **Funnel**, **Tune** and **Verify**. |
| reserve | The last stretch, `sealed`, opened once at the very end. On **History**. |
| a look | One opening of a stretch that was being kept shut. On **Funnel**, **History**, **Tune** and **Verify**. |
| the bar | The number a thing has to beat to pass. On **Funnel**, **History** and **Verify**. Not on **Sweep** — the only `bar` there is `quorum bar`, which is a different thing, being how much of the `committee` must agree. |
| floor | A lowest allowed value; anything under it is dropped. On **Funnel** and **Verify**. |
| the rule | The ranges and single values you keep as you go through the **Funnel**. |
| shopping | Keeping the best of what you can see. The **Funnel** says so itself: "Taking the top N is shopping". |
| survivor | A setting the rule kept. On **Funnel**, **Verify**, **History**, **Tune** and **Greenlight**. |
| scrambled copies | The same forecasts that were really made, dealt onto the wrong days. Every `member` is dealt by the same order, so the members still agree and disagree in exactly the same pattern they really did, and only the calendar is destroyed. It answers: how much money do these same calls make landing at random? On **Funnel**, **History** and **Verify**. |
| `always long` | Open a position on **every** period in the up direction, at the setting's own horizon and paying the setting's own costs. On **Funnel**, **History** and **Verify**. |
| the short version of `always long` | The same on every period in the down direction. **There is no name for this on any screen.** In the code it sits beside `always long` and is built the same way. |
| `buying the coin and going away` | Buy at the start of the stretch, sell at the end. One trade. On **Funnel**, **History** and **Verify**. |
| `shorting it and going away` | The same in the other direction. On **Funnel**, **History** and **Verify**. |
| `avg held-back $` | The money column taken from the held-back stretch. On **Boards**, **Funnel** and **Verify**. |

Two words are used ONLY in their screen sense in this document, never in any
other: `walk`, which on the **Funnel** is the run through its steps, and
`noise`, which on **Verify** and **History** means the scrambled copies
specifically. Neither is borrowed for anything else here.

## What this covers

Three things that went wrong and that no change to how the forecasts are
trained will fix:

- the bar could be cleared without skill
- numbers from the held-back stretch could be reached on the screens used for
  choosing
- nothing measured whether the way of choosing works on history it has not
  seen, until the reserve was opened and it was too late

It does **not** cover sorting history into trending up and trending down,
filtering coins on it, and training forecasts that only speak when the market
is in the kind of stretch they were trained for. That is a separate design.

## How to read this

**The doctrine comes first** — THE HISTORY BUDGET RULE below. It governs every
part, in this document and in `VERIFY-DESIGN.md`, and it is the reason several
of them exist. Read it before any part.

**Then the two choosing-screen parts**, 3 and 4. Each has the same shape: **the
problem**, **the change**, **what it needs from the other parts**, **what I am
assuming**, **what it costs**. Where a part cannot honestly be planned until
something is measured, that is written at the top as a **blocker**, not buried
in a bullet.

The parts are **not** independent, and they are no longer all in one file.
Where one leans on another, the part says so; the table above says which file
to open.

---
# THE HISTORY BUDGET RULE (owner order, 2026-09-11)

> The owner, on discovering that the **held** stretch had already been read for
> every setting back at the stage 3 sweep: "you've been killing us trying to
> find a bit of clean data for the verification tab and here we find out like
> some kind of revelation that the third history chunk HAS ALREADY BEEN USED
> WAY BACK ON THE STAGE 3 SWEEP."

**History is finite and cannot be replaced.** Every stretch of it is spent the
first time something reads it, and no later reading of the same stretch is a
second opinion. Until now the pipeline has spent it without a plan, and the
result is that the verification problem looks unsolvable when it is not.

## Where every stretch actually goes today

Read out of the code, not remembered. For a 61/13/13/13 set:

| stretch | what reads it today |
|---|---|
| **train**, first 75% | fits the models. Nothing is chosen here. |
| **train**, last 25% | the money that RANKS AND KEEPS units at stage 1 and stage 2 |
| **test** | stage 1 and 2 forecast score; stage 3 prices every setting; EVERY dial the Funnel keeps |
| **held** | stage 3 prices every setting; **it orders the stage 3 table**; Verify's verdict; History's judge on a 70/15/15 set |
| **reserve** | the reserve grade; History's judge on a 61/13/13/13 set |

Four stretches, and only **reserve** arrives at the end unspent — and History
spends that.

## The rule

**A stretch of history does exactly one of three jobs, and never two.**

1. **FITTING.** The models learn here. Nothing is chosen and nothing is
   claimed.
2. **CHOOSING.** Anything that narrows: which coins survive stage 1 and stage
   2, which dials the Funnel keeps, which stop and which order size Tune
   picks.
3. **JUDGING.** A claim about what will happen. Spent once, and worthless the
   second time.

**All choosing may share ONE stretch.** Selection piles up there and that is
expected, because nothing there is a claim. **Every judgement needs a stretch
nothing has read** — that is the entire definition of a judgement.

**The arithmetic of it.** You need one fitting stretch, one choosing stretch,
and one judging stretch per judgement. The pipeline wants at least two
judgements (Verify, and History's comparison) and really three (the reserve
grade). Four stretches fits that exactly — **but only if nothing does two
jobs. Today three things do.**

## What that says about where a number may be read

- **Sweep, Boards and the Funnel are choosing screens.** They may show the
  choosing stretch and nothing else. No held column, no ordering by a held
  number.
- **Verify holds the first judging stretch, and must be the first thing that
  has ever read it.**
- **History's comparison is a judgement too, and must use a DIFFERENT stretch
  from Verify's.** On a 61/13/13/13 set it uses the reserve, which is right.
  On a 70/15/15 set it uses **held** — the stretch Verify just spent — which
  is not. That is one reason the 61/13/13/13 layout is the healthier of the
  two.
- **Tune is a CHOOSING screen, not a judging one.** Picking a stop and an order
  size is narrowing. It reads held-back today and counts each press as a look,
  which is honest bookkeeping of a thing that should not be happening at all.
- **Greenlight and the reserve grade take the last unspent stretch**, and
  nothing before them may touch it.

## The one change that pays for itself immediately — DONE, 3.114.0

**The order `Table 3.A: Settings, ranked` arrives in no longer reads the
held-back stretch.** Owner `GO NOW!`, 2026-09-12.

This section is corrected in place rather than deleted, because the sentence it
used to carry was too big and saying so is the point.

**What was wrong.** With no column picked, that table came back ordered by
`beat its own null set` — of each setting's own scrambled copies on the
held-back stretch, how many its held-back money beat. Not a column somebody
might choose to sort by: the order every set arrives in, on the screen a set is
picked from before anything is walked, chosen by nobody.

**What changed.** The order is now `beat the kept null money`, best first — of
the kept scrambled copies of the whole table, how many each setting's
`avg test $` beat. That is a test-window reading. The same order is applied
where the totals are written and again where the table is read, so every set
already on the box reads it with nothing re-totalled and no reader having to
ask how old a set is.

**AND THE OLD CLAIM WAS TOO BIG.** It said: "If that table sorted on test money
against its own test copies, held would arrive at Verify untouched." It will
not, and it never would have. Stage 3 still prices every setting on the
held-back stretch — that is where `avg held-back $`, the four comparisons and
`beat its own null set` come from, and Verify reads those stored figures.
Stopping the pricing is a different and much larger job, because every record
on disk changes shape.

**What is actually bought**, which is narrower and still the best value in this
document: the held-back reading no longer steers the choosing on its own. Every
reading of it is now a press — sorting or filtering by a held-back column —
which is a look somebody chose to take, and a look that can be counted.

**Still open, named and not fixed** (RULE ZERO: the owner authorised the
ordering and nothing else). The hover text on `avg held-back $` says it is "the
once-only look, on data no ordering ever read". Before this change that was
flatly untrue. It is now untrue only if the owner presses that column's own
sorter, which the screen still offers. Part 3 is where that gets settled.

## Both layouts under this rule, and how 70/15/15 survives it

The owner, 2026-09-11: "i would rather not lose that 70/15/15 config as it gives
us beefier history to work with all around."

**What it buys, on the owner's 2,661 chunks, worked out from `splitBounds`:**

| | train | test | held | reserve |
|---|---|---|---|---|
| 61/13/13/13 | 1,621 | 347 | 347 | 346 |
| 70/15/15 | **1,863** | **399** | **399** | none |

Every working stretch is 15% larger. 242 more chunks of training is the
difference between a model and a better model, and that is worth keeping.

**What it costs, precisely: it has ONE judging stretch and the pipeline wants
two or three.** Today it hides that by letting History judge on **held** — the
stretch Verify just spent.

### No step needs to be cut. Two steps are misfiled.

Count what consumes a judging stretch today: Verify's verdict, History's
comparison, Tune's reads, the reserve grade. Under the rule above, only
**Verify** and **the reserve grade** are judgements at all.

- **History's comparison is a CHOOSING act.** It asks whether weighting recent
  data more heavily does better, and it **picks a half-life per record**.
  Picking is narrowing, and narrowing belongs on the choosing stretch.
- **Tune is the same.** Picking a protective stop and an order size is
  narrowing. It reads held-back today, which on 70/15/15 means Tune eats
  Verify's only stretch.

**So reclassify rather than cut, and the order changes:**

**Funnel → History → Tune → Verify.**

All narrowing — units, dials, half-life, stop, order size — happens on the
choosing stretch. Then the judging stretch is spent once, on the final
candidate, by Verify.

**And this closes a gap that is open today.** A 4.h set cannot currently be
verified: Verify refuses a derived set, while the comment on the 4.h build says
it "stands on the source's PASS" and nothing enforces that the source has one.
Under this order the 4.h set IS the thing Verify judges. No inheritance, no
unenforced gate, no refusal to work around.

### On 70/15/15 the reserve is not missing — it has not arrived

The unread window is already open-ended by design: it starts somewhere and runs
to whatever data exists when it is finally read. A 70/15/15 set seals nothing,
so its unread window is simply **everything after the run's last chunk**. Real
time supplies it, and it grows on its own.

For the last check before real money that is STRONGER than a sealed slice: it
is data that did not exist when the decision was made, so nothing can have
leaked into it.

**The honest cost is the wait.** On a daily-3d shape a few hundred new chunks
is years; on daily-1d it is months. So the reserve grade is in hand on the day
with 61/13/13/13, and only after a wait with 70/15/15.

### The recommendation: keep both, for different jobs

**70/15/15 is the exploring layout.** While rules are still being built and
nothing is going live this month, the extra 242 chunks make better models to
explore with, and the reserve accumulates in the background while the work goes
on.

**61/13/13/13 is the layout for a run meant to be traded**, where the sealed
grade has to be in hand on the day rather than in a year.

That keeps the layout the owner does not want to lose and stops it being a
compromise: it becomes the exploring layout, with time itself as its reserve.

**Neither layout is honest until the two reclassifications above are made** —
History's comparison and Tune's reads move to the choosing stretch — and
neither needs new machinery to do it.

## THE STEP THAT PUTS THIS ORDER ON THE SCREEN (owner order, 2026-09-11)

The rule above says all narrowing happens before the one judgement. The tabs do
not currently read that way, and the owner's instruction is to make them: put
the **Coins** tab in as a stub, and move **Verify** to second to last.

**`TABS` in `public/construct.js` today:**

```
Data · Sweep · Boards · Funnel · Verify · History · Tune · Greenlight · Help
```

**After this step:**

```
Data · Coins · Sweep · Boards · Funnel · History · Tune · Verify · Greenlight · Help
```

`Help` sits outside the flow and stays at the end; **Verify** is second to last
of the tabs that are the flow, immediately before **Greenlight**.

**Why the order is the deliverable and not decoration.** The tab strip is the
only place the pipeline is stated to the owner as a sequence. With Verify
sitting fifth, the screen says the judgement happens before History and Tune
have finished narrowing — which is the arrangement the budget rule above says
spends a judging stretch on a choosing act. Moving Verify to the end makes the
screen say what the rule requires: **everything that picks, then the one thing
that judges, then Greenlight.**

**Coins goes in as a STUB, not as a build.** It sits between Data and Sweep,
where it belongs, and it says what it will do and that it does not do it yet.
Two reasons for the stub rather than nothing: the tab strip is the statement of
the pipeline, so a step missing from it is a step missing from the owner's
picture of the system; and when Coins is built it will offer Sweep a second
mode — the existing one set of trained models, and a new two sets, up and down
— which changes what every record set below it is, so the place it will occupy
should be visible while that is still ahead of us rather than appearing as a
surprise.

**What a stub must NOT do.** It must not offer a control that does nothing. An
empty tab that names its future controls is a tab that invites the owner to
press something that is not there — the same fault as naming a screen that does
not exist. It says what it is for, that it is not built, and nothing else.

**What this step is not.** It is not the reclassification the section above
calls for. Moving Verify's TAB does not move Verify's READ: History and Tune
still read the judging stretch until their reads are moved to the choosing
stretch, and until then the screen will be stating an order the code does not
keep. That gap should be short, and it should be named on the screen if it is
going to be long.

**Cost:** the tab list is one array, and every screen is dispatched from it. The
word lists regenerate per tab from the code, so a new tab gets its own list
without anybody asking. The Help tab's control reader indexes by id, so a stub
carrying no id-bearing control needs no help entry — and if it carries one, it
needs one.

## And it says where Part 1's passes belong

*Part 1 itself is written in `VERIFY-DESIGN.md`. This is the doctrine it has
to obey, and it stays here with the rest of the doctrine.*

The **fitting** stretch is the only part of the budget that can be spent more
than once, because every pass trains again on its own slice and nothing there
ever chose anything. So walk-forward passes belong inside it — and nowhere
else. Judging a pass on the choosing stretch judges dials on the data that
picked them; judging one on a judging stretch spends a claim to answer a
different question.

---

# Part 3 — put the held-back numbers out of reach while choosing

> **TWO PIECES OF THIS HAVE SHIPPED.**
>
> **3.114.0 (owner `GO NOW!`, 2026-09-12): the order `Table 3.A: Settings,
> ranked` arrives in stopped reading the held-back stretch.** It was ordered
> by `beat its own null set` — a held-back reading — on every set, chosen by
> nobody. It is now ordered by `beat the kept null money`, which reads
> `avg test $`. Written up under "FOUND 2026-09-11" below, including the
> part of the old claim that was too big.
>
> **3.107.0** (owner order 2026-09-10: "build the
> four comparisons on test money in the funnel in place of the held-back window
> info we are removing"). The **Funnel** drew the four comparisons twice — the
> whole board and the settings the rule keeps — and both were **held-back**
> money, on the screen where every choice is made. Both are now the same four
> on the **test** window, as a table, and the note under it says nothing on it
> comes from the held-back or unread stretch. See FUNNEL-DESIGN.md §20.2.
>
> **What did NOT ship is the rest of the part**, and it is the larger half:
> `avg held-back $` is still a stored column with a `floor` and a sorter on
> **Boards** and on the **Funnel**'s own tables, and there is still no check
> that reads the choosing screens for a held-back figure and refuses to let one
> ship. Removing the column is a change to the shape of a stored row and so a
> migration (RULE NINE) — the owner's call, named in "What it costs" below.

> **Blocker.** This part cannot be scoped until the owner says whether anything
> on the choosing screens legitimately needs held-back money. `avg held-back $`
> is a column on **Boards**, **Funnel** and **Verify** with a `floor` and a
> sorter on it. Removing it from choosing is a real loss of a control, not a
> tidy-up, and that is the owner's call.

## The problem

Two things are true and I have been sloppy about the difference between them,
so both are stated separately.

**What is certain: the numbers were reachable.** The screens used for choosing
offer a `floor` on `avg held-back $` and a sort by it, and a `floor` inside the
rule can be set on a count of trades that comes from the held-back stretch. The
system counted looks the whole time and counted none of these.

**What is not certain: that they were used.** Nothing I have read shows the sort
or the floor was actually applied in the run this document was written after.
Availability is not use. If it turns out they were never touched, the fault is
exposure rather than proven contamination, and the part still stands — but on
the narrower ground.

The premise underneath is a design opinion, not a fact, and it should be
argued with rather than nodded at: **a number that can be reached while choosing
will eventually be used, whatever anyone intends.**

## FOUND 2026-09-11: the held stretch is not fresh at the cut, and it orders the board

The owner asked a plain question — was a stage 3 record set judged only on
**test**? — and the answer is no, in a way that is larger than the column this
part was written about.

**Read out of the code, not remembered:**

- **Stage 3 prices every setting on BOTH stretches.** The real pricing and the
  kept scrambled copies on **test**, and then the real pricing, the four
  comparisons and the scrambled copies on **held** (`lib/stagework.js`, the
  `if (holdChunks.length)` block). Every record carries `avgTest` and
  `avgHold`.
- **`beat` is a HELD number**: how many of that setting's held scrambled copies
  its held money beat. `pairs` is the held copy count and is zero when there is
  no held stretch (`lib/stagework.js:1212`).
- **The stage 3 ranked table is ordered by that number.** With nothing picked,
  `lib/stages.js:4229` sorts every setting by `beat / pairs`, best first — the
  share of held scrambled copies each one beat.

**So the held stretch was read for all 2,752 settings when the sweep ran, and
it is what orders the table.** Not a column that could be sorted by; the
default ordering itself.

**The scope, bounded honestly, because the first telling of this was wider than
the code supports.** The Funnel's own per-unit board is NOT ordered that way —
`loadUnitBoard` returns rows in record order and the walk reads `avgTest` and
nothing else. What is ordered by the held reading is the stage 3 ranked table,
which is where a set is looked at before anything is walked.

**Why it matters more than the column this part was written about.** Part 3
above is about `avg held-back $` being reachable — a floor and a sorter someone
might use. This is not reachability. It is the order the settings arrive in,
applied to every set, without anybody choosing it. The premise underneath Part
3 — that a number reachable while choosing will eventually be used — does not
even need to be argued here: this one is used by default.

**And it makes a sentence on the Funnel untrue.** That screen says "The
held-back window is opened once, at the cut." For the walk itself that is
right. For the pipeline it is not: the held stretch was priced for every
setting at stage 3, long before any cut, and the ranking built from it is on
the screen where a set is chosen to walk.

**THE ORDERING HALF IS FIXED, 3.114.0** (owner `GO NOW!`, 2026-09-12). Three
fixes were on the table: rank on test money, leave the ranking alone and say
plainly what it reads, or accept it and correct the **Funnel**'s sentence. The
owner took the first.

`Table 3.A: Settings, ranked` now arrives ordered by `beat the kept null
money`, best first — of the kept scrambled copies of the whole table, how many
each setting's `avg test $` beat. The line under the table says so.

The RULE NINE question this paragraph raised — that changing the order changes
every existing set's table without re-running anything — was answered by
applying the order in TWO places rather than one: where the totals are
written, so a set totalled from now on holds it, and again where the table is
read, so a set totalled before it reads the same. No record changed, nothing
was re-totalled, and no reader has to ask how old a set is.

**WHAT IS STILL TRUE, AND MUST NOT BE READ AS FIXED.** Stage 3 still prices
every setting on the held-back stretch. `avg held-back $`, the four
comparisons and `beat its own null set` are all still worked out there, still
on this screen, and still one press from ordering the table by them. So:

- The held-back stretch does NOT arrive at **Verify** unread. It is read for
  every setting of every set at pricing time, and stopping that is a change to
  the shape of every stored record, not a change to a sort.
- What is gone is the held-back reading steering the choosing with nobody
  choosing it. Every reading of it that remains is a press.
- The hover text on `avg held-back $` still says "the once-only look, on data
  no ordering ever read". That was flatly untrue before 3.114.0, and is now
  untrue only when the owner presses that column's own sorter — which the
  screen still offers. It is named here and NOT changed: the owner authorised
  the ordering and nothing else (RULE ZERO). The change below is where it
  belongs.

## The change

Built so it cannot happen, rather than kept as a habit. Three parts.

1. **The choosing screens show only numbers that were never worked out from the
   held-back stretch in the first place.** Not filtered out at the end.
2. **Held-back numbers are produced only on an explicit press, counted as a
   look, and stored where the choosing screens cannot read them.**
3. **A check reads the choosing screens' own code for any use of a held-back
   figure and refuses to let it ship.** This is the part that makes it hold. A
   discipline that depends on remembering is not one.

The same applies inside the rule: if a `floor` can be set on a figure that
exists for the held-back stretch, the rule must be told which stretch it is
reading and refuse the wrong one.

## What it needs from the other parts

Nothing, but note that **Verify already does this and says so**: "There is no
sort on this table: a sort is a look." The gap is on the choosing screens, not
here. Part 5's refusal depends on this being done first, because a
threshold typed while the answer is on screen is the same fault in a new place.

## What I am assuming

- **That the choosing screens are a list that can be written down.** Today I
  would say **Sweep**, **Boards** and **Funnel**. If the boundary is fuzzy, the
  check is fuzzy.
- **That a code check can tell the two apart.** On the screens they are already
  named apart, so a check scoped to the screens will work. It cannot see inside
  the engine, so anything the engine hands over pre-mixed stays uncovered. That
  is a real gap and it should be named rather than glossed.

## What it costs

Not small, and the first draft was wrong to say so. `avg held-back $` is a
stored column on every board row, with a `floor` and a sorter reading it, and
the **Funnel**'s own step line mentions it. Taking it out of choosing means a
change to the shape of a stored row, losing one `floor` and one sorter, a
rewrite of that step line, and then either rewriting every existing record set
into the new shape or re-running them.

---

# Part 4 — a cheap way to rule out a bad way of choosing

> **BUILT AND DEPLOYED, 3.102.0.** It is its own block on the **Funnel**, above
> `Step 1`, headed `Does the ranking hold?`. What shipped differs from the draft
> below in four ways, each recorded here rather than quietly:
>
> - **Thirds, not halves.** The pricing already works the test window out in
>   three parts for every setting, so three parts cost nothing where two would
>   have cost a pass — and three parts give FOUR boundaries where the draft's
>   halves give one. The draft asked for "several cut points rather than one";
>   this is how that was met. The columns are `first → second`, `second → third`,
>   `first → third` and `first two → third`.
> - **No scoring pass of its own.** The draft's cost line assumed the money
>   within the test window was not on disk. It is: the numbers kept beside a
>   stage 3 set carry it per setting per unit. What was missing was that those
>   numbers only ever covered the settings some rule happened to keep, and that
>   is what changed — see the note below.
> - **The press above the steps preps the WHOLE record set** (owner order,
>   2026-09-10). It moved off `Step 6` to the top of the screen and now runs for
>   every setting on the board rather than the rule's survivors. It is also
>   renamed: `work out the test history numbers`, because it is pressed by hand
>   on every stage 3 record set that is not ready to be walked, and "missing"
>   said nothing about what it works out. That is what makes this reading possible at all: a ranking
>   over the survivors of a rule already made by ranking is no test of anything.
>   `Step 6` reads its two limits off numbers that are already there and points
>   at the press by its new name.
> - **Four numbers, not one bar.** `how much must hold` (from -1 to 1, blank
>   until the owner sets it — a blank is never read as zero), `on how many of the
>   four`, and TWO floors that are not the same thing and do not borrow each
>   other's word: `fewest settings ranked` counts settings — one combination of
>   `entry`, `gate`, `d`, `t`, `trail` and `arm` — and `fewest chunks a part`
>   counts how much history is behind each figure. None of the four re-reads
>   anything: the reading is taken once and they are arithmetic on it.
>
> **`fewest chunks a part` is the one that separates the shapes** (owner,
> 2026-09-10, who set it at 40 deliberately to cut them off). On today's history
> a shape that decides once a week has about 16 chunks in each part of its test
> window where one that decides daily has over 100 — and `daily-3d` and
> `daily-4d` under `24/5` are Monday-only starts, so they are in the same place.
> Each setting's figure over 16 chunks is a handful of trades, and noise in both
> halves of a correlation drags it toward zero: a short coin and shape reads
> WORSE than it is, so without this floor you would drop a good one for being
> short. Below the floor the row says how short it is and prints no number. Read
> off the window each run actually recorded, never re-derived from the layout;
> a run that recorded none is not assumed to be long enough.
>
> The table has one row per coin and shape — a set can hold three hundred, so it
> pages, using the same bar Boards draws. `show` and `order by` choose which rows
> are drawn and in what order — filtering, never curating: the line under the
> table always says how many of the whole set is being shown. Each row that is
> not the one being walked carries `walk this one`, which hands the walk over
> through the same door the coin picker uses.
>
> **It is the FIRST panel on the screen, above the coin picker** (owner order,
> 2026-09-10: "the point is largely to confirm that given units are *worth* even
> funneling"). Walking a row IS the picking, so the table is the way in and the
> picker and the set heading sit below it as confirmation of what was chosen.
>
> **And the heading asks; it never confirms.** `Worth walking?` — not "confirm"
> anything, because a pass here is the absence of a red flag and a heading with
> confirm in it would make a pass read as proof.
>
> **It reads nothing from the held-back window and nothing from the reserve**,
> which is what makes it legal here (Part 3). `lib/rankhold.js` requires nothing
> and can be exercised on a table typed into a test; `tests/test-rankhold.js`
> does exactly that.

> Renamed from the first draft. It cannot show that a way of choosing works. It
> can only show cheaply that one does not, which is still worth having.
>
> **Moved 2026-09-09, owner's catch.** The first version of this part put the
> reading on **Verify**. That is wrong. By the time you are on **Verify** a
> `Stage 4 record set` already exists, so a warning about the choosing would
> arrive after the choosing it was meant to inform. This part's whole claim is
> that it warns before anything is spent, and **Verify** is after the spending.
> It lives on the **Funnel**.

## The problem

The way of choosing is a procedure: rank everything by a figure, keep the top N,
apply some floors. Nothing measures whether that procedure still picks winners
on history it has not seen. You find out when the reserve is opened, by which
point the answer is about that one selection and the stretch is spent.

## The change

Split the test stretch in two. Rank every setting on the first half. Score them
on the second half. Then ask: were the settings that came top on the first half
anywhere near the top on the second?

- **Ranking holds up** → nothing has been ruled out. This is not evidence that
  the choosing works. It is the absence of a red flag.
- **Ranking is unrelated** → the choosing is picking at random and nothing that
  comes out of it means anything, however good the numbers look.
- **Ranking inverts** → worse than useless. What is being selected for is
  actively wrong across the boundary.

Do it at several cut points rather than one, and show the highest and lowest
answer on the **Funnel**.

**Two forms of it, and the earlier one is the better warning.**

- **The general form** asks whether ranking this stage 3 record set by its test
  money still picks winners across a boundary inside the test stretch. It is a
  property of the set, not of any rule, so it is available BEFORE the walk
  starts. That is where it should be shown: at the head of the walk, before the
  first cut, where it can still change what you do.
- **The specific form** asks the same of this rule's own selection, and it comes
  as the rule is built. Useful, but it arrives after you have begun.

Build the general one first. It is the cheaper reading and it is the one that
can still stop something.

## Per unit, and a table of all of them (owner, 2026-09-09)

**It should not be limited to the one unit being walked.** A stage 3 record set
covers many units — the **Funnel** offers `Read the other units`, and **Verify**
speaks of every `other coin-and-shape unit` of the stage 3 set the current one
was cut from. So run it per unit: rank that unit's settings on the first half of
test, score them on the second, and get one number per unit.

**Then show all of them in one ordered table.** This is the owner's idea and it
is the better half of this part. It answers a question that cannot be asked
today: before walking anything, which units have a ranking worth trusting and
which are ranking noise. A unit whose own ranking inverts inside its own test
stretch is one that should not be walked at all.

**Where it goes.** Beside the control that picks which unit to work on. On
screen that is `Choose`, with `coin` and `shape:`, under the heading
`One rule per coin and shape:`. **There is no control on any screen called a
unit selector** — that is the owner's phrase in conversation and it is recorded
here as their phrase, not as a label. Whatever the table is called, its name is
theirs to give.

**Ordering it is allowed here, and it is worth saying why.** **Verify** refuses
to sort its own tables and gives the reason: a sort is a look. That reason is
about held figures. This table holds test figures only, so ordering it costs
nothing and spends nothing. The **Funnel** already has `Order the whole set by`
as the pattern to follow.

**The cost, said plainly.** This is one more thing you would be choosing units
on. It reads no held or reserve figure so it spends no look, but it is still
shopping, and Part 5's count of what was tried has to include it or the luck
arithmetic understates the search.

## What it needs from the other parts

Nothing of its own. It is the only part that stands completely alone.

It does have to obey Part 3, and it does: it reads test figures only and never
touches held, which is what makes it legal on a screen used for choosing.

## What I am assuming

- **That each half is long enough to rank on.** If the test stretch is short,
  both halves are short and the answer is meaningless. There is a length below which
  this should refuse rather than mislead and I do not know it yet.
- **That a boundary inside the test stretch resembles the real one.** It does
  not. The real gap is longer and further away. So this test flatters the
  answer by the way it is built. Failing it is decisive. Passing it proves
  nothing, which is why the part is named the way it is.
- **That comparing all settings is the right question.** It includes hundreds
  that were never in contention. Asking only about the top N may be the better
  question, since that is what gets kept. I would build both.

## What it costs

Not free, and the first draft was wrong to say so. What is stored per setting is
one money figure over the whole test stretch, not one per half. So this needs a
scoring pass per half per cut point, and the scrambled copies with it if the
ranking is to be read the same way the real ranking is. Cheaper than Part 1 by a
lot. Not nothing.

---

# Where the effort goes

Every part, both files, so the whole picture is in one table. `VERIFY-DESIGN.md`
carries the text of the ones marked as living there.

| Part | Written in | Machine cost | Build cost | Blocked on |
|---|---|---|---|---|
| 1 — several stretches, on **Verify** | `VERIFY-DESIGN.md` | medium | medium | nothing — the engine is built and reachable from no screen; the screen is next |
| 2 — best of all four | `VERIFY-DESIGN.md` | none | small | **BUILT 3.100.0 / 3.101.0** |
| 3 — out of reach while choosing | here | none | high | owner's call on losing the `floor` and the sorter on `avg held-back $` |
| 4 — rule out a bad way of choosing (on the **Funnel**) | here | low | small | **BUILT 3.102.0** |
| 5 — bar for the whole search | `VERIFY-DESIGN.md` | none | small | whether the figure it wants to set a bar on means what it needs |
| 6 — claim written first | `VERIFY-DESIGN.md` | none | medium | making a look an event |
| 7 — what the thrown-away settings did | `VERIFY-DESIGN.md` | none | small | **BUILT 3.100.0** |
| 8 — judge the thing you would trade | `VERIFY-DESIGN.md` | none | small | nothing |

**Parts 2, 4 and 7 are BUILT and on the box.** Part 2 shipped as 3.100.0, with
the table that replaced its prose line in 3.101.0. Part 7 shipped as 3.100.0.
Part 4 shipped as 3.102.0.

**Two pieces of Part 3 are on the box as well**, and the part stays open because
the larger half is not: 3.107.0 put the **Funnel**'s four comparisons on the
test window, and 3.114.0 stopped `Table 3.A: Settings, ranked` arriving in an
order worked out from the held-back stretch. What is still open is the `floor`
and the sorter on `avg held-back $` themselves, and the check that would refuse
to let a held-back figure ship onto a choosing screen at all.

**Part 4 needed no scoring pass in the end.** The money each setting made within
the test window IS kept, in three parts, in the numbers stored beside a stage 3
set — the earlier note here, that `lib/stagework.js` projects the block away
before it is written, was about the stage 3 RECORD and not about those numbers.
What was true is that those numbers only ever covered the settings a rule
happened to keep. `work out the missing numbers` now runs for the whole record
set, once, before the walk begins.

**Part 1 is being built now, and it does not wait on Part 8.** The timing
question was withdrawn as a blocker by the owner ("i don't care about timing
retraining for the Part 1 as some kind of blocker"), and the engine is done.
Part 8's rule simply applies to Part 1's own summary from the start: it counts
SETTINGS that cleared every pass and names them, never passes that a set
cleared. A session that turned that into a dependency invented one.

**Everything else needs an answer first**, and the answers are cheap: decide
whether the held-back column can leave the choosing screens, check whether the
figure Part 5 wants to set a bar on means what Part 5 needs, and decide whether
a look is an event.

I have deliberately not repeated the first draft's ranking of what to build
first. That ranking was made while three of the six costs were wrong.

# What is not in here

- How the forecasts are trained. Separate design.
- Anything about **Coins**, the tab between **Data** and **Sweep**. It is a
  screen with nothing on it yet, and the two ways of training it will give
  **Sweep** are the owner's design, not this document's.
- A bar for claiming "the best of these two hundred, chosen afterwards", which
  is how the system is actually used today. Part 6 does not cover it and I have
  not designed it.
- What to do with the record sets already on the box. Re-running, rewriting into
  a new shape, or deleting is the owner's call and depends on which parts get
  built.
