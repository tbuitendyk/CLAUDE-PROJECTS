# How a setting earns the right to be believed

A proposal, written 2026-09-09. **Nothing here has been built and nothing will
be until the owner says so, part by part.**

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

Six parts, one at a time. Each has the same shape: **the problem**, **the
change**, **what it needs from the other parts**, **what I am assuming**,
**what it costs**. Where a part cannot honestly be planned until something is
measured, that is written at the top as a **blocker**, not buried in a bullet.

The parts are **not** independent. Where one leans on another, the part says so.

**Eight parts now.** Part 8 was added on 2026-09-11, and the rule below it was
added the same day — it governs every part and is the reason several of them
exist.

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

## The one change that pays for itself immediately

**Stage 3 should not price on held.**

It does so to produce `beat`, `avgHold` and the four comparisons — and the main
use of `beat` is to **sort the ranked table** (`lib/stages.js:4229`, by
`beat / pairs`). The Funnel chooses on test money and never reads any of it.

So the held stretch — the one stretch that could give Verify a genuinely first
look — is being spent on a sort order. **If that table sorted on test money
against its own test copies, held would arrive at Verify untouched.** No data
is lost, nothing needs re-running to change an ordering, and the verification
problem stops being a hunt for clean data.

That is the highest-value item in this whole document and it is not in any of
the eight parts.

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

The **fitting** stretch is the only part of the budget that can be spent more
than once, because every pass trains again on its own slice and nothing there
ever chose anything. So walk-forward passes belong inside it — and nowhere
else. Judging a pass on the choosing stretch judges dials on the data that
picked them; judging one on a judging stretch spends a claim to answer a
different question.

---

# Part 1 — judge on several stretches, not one, on Verify

> **Reshaped 2026-09-09 by the owner, and the reshaping is the good part.** My
> version re-ran the whole sweep five times and I said the cost was the thing
> most likely to sink it. The owner's version runs on the ONE `unit` the
> **Funnel** already narrowed to — one coin, its companions and one shape. That
> is a fraction of a full stage 1 sweep, which trains every combination in the
> universe. The blocker I put here has largely gone with it.

> **BUILDING, 2026-09-11.** The owner: "i don't care about timing retraining for
> the Part 1 as some kind of blocker. just queue up part 1 next" — so the timing
> measurement is withdrawn as a blocker and the cost is discovered by building
> it. And the open question this part raised is ANSWERED by the owner: **a
> pass's judging stretch is NOT a counted look.** Five stretches never opened
> before are five fresh rolls, not five spends of the one look; the single
> verdict's held-back read stays the counted one.

### 1.0 The rule this is judged by, written before any of it was built

Written first and on purpose, so that no number produced later can be talked
into being a success (RULE SIX's discipline, which is worth keeping whether or
not a loop is running).

**Done means all six, and any one of them failing means not done:**

1. **Five passes on ONE coin and shape, and the reserve in none of them.** A
   test asserts no pass's judging stretch overlaps the reserve, on real stored
   ranges — not on a comment saying it does not.
2. **Every score is against the copy count the ORIGINAL run used at that
   stage**, read off the set, never typed. A test changes a stored count and
   watches the reading move; if it does not move, the count is not being read.
3. **One retrain per pass, shared by both sides.** The settings the rule kept
   and the sample it dropped are priced against the SAME retrained forecasts.
   If the retrain happens twice per pass, the control is not free and the part
   is built wrong.
4. **No pass stamps a counted look.** A test runs the passes and asserts the
   set's held-back-read stamp is exactly what it was before. This is the
   owner's ruling and it is the one thing here that cannot be got back if it
   ships wrong.
5. **The block draws ABOVE the single verdict.** A weaker number read first
   becomes the number that is remembered.
6. **Green suite, a Help entry for every new control the Help tab can see,
   every new rendered label on the word list regenerated from what the box
   serves, a deploy whose health check passes, and a mutation guard for each of
   1 to 5** — because a behaviour with no guard is a behaviour that reverts
   quietly.

### 1.0a What I expect to go wrong, written before looking

- **The retrain may not take an arbitrary boundary.** If stage 1's stretch
  layout is fixed in the engine rather than passed in, then sliding it is a
  change to the engine and not a new caller — a much bigger release than one
  Verify block, and it would put every record set on the box in question. If
  that is what the code says, the honest move is to PARK the sliding boundary,
  say so, and put it to the owner (RULE ZERO) rather than change the engine
  unasked.
