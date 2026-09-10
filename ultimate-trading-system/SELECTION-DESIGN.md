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

---

# Part 1 — judge on several stretches, not one, on Verify

> **Reshaped 2026-09-09 by the owner, and the reshaping is the good part.** My
> version re-ran the whole sweep five times and I said the cost was the thing
> most likely to sink it. The owner's version runs on the ONE `unit` the
> **Funnel** already narrowed to — one coin, its companions and one shape. That
> is a fraction of a full stage 1 sweep, which trains every combination in the
> universe. The blocker I put here has largely gone with it.

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
covers many units — the **Funnel** offers `read the other units`, and **Verify**
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

# Where the effort goes

| Part | Machine cost | Build cost | Blocked on |
|---|---|---|---|
| 1 — several stretches, on Verify | medium | medium | timing one retrain of one unit |
| 2 — best of all four | none | small | **BUILT 3.100.0 / 3.101.0** |
| 3 — out of reach while choosing | none | high | owner's call on losing the `floor` and sorter |
| 4 — rule out a bad way of choosing (on the **Funnel**, not Verify) | low | small | nothing |
| 5 — bar for the whole search | none | small | is the luck figure fit for this at all |
| 6 — claim written first | none | medium | making a look an event |
| 7 — what the thrown-away settings did | none | small | **BUILT 3.100.0** |

**Parts 2 and 7 are BUILT and on the box.** Part 2 shipped as 3.100.0, with the
table that replaced its prose line in 3.101.0. Part 7 shipped as 3.100.0.

**Part 4 is the one unblocked part still to build.** It is a scoring pass and
one new reading at the head of the **Funnel** walk, and it needs no decision
from anyone but the owner about whether to do it. One thing found while building
the other two, which its cost line already allowed for: the per-setting money
WITHIN the test stretch is not on disk. `lib/stagework.js` computes it by thirds
and says in its own comment that the block is projected away before it is
written, so this needs a rebuild pass over every setting of every unit rather
than a read.

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
