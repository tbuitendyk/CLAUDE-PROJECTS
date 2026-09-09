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

Two words are deliberately **not** used in this document, because each already
means something else on a screen: `walk`, which on the **Funnel** is the run
through its steps, and `noise`, which on **Verify** and **History** means the
scrambled copies specifically.

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

# Part 1 — judge on several stretches, not one

> **Blocker.** This part cannot be planned until two numbers are known: how
> long one full pass of stage 1 takes on the box, and the shortest stretch that
> still holds enough trades to mean anything. Everything below is shaped by
> those two numbers and I do not have either.

## The problem

A single held-back stretch is one roll of the dice. Whatever that stretch
happened to do dominates the answer, and nothing separates a setting that works
from a setting that suited that stretch. No amount of care in measuring one roll
turns it into two. And once it is opened it is spent — a second look at the same
stretch is not a second roll.

## The change

Cut the history into several judging stretches, one after another. Then move
the training boundary forward, one stretch at a time:

1. Train on everything before the first judging stretch. Score on that stretch.
2. Move the boundary forward so the first judging stretch is now part of the
   training. Train again. Score on the second.
3. Keep going. The reserve stays `sealed` at the end, untouched.

Nothing is ever scored on periods it trained on, and nothing looks backwards.

What comes out is a record: cleared the bar on five stretches of six, with the
margin on each. That is something you can argue with.

## What it needs from the other parts

Part 2, because a record of clearing a soft bar is a record of nothing. And it
raises a question Part 6 has to answer: **is each judging stretch a counted
look?** If it is, one pass of this spends six looks instead of one, and the
whole idea of a look needs rethinking. I do not have an answer to that and it
should be settled before anything is built.

## What I am assuming

- **That the same six dials being claimed is the same claim on every stretch.**
  It is not obviously so. Each pass retrains, so the forecasts behind a setting
  on the fifth stretch are not the forecasts behind it on the first. "Cleared
  it five times" is a claim about the dials, not about a trained thing. That may
  be exactly what you want, since the dials are what you would carry forward,
  but it should be said out loud rather than assumed.
- **That the held-back read today is really one roll.** It is an average across
  many coins on one calendar stretch. If the coins move together, it is one
  roll. If they do not, there are cheap extra rolls already sitting in the data
  and this part is less necessary than I have made it sound. Nobody has checked
  which.
- **That equal-length stretches are the right cut.** Six stretches out of the
  same history means each is a sixth the size, and six noisy answers are not
  better than one solid one.

## What it costs

The expensive part of this document, and more expensive than the first draft
said. Per judging stretch you pay: the training, the re-scoring of every
setting, **and** the scrambled copies, which are a full pricing run each. All
three multiplied by the number of stretches. The first draft said "the training
work multiplied", which left out two thirds of it.

---

# Part 2 — make the bar the best of all four comparisons

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

## What it costs

Small. All four figures are already computed and stored. This is a change to
which number decides pass or fail, and which is only shown.

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

Nothing, but Part 5's refusal depends on this being done first, because a
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
answer on **Verify** beside the count of survivors.

## What it needs from the other parts

Nothing. It is the only part that stands completely alone.

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
than a number worked out afterwards, is the real work. Attaching a claim to it
after that is easy.

---

# Where the effort goes

| Part | Machine cost | Build cost | Blocked on |
|---|---|---|---|
| 1 — several stretches | high | medium | timing one pass; shortest usable stretch |
| 2 — best of all four | none | small | nothing |
| 3 — out of reach while choosing | none | high | owner's call on losing the `floor` and sorter |
| 4 — rule out a bad way of choosing | low | small | nothing |
| 5 — bar for the whole search | none | small | is the luck figure fit for this at all |
| 6 — claim written first | none | medium | making a look an event |

**Two are unblocked today: 2 and 4.** Part 2 is a change to which number decides
pass or fail and costs nothing to run. Part 4 is a scoring pass and one new
reading on **Verify**. Neither needs a decision from anyone but the owner about
whether to do it.

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