- **The copies almost certainly cannot be carried between passes**, because a
  copy set is keyed to the window it was built on. So the cost is five times
  (retrain + copies + pricing), which may be hours. It has to be a started and
  polled job with real progress, never a held request — the same contract the
  other Verify reads already use.
- **"The bare unit at stage 1" may have no number today.** If no single stored
  figure means that, one has to be chosen. That is a small choice inside an
  approved step, so it is mine to make and to record here — but it must be
  built from something already stored, never from a new measurement invented to
  make the level scoreable.
- **Twenty copies give a resolution of one part in twenty**, so a pass can only
  be stated in steps of five percent. Keeping the original counts is right for
  comparability and it is still coarse. Saying "cleared four of five passes" off
  a five-percent grid is a coarser claim than it sounds.

### 1.0b What the code actually says, read before building

Six readers mapped the engine and six adversarial checkers tried to refute
them: 184 facts confirmed, 51 claims thrown out. What survived, and what it
changes:

**The sliding boundary is nearly free, but not quite free.**
`splitAndLabelAt(chunks, branch, nTrain)` already takes the training length
from its caller and is already in production for the History retrain. What it
does NOT give is a third stretch: it returns `holdChunks: []`, and it labels
only the chunks handed to it. So a pass is built by slicing the chunk list into
"everything before the judge" and "the judge", calling `splitAndLabelAt` on the
first, and labelling the judge with the band that call RETURNS. The band comes
from the training slice and never from the judge — that is not a nicety, it is
the difference between a judgement and a rehearsal. `unitChunks` decides the
layout internally from two literal names, so this is one added branch there,
additive, changing no existing layout.

**The copies need no new builder.** `keepN` and `keepFrom` beside the payload
give each pass its copies on that pass's own stretches, the way the noise top-up
already does. Independent draws per pass come from the TAG `dealOrder` already
takes as an argument — a new tag per pass, not a new random source.

**Levels 1 and 2 have no stored number to read, as §1.0a feared.** What exists
to re-derive is the forecast score, and every one of its five call sites scores
on TEST labels — there is no hold-stretch scorer. So the level is the forecast
score on that pass's judge labels: the same arithmetic, new labels, nothing
invented.

**The cost is much larger than the first reading said, and it is worth saying
out loud.** One boost member is ten seconds when the fitting stops early and
about 134 when it keeps improving; a triple-coin unit's committee is 10 to 22
minutes of fitting at full CPU, not the 43 seconds a noise-floor measurement
suggested. Five passes is therefore roughly **one to two hours** of retraining
alone, before any pricing, and a triple-coin unit reloads its candle maps every
pass because the cache is four deep and never hits for three coins. This has to
be a started-and-polled job with real progress, and the owner should know the
figure even though they have ruled the measurement is not a blocker.

**Where it goes:** `public/construct.js:2044`, between the press row and the
verdict blocks — which satisfies "above the single verdict" without pushing the
set picker down. The watcher to copy is the one the ride uses, paired with a
progress-bearing status door; the verdict's own watcher carries no progress and
is the wrong shape. Eleven tests scan Verify's source, one of them pinning three
substrings in order, so they move with this.

### 1.0c THE FAULT IN THIS PART'S OWN TABLE, found before building it

The five-pass table above is wrong in two ways, and both were found by working
its arithmetic back against the engine rather than by being told.

**One: it reaches into the reserve.** The table takes the judging width as
`round(non-reserve / 10)` = 232, and pass 5 then ends at chunk 2319 of 2315
non-reserve chunks — four chunks inside the sealed reserve this part promises in
its own words never to touch. Taking the width as `floor` gives 231 and letting
the last judge absorb the remainder ends it exactly on the boundary. Fixed here.

**Two, and it is the one that matters: every judging stretch is already spoken
for.** The owner's sets are `reserve61`, which seals 13% and then splits the
rest 70/15/15 — which is where the name 61/13/13/13 comes from. For the owner's
set that puts the original run's fitting and tuning on chunks 1 to 1968, its
held stretch at 1969 to 2315, and the reserve beyond. Against that:

| pass | judges | of that, inside the already-spent held stretch | inside what the original run chose the dials on |
|---|---|---|---|
| 1 | 1156-1386 | 0 | all 231 |
| 2 | 1387-1617 | 0 | all 231 |
| 3 | 1618-1848 | 0 | all 231 |
| 4 | 1849-2079 | 111 | 120 |
| 5 | 2080-2315 | all 236 | 0 |

**So the owner's ruling that a judging stretch is not a counted look holds for
passes 1 to 3 and fails for 4 and 5 on its own stated grounds.** Pass 5's
judging stretch IS the held stretch the single verdict already read. It is not a
stretch never opened before.

**What this does to each level.** Levels 1 and 2 are clean on all five passes:
each pass retrains, so its judge is genuinely unseen by THAT pass's forecasts,
and there are no dials to contaminate. That is the half this document says
cannot be answered today, and it works. Level 3 is not out-of-sample on any
pass: retraining the forecasts does not de-contaminate the DIALS, which were
chosen knowing chunks 1 to 1968 — inside passes 1 to 4's judges — while pass 5
judges them on a window already spent. §1's own assumption that "cleared it five
times is a claim about the dials" is right and does not go far enough: the dials
were picked inside four of the five stretches they are being judged on.

**What is built because of it:** every pass's row prints how much of its judging
stretch fell inside the selection window and how much was the already-spent held
stretch, and the level-3 line says plainly that it is not an out-of-sample
reading. A five-pass record that reads as five confirmations when it is none is
the exact fault this document exists to prevent, and a screen that knows the
number and does not say it is worse than one that never worked it out.

**Left for the owner** (and not decided by a session): whether level 3 earns its
compute at all, given it cannot be out-of-sample, or whether the kept-against-
dropped difference should carry that question instead — where the contamination
falls on both sides equally and the gap still means something.

## The problem

A single held-back stretch is one roll of the dice. Whatever that stretch
happened to do dominates the answer, and nothing separates a setting that works
from a setting that suited that stretch. Once opened it is spent — a second look
at the same stretch is not a second roll.

## What is on Verify today

Read out of the word list generated from what the box serves. Three blocks.

**The verdict.** "The verdict on a `Stage 4 record set`". Pressed with
`Read the rule against nothing on the held-back window`. Two boxes set it:
`bar share %` and `noise must lose at least %`. It reads what the `survivors`
made on the held-back window against four comparisons, of which two gate —
`buying the coin and going away` and `shorting it and going away` — while
`being long every period` and `being short every period` are shown and, in the
page's own words, "the window's direction and never a gate". Around it sit
`Rules declared before the numbers:`, `Looks at the held-back window before any
stamp:`, `Every survivor against its own copies:` with its by-chance count, the
`sanity:` line on the scrambled copies, and `Line A` and `Line B, the bound on
shopping`.

**The other units.** `Read the rule on the other units' held-back windows` runs
the same rule on every other coin-and-shape `unit` of the stage 3 set this was
cut from, each on its own held-back window against its own copies. Two counts,
information only, never a gate. About five seconds a `unit`.

**The ride.** `Work out the held-back ride` gives, per survivor,
`largest drawdown $`, `worst trade $`, `best trade $`, `trades won`,
`stopped out`, `gross per trade $` and `money by third`, beside the same on the
test window. Information only, and every press is a counted look.

Two things worth noticing before adding anything. Verify already refuses to sort
its tables, and says why: "There is no sort on this table: a sort is a look."
That is Part 3's principle, already applied here. And
`Rules declared before the numbers:` is already Part 6 in embryo.

## The change, as an added block on Verify

Take the one `unit` the **Funnel** worked on. Retrain it five times with the
boundary sliding forward, and score three things on each pass against the same
copy counts the original run used at each stage. Nothing touches the reserve.

For the owner's set the passes divide the coin's history like this. The reserve
stays sealed at 346 chunks and appears in no pass.

| pass | train | test | judge |
|---|---|---|---|
| 1 | 954 | 205 | 232 |
| 2 | 1,145 | 246 | 232 |
| 3 | 1,336 | 287 | 232 |
| 4 | 1,527 | 328 | 232 |
| 5 | 1,719 | 368 | 232 |

Train and test do exactly what they do now. The judge column is that pass's
held-back stretch, opened only after the choosing is finished.

**Scored on each pass, at three levels:**

1. the bare `unit` at stage 1, against that stage's own copy count
2. the bare `unit` at stage 2, against that stage's own copy count
3. the `survivors` at stage 3, against that stage's own copy count

Splitting one and two from three splits a question that is currently answered as
one number: do the forecasts still work on data they never saw, and separately,
do the trade settings still work. Today you cannot tell which half failed.

**And the control, which is nearly free.** The **Funnel** kept 199 settings of
2,752 for this set. Put a sample of the other 2,553 through the same five
passes. The expensive part is retraining the `unit`, and the kept and the
rejected share those same trained forecasts, so adding the rejected ones is only
more pricing against models already paid for. If the rejected do as well as the
`survivors` across five passes, the picking added nothing and the 199 are just
the top of a pile that was all doing well, not a selection.

The same control has a much cheaper form that needs none of this built, on the
held-back stretch that already exists. That is Part 7, and it should be built
first.

## What gets ADDED to Verify

**Controls.**

- One press to run the passes. It needs a name and I am not going to invent one
  here; the existing presses on the page are phrased as instructions, which is
  the pattern to follow.
- A box for how many passes.
- A box for how many rejected settings to sample, with none as a legal value.
- Nothing else. The copy counts are read from the stages the set was built by,
  never typed, so they cannot drift from what the original run used.

**Results.** One table, one row per pass, showing the train, test and judge
chunk counts and dates for that pass, then for each of the three levels: what
was made, what the copies made, and `beats N of K`. Under it, a single line:
cleared on how many of the passes. Beside each survivor figure, the same figure
for the rejected sample.

## What gets REMOVED

Nothing. I looked for something and there isn't anything.

The single verdict stays, because it is what History's reserve grade is keyed to
and because it is the one reading on the real held-back stretch.
`The rule on the other units` stays, because it answers a different question:
the same rule elsewhere, one window each, rather than this `unit` across five.
The ride stays.

**One thing should move rather than go.** The five-pass record is stronger
evidence than the single verdict, so it should sit above it on the page. A
weaker number read first becomes the number people remember.

## What it needs from the other parts

Part 2, because a record of clearing a soft bar is a record of nothing. And it
needs one question answered that I cannot answer: **is each pass's judging
stretch a counted look?** Each one is a stretch never opened before, so the
natural reading is no. That has to be decided rather than assumed, and it
belongs with Part 6.

## What I am assuming

- **That five retrains of one `unit` is affordable.** Far more likely than my
  version, but still unmeasured. One retrain of this `unit` is the number to get.
- **That claiming the same six dials is the same claim on every pass.** Each
  pass retrains, so the forecasts behind a setting on pass five are not those
  behind it on pass one. "Cleared it five times" is a claim about the dials.
  That is probably what you want, since the dials are what carries forward, but
  it should be said rather than assumed.
- **That the copy counts hold up at five passes.** Twenty copies gives a
  resolution of one part in twenty, so a pass can only be stated in steps of
  five percent. Keeping them as the original run had them is right for
  comparability. It is still coarse and worth knowing.

## What it costs

Five retrains of one `unit`, plus five sets of scrambled copies, plus pricing
the kept and the sampled rejected settings on each pass. The copies have to be
rebuilt per pass from that pass's own stretches and cannot be carried over.

This is far cheaper than the version I first wrote, and it is the only part of
this document whose cost I still cannot put a number on.

# Part 2 — make the bar the best of all four comparisons

> **BUILT AND DEPLOYED, 3.100.0 (the gate) and 3.101.0 (the table).** The gate
> is the best of all four. The four are shown on **Verify** as a table with a
> heading on every column, replacing the prose line that carried them, after the
> owner found that line flipping its subject halfway through. Nothing below is
> outstanding.
>
> **This part was wrong in the first draft and I told the owner the wrong thing
> in conversation before writing it.** I said the money gate was buying the coin
> and going away, and that this was a soft one-sided bar. It is not one-sided.
> What the code actually requires is all three of: money above zero, beats
> `buying the coin and going away`, and beats `shorting it and going away`.
> That is already a best-of-two bar, and it already rules out a fixed direction
> lean against the one-trade pair. The rest of this part is rewritten against
> what is really there.

## The problem

The gate today uses the two one-trade comparisons. Those carry almost no dealing
costs, because they are one trade over the whole stretch. The code's own note on
them says this makes them the **harder** bar over a trending stretch and the
easier one over a chopping stretch.

The two every-period comparisons — `always long` and its short version — pay a
round trip on every single period. Over a long stretch that is a very large cost
load, so they are usually the **easier** bar in a trending stretch.

So neither pair is harder in general. Each is harder in different conditions,
and the pair used today is chosen without reference to which condition holds.
That is the real fault: **the bar's difficulty moves with the market and nobody
decided that it should.**

## The change

Gate on the best of all four, plus zero:

- `always long`
- its short version
- `buying the coin and going away`
- `shorting it and going away`
- and being in the money at all

A setting passes only by beating the highest of them. This is strictly harder
than today and strictly harder than what the first draft proposed, and it does
not depend on guessing which condition the stretch was in.

## What it needs from the other parts

Part 1, and this is the important one. Taking the best of four removes exactly
one advantage: the advantage a setting gets from having leaned the way the
stretch happened to go. It does nothing about ordinary luck — a setting that
traded rarely and caught a few big moves still clears it. Only judging on
several stretches turns that into something you can see.

## What I am assuming

- **That a fixed direction lean is worth this much attention.** It is what bit
  us. It is not the only way to look good without being good.
- **That the four are comparable enough to take a maximum over.** They are not
  built alike. The every-period pair opens a position on every period regardless
  of what the setting did, so they do **not** trade the same number of times as
  the setting — the first draft said they did, and that was wrong. Taking a
  maximum over four things measured on different trade counts needs a reason,
  and the reason I would give is that each answers "could this have been got
  without the forecasts", which is the question the gate is for.
- **That the scrambled copies do not already cover this.** They may partly. They
  deal the same calls onto other days, so a setting that is long nearly always
  looks similar on every copy, which means the copies bar already penalises a
  flat direction lean to some degree. How much, I have not measured.
- **That a maximum is the right shape, rather than a margin read against
  something.** A stronger version is to measure the margin over the best of the
  four in units of how much that stretch moved about, so the bar means the same
  thing in a calm stretch and a wild one. That is more work and I think it is
  better. It is worth deciding which.

## What gets ADDED to Verify

Almost nothing, because the four figures are already on the page. Verify prints
`buying the coin and going away` and `shorting it and going away` as the two
that gate, and says of the other two, in its own words, that
`being long every period` and `being short every period` "are the window's
direction and never a gate".

So the addition is one line: **did the rule beat the best of the four**, stated
plainly rather than left for the eye to work out across four figures. And that
line becomes what decides pass or fail, replacing the two that decide today.

Nothing is removed. All four figures stay printed exactly as they are.

## What it costs

Small. All four are already computed and stored, for every `setting`, not only
for the `survivors`. This is a change to which number decides pass or fail, and
which is only shown.

---

# Part 3 — put the held-back numbers out of reach while choosing

> **ONE PIECE OF THIS SHIPPED, 3.107.0** (owner order 2026-09-10: "build the
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

**Not fixed, and not scoped here.** Whether the fix is to rank on test money,
to leave the ranking alone and say plainly what it reads, or to accept it and
correct the Funnel's sentence, is the owner's call — and the first of those
would change what every existing set's table looks like without re-running
anything, which is its own decision under RULE NINE.

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

# Part 5 — set the bar for the whole search, not one setting at a time

> **Blocker.** This part rests entirely on one figure being fit for a purpose it
> was not built for, and the code says twice that it is not. Until that is
> settled, building this would refuse real work on a wrong number, which is
> worse than the note it replaces.

## The problem

If you try a great many settings and each has some chance of clearing its bar by
luck, a good number clear it by luck. A count of survivors means nothing until
you know how many would have survived with no skill at all.

**What exists today, exactly.** **Verify** prints a line of the form "N of M
survivors clear the same bar on their own copies, about X would by chance". That
line is about settings that have **already been selected**, measured against
their own scrambled copies, and the same line ends by saying it is never a gate.
The code says the same thing in its own comment.

So the figure that exists is not the figure this part needs. What is needed is:
of everything that was **tried**, how many would clear by luck. That is a
different question about a different population.

## The change

Two things, neither of which can be made until the blocker above is resolved.

1. **Refuse rather than note.** If the count that cleared is not clearly above
   what luck would give, the set does not go forward — with both numbers side by
   side, and no way to read past it.
2. **Count everything that was tried, not just the last step.** Every step you
   keep the best of is another go at `shopping`, and they add up. A count of
   tries has to carry forward through the whole **Funnel**.

## What it needs from the other parts

Part 6, and this is a genuine problem with the part as written. Whatever number
counts as "clearly above" has to be set by the owner, and a threshold typed
while both counts are on screen is a bar chosen knowing what will clear it —
exactly what Part 6 exists to stop. So the threshold has to be registered under
Part 6 before the counts are visible, or this part is a speed bump rather than a
gate and should be argued for on that basis.

## What I am assuming

- **That the tries are independent.** They are not. Settings share dials, coins
  and stretches, and the code already says so about the survivors. A raw count
  of tries fed into a luck figure that assumes independence overstates the luck.
  What is wanted is an effective count, or a bound, not a raw one.
- **That the count of tries is knowable across the whole Funnel.** Each step
  knows what it started with, but nothing carries that from one step to the
  next today, so it would have to be added.

## What it costs

Small once the blocker is answered: carrying a running count from step to step,
and one refusal.

---

# Part 6 — write down the claim before the stretch is opened

> **Blocker.** Everything in this part rests on the claim being written at the
> same moment the look is counted. Today a look is not an event — the count is
> worked out afterwards from the steps the **Funnel** stored. So making a look
> into a thing that happens, and can carry a claim, is the first piece of work,
> not a detail.

## The problem

**The claim is written after the answer is known.** Which figure, which
comparison, what bar — all of it can be settled once the numbers are visible.
No single choice is dishonest. Together they mean the bar was chosen knowing
what would clear it, and such a bar is not evidence.

**The thing judged is not the thing traded.** A figure averaged across two
hundred survivors describes holding all two hundred at once, which nobody is
going to do. If one of them goes live, the average said nothing about it.

## The change

Before the held-back stretch is opened, the system records:

- which setting, or which named group of settings, is claimed
- which figure decides it
- which comparison it must beat
- what the bar is
- how many settings were tried to get here

**The claim written before the stretch was opened is the one that is judged.**
A later one is written beside it, marked as written after the fact, and cannot
replace it. Both stay visible.

And what is judged is what is traded. One setting going live is named up front
and judged alone. A group traded together is judged on the money the group would
have made, not on the average of the settings in it.

## What it needs from the other parts

Part 5 depends on this. Part 1 raises the unanswered question of whether each
judging stretch is a look, which this part has to answer.

## What I am assuming

- **That you are usually claiming one setting or a named group.** The case in
  front of us is not that — it is two hundred survivors chosen after the fact,
  and this part as written does not cover it. Either a bar for
  choosing-after-the-fact gets designed here, or this part is honestly labelled
  as being for a future way of working and the current way stays uncovered. I
  have not designed that bar and it is the largest hole in this document.
- **That recording the claim is quick to use.** If it is a form to fill in
  before every look it will be resented and worked around. It should be filled
  in from what the **Funnel** already knows, with the owner confirming.

## What it costs

Not small, because of the blocker. Making a look an event that happens, rather
than a number worked out afterwards, is the real work. Less than the first draft
implied, though: **Verify already prints `Rules declared before the numbers:`**,
so the place to hang a claim exists and what is missing is the binding of it to
the moment of looking. Attaching a claim to it
after that is easy.

---

# Part 7 — what the settings you threw away did on held

> **BUILT AND DEPLOYED, 3.100.0.** `Read what the rule dropped` is on
> **Verify**, with the how-many box and both sides in one table. Nothing below
> is outstanding except the question of whether it should ever gate, which is
> Part 5's and still blocked.
>
> **The cheapest thing in this document, and it needs nothing else built
> first.** No retraining, no extra passes, no new arithmetic. Every figure it
> reads is already sitting in the record set.

## The problem

For the set this document was written after, the **Funnel** kept 199 settings
out of 2,752. All 199 were positive on the held-back stretch, against about 32
expected to clear their own bar by chance. That reads as overwhelming evidence.

It is only evidence if the 2,553 that were thrown away did worse. Nobody has
ever asked. If nearly all 2,752 were positive on that stretch, then 199 of 199
says the stretch rose. It says nothing whatever about the picking, and the 199
are just the top of a pile that was all doing well.

This is general. Any count of `survivors` that clear a bar is unreadable without
the same count for what did not survive.

## The change

One block on Verify, behind its own press, information only.

The sharpest form is a single comparison:

- of all 2,752 settings, how many were positive on held
- of the 199 `survivors`, how many were positive on held

Beside it, the same two counts against the best of the four comparisons rather
than against zero, since Part 2 makes that the bar that matters.

If the two shares are close, the picking added nothing. If the `survivors` pull
clearly ahead, that is the first direct evidence that the choosing does
something.

## What gets ADDED to Verify

**Controls.** One press. A box for how many of the non-kept settings to read,
with all of them as a legal value, since reading them is cheap.

**Results.** Two rows, kept and not kept, each with the count of settings, how
many were positive on held, how many beat the best of the four, and the average.
Under them one line saying how far apart the two rows are.

## What gets REMOVED

Nothing.

## What it needs from the other parts

Part 2, for the "beat the best of the four" column to mean anything. And it runs
into Part 5's unresolved question — whether a result this damning should refuse
the set rather than merely print. Build it printing. Decide gating when Part 5's
blocker is answered.

## What I am assuming

- **That every setting has its held figures stored, not just the `survivors`.**
  The stage 3 pricing computes held money and all four comparisons per setting,
  so this should hold. Whether all 2,752 of this set's settings actually carry
  them is a read of the record set away and should be checked before building.
- **That reading them is affordable.** It is a read of stored rows, no pricing,
  so it should be fast. Unmeasured on a set this size.
- **That comparing two averages is the right reading.** Where the `survivors`
  sit inside the whole spread may say more than the gap between two averages. I
  would show both.

## The risk, and it is real

This is a read of the held-back stretch, so it must sit behind a counted press
like everything else that touches it. It cannot change a choosing that has
already happened. It can change the NEXT one, if the answer sends you back to
walk the **Funnel** again knowing it. No screen can prevent that, and it is the
owner's to weigh.

---

# Part 8 — judge the thing you would trade, not the average of everything kept

> **Owner, 2026-09-11, on reading a FAIL:** "when 18 actual settings selections
> within a rule pass ALL 5 and then you mark it FAIL?!? — get real! we need to
> keep that code and make the pass/fail rational."
>
> **THIS IS DONE BEFORE PART 1 IS FINISHED**, because Part 1 carries the same
> fault in its own scoring, and because it changes a number that is on the
> owner's screen today.

## The problem

**The verdict decides PASS or FAIL on the average of every setting the rule
kept.** Two lines of `lib/funnelverify.js` do it:

```
const real = mean(...)                              // the mean over ALL survivors
pass: comparisons.known && positive && comparisons.beatsBest === true
```

On the owner's own set, read 2026-09-11: **98 of 98 survivors made money on the
held stretch, 18 of 98 beat all four comparisons — and the set reads FAIL**,
because the average of the 98 does not clear.

Two faults, stacked:

**One: it judges a basket nobody will ever hold.** A figure averaged across 98
settings describes buying all 98 at once in equal size. Nobody is going to do
that. One setting goes live, or a named handful does. Part 6 already says this
in as many words — "the thing judged is not the thing traded" — and nobody
connected it to the gate that prints FAIL.

**Two: the bar is picked after the fact.** `beatsBest` is the maximum of the
four comparisons. Knowing in advance which of being long every period, being
short every period, buying the coin and going away or shorting it and going
away is the one to be on IS a forecast, and the hardest one. Beating each of
the four on its own is a claim somebody could have made beforehand; beating the
best of them is not. (Owner's correction, 2026-09-11: "there were 4 'no
forecast' set-ups ... picking the right one in advance IS a forecast".)

**And Part 1 repeats the first fault.** Its own results line says "cleared on
how many of the passes", which is a sentence about the set rather than about
anything tradeable. "The set cleared 4 of 5" means nothing. "18 settings cleared
all 3 passes, here they are" means something.

## The change

1. **Count per setting, never the average.** How many survivors made money, how
   many beat each of the four, how many beat all four — with the settings that
   did so named, not just counted.
2. **The gate is about a tradeable thing.** A set passes when at least one
   survivor clears every bar on its own, and the screen says which. Whether a
   named setting or a named group is the claim is Part 6's business; until Part
   6 exists, "at least one clears everything, and here it is" is the honest
   version and it is a far better gate than the average.
3. **The average stays on the screen, labelled as what it is** — what holding
   every survivor in equal size would have made. It is a real number for a
   question somebody might ask; it is not the verdict.
4. **The four are reported separately, and the best-of-four is marked as the
   hindsight reading it is.** Both are worth printing. Only one of them is a
   bar a person could have aimed at.
5. **Part 1's five-pass block follows the same rule**: a row per pass, and the
   summary counts SETTINGS that cleared every pass, never passes that the set
   cleared. **Part 1 applies this itself and does not wait for the rest of
   Part 8** — the rule costs nothing to obey when the block is written for the
   first time.

## What gets REMOVED

Nothing. The one-off reading of the held stretch stays exactly as it is — it is
the one reading on the real held stretch, it is what History's reserve grade is
keyed to, and the owner has said plainly to keep it. What changes is the
sentence the verdict draws from it.

## What it needs from the other parts

Part 6 would say WHICH setting or group is claimed, which is the fully honest
version of point 2. This part does not wait for it: "at least one survivor
clears everything on its own" is already a stricter and more meaningful gate
than the average, and it can ship first.

## What I am assuming

- **That at least one clearing survivor is the right default gate.** It is the
  weakest honest claim, and on a set of a hundred it will pass often. It is an
  improvement on the average because it is about something real, not because it
  is harder. If the owner wants a harder one — a minimum count, or a share — it
  is a number they set, and under Part 6 it should be set before the counts are
  visible.
- **That naming the clearing settings does not become a shopping list.** It
  might. A list of the settings that cleared, read after the held stretch is
  open, is the held stretch being shopped — which the screen already warns
  about for its own table. The same warning belongs here.

## What it costs

**Small, and smaller than it looks.** Every number this needs is already worked
out per setting: V4 already reads every survivor against its own copies and is
already information-only, and the four comparisons are already stored per hold
length. Nothing new is measured. What changes is which numbers the verdict
sentence is built from — reporting, not arithmetic.

---

# Where the effort goes

| Part | Machine cost | Build cost | Blocked on |
|---|---|---|---|
| 1 — several stretches, on Verify | medium | medium | timing one retrain of one unit |
| 2 — best of all four | none | small | **BUILT 3.100.0 / 3.101.0** |
| 3 — out of reach while choosing | none | high | owner's call on losing the `floor` and sorter |
| 4 — rule out a bad way of choosing (on the **Funnel**, not Verify) | low | small | **BUILT 3.102.0** |
| 5 — bar for the whole search | none | small | is the luck figure fit for this at all |
| 6 — claim written first | none | medium | making a look an event |
| 7 — what the thrown-away settings did | none | small | **BUILT 3.100.0** |
| 8 — judge the thing you would trade | none | small | nothing |

**Parts 2, 4 and 7 are BUILT and on the box.** Part 2 shipped as 3.100.0, with
the table that replaced its prose line in 3.101.0. Part 7 shipped as 3.100.0.
Part 4 shipped as 3.102.0.

**Part 4 needed no scoring pass in the end.** The money each setting made within
the test window IS kept, in three parts, in the numbers stored beside a stage 3
set — the earlier note here, that `lib/stagework.js` projects the block away
before it is written, was about the stage 3 RECORD and not about those numbers.
What was true is that those numbers only ever covered the settings a rule
happened to keep. `work out the missing numbers` now runs for the whole record
set, once, before the walk begins.

**Part 1 is being built now, and it does not wait on Part 8.** The timing
question was withdrawn as a blocker by the owner ("i don't care about timing
retraining for the Part 1 as some kind of blocker"), and the engine is done
(§1.0b, §1.0c). Part 8's rule simply applies to Part 1's own summary from the
start: it counts SETTINGS that cleared every pass and names them, never passes
that a set cleared. A session that turned that into a dependency invented one.

**Everything else needs an answer first**, and the answers are cheap: time one
pass of stage 1, decide whether the held-back column can leave the choosing
screens, check whether the luck figure means what Part 5 needs, and decide
whether a look is an event.

I have deliberately not repeated the first draft's ranking of what to build
first. That ranking was made while three of the six costs were wrong.

# What is not in here

- How the forecasts are trained. Separate design.
- A bar for claiming "the best of these two hundred, chosen afterwards", which
  is how the system is actually used today. Part 6 does not cover it and I have
  not designed it.
- What to do with the record sets already on the box. Re-running, rewriting into
  a new shape, or deleting is the owner's call and depends on which parts get
  built.
