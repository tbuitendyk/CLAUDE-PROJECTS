# Coins — a picture of each coin's history, for choosing how to train on it

**Redesigned by the owner on 2026-09-13.** This document is in two parts.
**Part one is the design now.** Part two is the design of 2026-09-12, which
filled this document until today; it is superseded, kept below for the record,
and is not to be built from.

**What is built and what is not.** Part one sections 1 to 4 are built in
3.124.0 (owner `LOOP NOW!`, 2026-09-13; the record is
`LOOP-2026-09-13-COINS.md`). Section 5, Sweep's dual member voting mode, is
NOT built and is parked there with the reason. Everything Part two describes
was built, was on the box as of 3.123.0, and is deleted in 3.124.0.

Three kinds of thing are in Part one and they are kept apart on purpose:

- **The owner's design** — sections 1 to 6. Recorded as given, in their words
  where they gave them (2026-09-13).
- **What I recommend** — marked as mine wherever it appears. Recording is not
  agreeing, and none of it is decided until the owner says so.
- **Findings read out of the code** — section 8. Read out of the named file in
  the session that wrote this. Findings, not decisions.

**Where this sits.** `TREND-TRAINING-DESIGN.md` (2026-09-09) is the design for
sorting history into rising and falling stretches and training two sets of
`members` on them. Part one replaces the "stretches" half of that: nothing is a
stretch any more, and section 6 says exactly which of its decisions this
reverses. How the two sets are trained still belongs to that document and to
**Sweep**, and Part one crosses into it only as far as section 5.

---

# Part one — the design (owner, 2026-09-13)

## The words

Every name below is either quoted from the code that draws a screen, in the
session that wrote this, or is plainly marked as having no screen name yet.

| Word here | Where it comes from |
|---|---|
| `coin` | On **Coins** and every other screen. |
| `coins (blank = all N downloaded)` | The box on **Coins** today (`drawCoins()` in `public/construct.js`). N is the live count of coins downloaded on the box; the owner said "eighteen" and the screen says whatever the number is that day. |
| `Read these coins` | The button on **Coins** today. |
| `chunk shape` | On **Sweep**. Five choices, quoted from the **Sweep** list: `Daily 1-day`, `Daily 2-day`, `Daily 3-day`, `Daily 4-day`, `Weekly 8-day`. |
| `window layout` | On **Sweep**. Two choices: `61/13/13/13 (sealed exam)` and `70/15/15`. |
| train, test, held, reserve | The parts a coin's history divides into. The owner's four words, used exactly as they are (RULE ONE-D). |
| `decision`, `decisions` | One moment a setup could open a trade: one chunk. Read from `lib/dataset.js`: on the four daily shapes, one a day, the trade opening at 01:00; on `Weekly 8-day`, one a week, opening Tuesday 03:00. The owner's word, and printed on **Coins** since 3.124.0 (`SCREEN-WORDS.md`, the **Coins** list). |
| window | The run of hourly candles a decision reads before its trade opens: 24, 48, 72, 96 or 192 hours by `chunk shape` (`featureHours` in `lib/dataset.js`). The owner's phrase is "analysis window". **No screen name.** |
| window move | How far price moved from the first candle of a decision's window to the price its trade opens at, as a percentage of the first. On **Coins** since 3.124.0, in the band's label and in `window moves from`. |
| `rising`, `falling`, `sit out` | The three things a decision can read as. All three printed on **Coins** since 3.124.0, with their colours `green`, `red` and `black` beside them. |
| `sit-out band, % of the median window move` | The one number that decides sit out. The control on **Coins** since 3.124.0, quoted from the word list generated from the deployed screen. |
| dual member voting, traditional single member set voting | The owner's names for the two training modes on **Sweep**. Printed on **Coins** since 3.124.0 in the sentence that says what the screen is for; the box on **Sweep** that switches them is not built (section 5, parked). |
| `member`, `members`, `committee` | On **Sweep** and **Boards**. One forecast, the group of them, and the whole group that votes on one coin. |
| weight ceiling | Was on **Coins** until 3.124.0; gone with the old design. Returns on **Sweep** with the dual member voting mode (section 5). |

## 1. What Coins is for

The owner, 2026-09-13: *"the screen basically becomes a visual analysis of the
variability of the coins and consistency to give us an idea about the aptness
for dual member voting as opposed to the traditional single member set voting."*

It is a picture, per coin, of what the reading **Sweep** will train on says
across the coin's whole cached history, drawn before any sweep is spent. It
decides nothing. Nothing on it refuses a coin — the 2026-09-12 ruling stands:
*"We're not even blocking coins with this anyways. We're only reporting."*

**What it is NOT for any more.** It does not find stretches, it does not tune a
percentage, it does not store anything against a coin, and it has nothing to do
with trade length. The owner, 2026-09-13: *"As far as I can see, there's no
reason to work out the stretches by trade length. The whole point of this
exercise is to determine to characterize the nature of the historic data that
is being used to train the models."*

## 2. The reading: one decision at a time, from what that decision can see

**The point, in the owner's words.** *"The idea is to categorize the history
into rising and falling sections so that for any given decision in the
training, the section can be identified to sit out for rising trained models
when the trend is down or sit out for down trained models when the trend is up.
That's the point. and then to associate with those pieces of up and down
trending history, the strength of the trend, relatively speaking, to be able to
put a waiting [weighting] on the training. That's all we're doing here."*

**Where the reading is taken.** *"It would be rather how much price has moved
from the start of this examination period for the trade window in question. So,
for example, on a four day chunk, there's going to be four in play potentially
simultaneously at all times, and the start of the history characterization for
each chunk is the start of that chunks analysis window. So the data is
available in real time before the trade for training."*

So, for every decision, on its own:

- **The window move** is the price change from the first candle of the
  decision's window to the price its trade opens at. Nothing after the open is
  read. On `Daily 4-day` that is four days of price; on `Weekly 8-day`, eight.
- **Rising** if the window move is up by more than the sit-out band. **Falling**
  if down by more than it. **Sit out** otherwise.
- **The strength** is the size of the window move, relative to the coin
  (section 3).
- **Every decision is read alone.** Neighbouring decisions overlap in what they
  read — on a four-day shape four windows are open at once — and each is read
  on its own window regardless.
- **It is known live.** The same reading, from the same candles, at the moment
  a real trade would open. That is what lets a set of `members` sit out at
  trade time, which the old design could not do.

**Nothing is stored and nothing is added to a chunk.** The owner: *"it does not
need a new field. We have all the hourly candles and each unit being trained is
going to know when the training starts for the next iteration."* Each unit
being trained has its window's start time and the hourly candles, and works the
window move out on the spot. **Coins** does the same when it draws.

**Trade length does not enter.** The window belongs to the `chunk shape`; how
long the trade is then held changes nothing about what the decision saw before
it opened.

## 3. The sit-out band: one number, every coin on its own scale

The owner: *"we probably also wanna have a way to tune the sit out band, and
that is something that probably should have one number that gets applied to all
of the coins, but relative to that, each coin's variability. In other words, a
five percent number, for example, might mean one thing on Bitcoin might mean
something else on Doge, depending on the range of typical up and down
movement."*

- **One number, typed once.** It has one home. **Coins** draws with it and
  **Sweep** trains with the same one, so the picture and the training can never
  disagree. (The same principle the owner set on 2026-09-13 for the sealed
  share: *"just do it once in one place, like good code design."*)
- **Applied per coin, per `chunk shape`, against that coin's typical window
  move.** The number is a share of the coin's own scale, not a percentage of
  price.

**The yardstick — MY RECOMMENDATION, not decided.** The owner said *"as a
percentage or median however you think is best to handle that against the
history data"*. My answer: the yardstick is the **median** of the coin's window
moves over its whole cached history for that `chunk shape`, ignoring direction.
Median rather than mean because a few wild days do not move it. The band is
then a share of that median: a setting of 50 means a decision sits out when its
window moved less than half what this coin typically moves over that window.
The median itself is worth printing beside each bar, so the setting can be read
against the number it is applied to. **This is mine until the owner says
otherwise.**

**It is NOT the band that already exists in the code.** `balancedBandPct` in
`lib/dataset.js` is a band on the trade's OUTCOME — the move from open to close
— and it makes the row's label "nothing". The sit-out band is on the WINDOW,
before the open. Two different bands on two different stretches of time. They
must not be merged and neither replaces the other.

## 4. The screen

**Three controls, and nothing else.** The owner: *"we're gonna be looking for
probably three controls on the coins tab."*

1. `coins (blank = all N downloaded)` — kept exactly as it is. Blank reads every
   coin downloaded on the box, whatever that count is on the day.
2. **`sit-out band, % of the median window move`** — one number, section 3. Built 3.124.0; the label is quoted from the word list generated from the deployed screen.
3. `Read these coins` — kept exactly as it is. *"which could be just one or the
   whole batch, whatever whatever is in the box."*

No ordering control, no `window layout` control, no `chunk shape` control: every
shape and both layouts are always drawn.

**Per coin, five bars, one per `chunk shape`.** The owner: *"one record per
shape"*, and *"five colored bars that just give us the decisions that would be
made across the entire history depicted with probably red, green, and black for
sit out."*

- Each bar is the coin's whole cached history, left to right.
- **One coloured unit is one decision**: green for rising, red for falling,
  black for sit out. On each daily shape that is seven decisions a week; on
  `Weekly 8-day`, one. So the bar lines up one for one with the rows training
  will see. The owner: *"that could be lined up to the actual trading decisions
  that'll be made under the training as well."*
- **Above each bar**, division lines marking `70/15/15`: train, test, held.
- **Below each bar**, shaded bars marking `61/13/13/13 (sealed exam)`: train,
  test, held, reserve. The owner: *"seventy fifteen fifteen on top and even
  just shaded bars underneath each colored bar that show the sixty one,
  thirteen, thirteen, thirteen layout, sealed exam layout."*

**Beside each bar, the numbers.** The owner: *"statistics on the number of
changes and the ranges."*

- Per part of the history, under each layout: how many decisions read rising,
  how many falling, how many sit out.
- How many times the colour changes along the bar.
- The range of the window moves: the largest rise and the largest fall.
- (Mine, section 3:) the median the band is read against.

**Why five bars and not three.** The owner first said three records — one and
two day, three and four day, eight day — counting the three trade lengths,
which is fifteen starts a week. The correction to five came after this finding:
`Daily 1-day` and `Daily 2-day` open their trades at the same moments but read
different windows, 24 hours against 48, so the same moment reads differently
under each. Same for three and four day. One bar per shape.

**Built, 3.124.0** (`LOOP-2026-09-13-COINS.md`): the bars are painted on a
light track so black reads on the dark theme; the band's default is 50; one
line under each coin's name says when it was read, by which release, from how
many candles, and how many months have been cached since; the band box stays
live while a reading runs because it is not part of one. The band control is
labelled `sit-out band, % of the median window move`, quoted from the word
list regenerated from the deployed screen (RULE ONE-A, 3.124.0 served).

**The gap, and the two marks on every box (owner, 2026-09-13, built 3.125.0).**
The owner, after seeing 3.124.0: *"i like it ... let's shade the TEST header
on the 70/15/15 window and let's put the start yyyy-mm-dd on each section"*,
then, asked what would be a good general metric for aptness to dual member
voting, *"GO NOW! and add the gap metric too w/ deploy"*.

- The `test` box in the `70/15/15` strip above each bar is shaded. Every box,
  above and below, says the day its part starts, read off the first decision
  in it.
- **The gap** is how differently a trade turns out after a rising window than
  after a falling one. Of the decisions whose window read rising, the share
  whose trade then went up, against the same share after a falling window,
  and the difference in points; and the average move from open to close after
  each kind of window, and that difference. Rising minus falling, both ways.
  Sit-out decisions are in neither side. The window ends where the trade
  opens, so nothing leaks between them. A gap near zero means the two sets of
  `members` would learn the same lesson twice; a wide one means the split has
  something to learn from.
- **Beside it, what qualifies it.** The thin side: the smaller of rising and
  falling, because a gap built on forty decisions is not a gap. The run:
  decisions per colour change, because a reading that flips every day is not
  a regime. Neither is a cut-off.
- **Per part.** Under each bar, one table: the whole bar, then every part
  under each layout, each row with the day it starts, the three counts, the
  thin side, the changes, the run, and the gap both ways. A gap that is there
  in train and gone in held is the case that has burned us before.
- **What it needs on the record**: the trade's own outcome beside every
  decision — the chunk's own move from open to close, the number the label is
  made from. Record shape 7. A shape-6 file is named and read again.
- **What it cannot tell**: how much the features gain from the split; only
  training shows that. And neighbouring windows overlap, so the gap is
  noisier than the counts suggest.

**Nothing old is left lying around (owner order, 2026-09-13, built 3.126.0).**
The owner, on seeing a file from record shape 3 named on the screen after a
re-read: *"either (a) the code should never leave old data lying around or
(b) there has to be a cleanup mechanism that the user can reach ... fix that
however it should be."* Both:

- **(a)** Reading a coin replaces every older file for that coin — by its
  name, or by the coin its contents say — as the new record lands. The
  finished line says how many were replaced.
- **(b)** While there is a file this release cannot draw, a control sits
  beside the note that names it and removes exactly those files, found again
  on the box at the moment of the press, never taken from the page. A record
  this release can draw is never touched, and it refuses while a read is
  running. It is labelled `Remove these files`, quoted from the word list
  regenerated from the deployed screen.

**And the table's headings are markup the word list can see.** 3.125.0 built
them from a list inside a template, so fifteen words were on the owner's
screen and on no list — the hole RULE ONE-A names. 3.126.0 wrote them out as
quoted strings and the list still could not see them; 3.126.1 writes them as
one template literal, and the list regenerated from the served screen carries
all fifteen: `part`, `starts`, `decisions`, `rising`, `falling`, `sit out`,
`thin side`, `changes`, `run`, `up after rising`, `up after falling`,
`gap (points)`, `move after rising`, `move after falling`, `gap (move)`, and
the row `whole`.

**Everything else on the tab today goes.** The walk, `fall-back %`, `changes of
direction`, `changes of direction wanted`, `try from, %`, `try to, %`,
`step, %`, `drift parts`, `shuffles`, `most one-sided stretch`, `drift`,
`cannot tell`, `window layout`, `order by`, the `trade length` rows, the
`read over` column, the per-part stretch counts under each row, the training
weight summary, and the record written to disk per coin. All of it belongs to
the design in Part two. What `weight ceiling` becomes is in section 5.

## 5. What Sweep does with it

This is the boundary, not the whole. How two sets of `members` are trained
stays with `TREND-TRAINING-DESIGN.md` and **Sweep**; what follows is only what
the reading above hands over.

**Two training modes.** The owner: *"So we have the traditional training mode,
which just trains one set of members to try to detect up and down both
together. And then we have another one that is a more advanced training mode
where we just check a box, and that box means characterize this particular
decision that is under the microscope right now as being trending up, trending
down, and perhaps with a band of sit out as well. And then training specific
models for that characterization."*

- **Off** — traditional single member set voting. What runs today: one set of
  `members`, trained on every row, voting everywhere. Unchanged.
- **On** — dual member voting. One box on **Sweep**, no name yet. With it on:
  - every row is read as in section 2, from its own window, with the one
    sit-out band of section 3;
  - **two sets of `members`.** The rising set's target is the row's label where
    the decision reads rising, and "no call" where it reads falling or sit out.
    The falling set is the mirror;
  - **the weight** of a row is its window move's strength, brought to an average
    of 1 under the `weight ceiling`, which moves from **Coins** to **Sweep**
    with it;
  - **voting:** the set matching the decision's reading votes; the other sits
    out; in the band, neither.
- **Live** is the same reading at the open, from the same candles. Nothing has
  to be detected by a model; the reading is arithmetic on the window.

**Cost, unmeasured, as before.** Two sets is twice the stage 1 training, and
stage 3 grows worse than twice because the count of `members` sets how many
rungs the agreement dial offers.

## 6. What this reverses, and what stands

**Reversed by the owner, 2026-09-13.** Each of these was the owner's own
decision on 2026-09-12, and each is now the other way:

- **"Nothing reads the type at trade time."** Something does now. That rule was
  safe to make because the old type LOOKED FORWARD — a stretch was typed by
  where price went next — so reading it live would have leaked. The new reading
  looks only back, at the window, so reading it live leaks nothing. The reason
  for the rule is gone with the rule.
- **"No third bucket; flatness is a weight, not a label."** There is a third
  reading now: sit out. Flat was rejected because *"the typing has hindsight
  and a `member` does not"*. The new reading has no hindsight, so the objection
  that killed it does not apply.
- **The stretches.** The fall-back walk, the percentage solved per coin, the
  count of changes wanted, the search over a range, cutting stretches at every
  boundary, stubs and the median stub rule, turns counted directly. All gone:
  nothing is a stretch any more. Each decision is read alone.
- **The training weight from the trade's own outcome** becomes the weight from
  the window move. Still one number per row, still average 1 under a ceiling,
  still one vector shared by both sets.
- **A record per coin on disk, per hold** becomes a record per coin holding
  the window moves per `chunk shape` — facts about the history, and what a
  read costs. The band is NOT on it: it is applied when the screen draws, so
  tuning it recolours every bar at once and reads no candle again. (Built
  3.124.0; this line said "nothing on disk" until the build showed why a
  reading is worth keeping. `LOOP-2026-09-13-COINS.md` section B.)
- **Reading per trade length** is gone from this tab entirely.
- **The three readings per coin, the two traditional numbers, the shuffles and
  the can-tell mark** are gone.

**Standing, untouched by this redesign:**

- This tab REPORTS and never refuses. No cut-offs anywhere on it.
- The word is `coin`, not `pair`.
- The train and test boundaries are fixed; nothing on this tab moves them.
- The budget rule does not apply to this tab; it reads all of the history.
- Sweep's coin list comes out of Coins rather than being typed in — the owner
  has not said otherwise, so it stands.
- The starting anchors stay where the engine pins them.
- A blank coin box means every coin downloaded on the box.

## 7. Not decided, and whose call it is

- **The yardstick for the sit-out band** (section 3). Mine is the median of the
  coin's window moves for that shape. The owner's call.
- **The name of the box on **Sweep****. The band control is named (section 4,
  3.124.0). The Sweep box is named when built, deployed, and the word list
  regenerated from what the box serves (RULE ONE-A).
- **Where on the screen the numbers sit** relative to the bars. Presentation
  only.
- **Whether the bars should also show strength**, a deeper shade for a bigger
  window move. Not asked for; not proposed; recorded so nobody adds it
  unasked.
- **Every cost.** Not one has been measured.

## 8. Findings read out of the code, 2026-09-13

Every one read out of the named file in the session that wrote this. Findings,
not decisions.

1. **The chunk builder already holds everything the reading needs.**
   `buildChunks` in `lib/dataset.js` takes the run of hourly candles from the
   window's start over `featureHours`, and stores the trade's opening price on
   the chunk as `c1`. The move between the first of those candles and `c1` is
   not stored, and per the owner it does not need to be: whoever has the
   window's start time and the hourly map can work it out.
2. **The features never carry the whole-window move.** Rule 2 in
   `lib/features.js`: every window a feature reads is a quarter or a half of
   the chunk, never the whole. So nothing in training sees this number today,
   and it is not a leak to add the reading: it uses only what the row already
   could see.
3. **The weight arithmetic can be reused as written.** `trainingWeights` in
   `lib/coins.js` takes any list of moves, brings the average to 1 under a
   ceiling by bisection, and says so when no ceiling can. Hand it window moves
   instead of trade outcomes and it does section 5's job. Whether it stays in
   that file is a build choice.
4. **There is already a band in the code and it is a different band.**
   `balancedBandPct` in `lib/dataset.js` is on the trade's outcome, after the
   close (section 3). Not the sit-out band.
5. **Five shapes, three holds.** `lib/dataset.js` lines 32–36: `Daily 1-day`
   and `Daily 2-day` both open at hour 25 and 49 past a daily start, 01:00 on
   the clock, but read 24 and 48 candles. `Daily 3-day` and `Daily 4-day` the
   same at 72 and 96. `Weekly 8-day` reads 192 and opens Tuesday 03:00. That is
   why section 4 has five bars.
6. **Everything section 4 deletes is live code today**, in `lib/coins.js`,
   `lib/coinsrun.js`, the `Coins` part of `public/construct.js`, its help
   entries in `public/help-content.js`, the `api/coins/*` routes in
   `server.js`, and the tests `tests/test-coins.js`, `tests/test-coinsrun.js`
   and `tests/ui-coins.js`. Deleting it is a change to `lib/` and `public/`
   and moves the release number (RULE ONE-C, second digit: a control goes and
   a control arrives). It waits for its own `GO NOW!`.

## 9. The signal reading under each bar (3.127.0–3.127.1; owner LOOP NOW! 2026-09-14)

The owner: *"build a scoring mechanism into the current code which basically
BY CODE determines what you stated ... 'aptness to coin history signal'"*,
then *"the analysis ... based on each shape within each coin"*, *"sit-out band
sweeps (one per coin and shape) that find the sweet spot for the signal,
focusing of course on middle-of-plateau not spikes"*, and *"We're not gonna
have a thousand controls on this screen."* The rules were written before any
number existed, in `LOOP-2026-09-14-SIGNAL.md` section A; the decisions taken
along the way are its section B; what the review of all 18 coins found is its
section C.

**Nothing on the screen changes shape.** The three controls stay as they are.
Under each bar's heading there is now one more line, and every word on it is
quoted below from `cSignalLine` in `public/construct.js`, read in the session
that wrote this. The word list for **Coins** is regenerated from the served
screen after the deploy, as RULE ONE-A requires; until then these are words
the code draws, not yet words on the list.

**The line, left to right.**

1. `signal` — the mark.
2. Either `edge N× chance at band B, S% called · plateau A–C, P bands, mean
   M×`, or the sentence `no band beats chance for three steps together`.
   `S% called` is how much of the history the sweet spot's band still calls:
   a band of 260 is an edge on the few decisions that moved that far, and the
   reader sees that beside the ratio.
   - *edge over chance*: on the first part of `70/15/15` (train), a trader
     who sees the colour learns which way to trade after a rising window and
     which way after a falling one; a trader who does not learns one way for
     everything. Both then trade every called decision of test and held. The
     edge is what the colour-seeing one keeps per called trade beyond the
     blind one. Chance is the usual size of that number when the colours
     carry nothing, widened where trades share hours (`Daily 3-day` and
     `Daily 4-day` hold 41 hours on a 24-hour step). `N× chance` is the one
     over the other.
   - *the band sweep*: the sit-out band is tried at every step of ten from 0
     to 300, on the same moves, without touching the band the box is set to.
   - *the plateau*: the widest run of three or more consecutive bands whose
     edge over chance, smoothed three bands wide, is at least 1. `band B` is
     the middle of that run — the sweet spot — never its peak. `P bands` is
     its width and `mean M×` its height.
3. The traits, one word each, read at the sweet spot (or at the box's band
   when there is no plateau):
   - `reverting` or `trending` — on train, whether a rise is more often
     followed by a fall (gap in points below zero) or by another rise.
   - `steady`, `fading` or `mixed` — over the parts in time order under both
     layouts, whether every part's gap points the same way as train's, or
     only the last parts disagree, or the disagreement is scattered.
   - `often`, `much` or `both` — what carries it: the gap in points holds
     across the parts (how often), the gap in move holds (how much), or both.
     Nothing when neither holds.
4. `· at band X: ...` — the same reading at the band the box is set to:
   `N× chance`, or `the colour changes no call` (both learned leans are the
   blind one, so seeing the colour changes nothing and the edge is exactly
   0), or `no ratio` (a lean could not be learned: train holds one colour
   only, or nothing is called at this band). Then `N% called`.
5. `· with the link cut, one at least this strong in F of 50` — the
   instrument's own check. When the coin is read, the outcomes of each part
   are dealt into a different order fifty times while the readings stay, so
   nothing links a window to its outcome, and the whole analysis is run on
   each deal. A plateau's strength is its width times its height. F is how
   many of the fifty deals produced a plateau at least as strong as the real
   one; 0 of 50 is as good as the check gets, 12 of 50 means a plateau like
   this turns up by itself about one time in four. When there is no real
   plateau the line says `a plateau in F of 50` instead: how often the
   instrument names one on this shape when there is nothing to find.
6. The sweep as one bar per band, in the grid's order: height is the smoothed
   edge over chance, the plateau's bands are marked and its middle stands
   out. Hovering a bar names its band and reading.

**What the owner does.** Every reading on the box was taken under record
shape 7. This release reads shape 8 (the check in item 5 lives on the
record), so each coin reads as written under an older shape until
`Read these coins` is pressed again. One press, blank box, reads all of them;
the check costs fifty analyses per shape and adds about a second a coin.

**What it does not do.** It refuses no coin and types no cut-off: the only bar
anywhere is 1, chance's own size. It does not touch Sweep, the members, or
any training. It reads the history and reports; whether a coin and shape are
worth training on is still the owner's call, made with these numbers in
front of them.

**Where the words in item 3 may go next** (owner, 2026-09-13): *"if there are
specific traits that differentiate you will make ONE WORD notations ... that
may feed forward into member voting setups."* They are served per shape on
the records reply and drawn as marks; nothing reads them yet.

---

# Part two — the design of 2026-09-12, SUPERSEDED on 2026-09-13

**Everything from here to the end of the file is the design that Part one
replaced.** It is kept because it was built, it is on the box as of 3.123.0,
and the decisions in it that still stand are listed in Part one section 6. Do
not build from it. Where it says "this tab" it means the tab as it was, and
where it says a thing is "the whole point" it means it was.

## Read this first: there are almost no screen words yet

**Coins** today carries exactly one control label — `Coins`, the tab itself —
and nine printed sentences. That is the whole of its vocabulary
(`SCREEN-WORDS.md`, the **Coins** list). So almost everything below is
described by what it DOES, not by what it will be called, and where a name is
needed this document says plainly that there is no name for it yet.

| Word here | Where it comes from |
|---|---|
| `rising`, `falling` | On the **Coins** screen today, in the sentences it prints. The owner's words for the same thing are **up action** and **down action**. They are the same thing, and this document says `rising` and `falling` because that is what the screen says. |
| **type** | Rising overall, or falling overall. The owner's word for it in conversation. **There is no name for this on any screen**, because nothing on any screen does it yet. |
| `window layout` | On **Sweep**. Its two choices are `61/13/13/13 (sealed exam)` and `70/15/15`, quoted from the **Sweep** list. |
| `train`, `test`, `held`, `reserve` | The four parts a coin's history divides into. The owner's four words, used exactly as they are (RULE ONE-D). |
| period | **One trade the history could have offered**: a price a position would open at, and how far price moved by the time it closed. Not a calendar slot. On **Coins** the column is `periods` and each row says its `trade length` beside it. |
| `trade length` | On **Coins**. How long a position stays open — 17, 41 or 60 hours — with the times one can start beside it. Every coin is read at all three. |
| stretch | A number of periods one after another, with no gaps. |
| `member`, `members` | One forecast, and the group of them. On **Sweep** and **Boards**. |
| the `committee` | The whole group of forecasts that vote on one coin. On **Sweep** and **Boards**. |

**Two things that have no name and are not given one here.** Every control this
tab will carry. And the way **Sweep** picks which coins a run covers — the
**Sweep** word list names `singles`, `doubles` and `triples`, and nothing that
is plainly a coin picker. Where this document says Coins picks coins "the way
**Sweep** does", it means the same kind of choice, not a label anybody can
point at.

**The naming decision is made: the word is `coin`.** Owner, 2026-09-12: *"The
word is coins, not pair."* This tab says `coin`, the same as **Sweep**,
**Boards**, **Funnel**, **Verify** and **History**. **Data** was the one screen
still saying `pair` and it was changed to match in 3.114.1, so there is no
longer a neighbour to disagree with.

---

## 1. What Coins is for

**To vet, in advance, which shapes of history are good — meaning they hold a
mix of both `rising` and `falling` action.**

Two things come out of that, and they are the whole point of the tab:

1. **Better choices at Sweep.** You go into a sweep knowing which coins have
   history worth training on, instead of finding out afterwards. **The list of
   coins Sweep works from comes out of Coins rather than being typed in** — but
   Coins never decides that list on its own. It shows what each coin's history
   holds and the owner picks from it (section 8).
2. **The numbers a coin needs to be trained two ways** — how many `rising`
   stretches and how many `falling` stretches it has, where they fall, and how
   the time divides between them, recorded against that coin's history.

Coins sits between **Data** and **Sweep** because a record set built the second
way is a different thing from one built the first way. The vetting has to
happen before the sweep, not after it.

## 2. Why it exists: Sweep is going to run two ways

**Sweep** will offer a choice of how a coin's `members` are trained.

- **Two sets of `members`.** One set trained towards the `rising` stretches,
  which is silent on the `falling` ones. One set trained towards the `falling`
  stretches, which is silent on the `rising` ones. Each set votes only inside
  its own kind of action, so **roughly half the `committee` is silent at any
  moment**.
- **One set of `members`.** The way it works today: one set trained on all of a
  coin's history, voting everywhere.

**Every model still trains across the WHOLE history, not part of it.** Outside
its own type the right answer is "no call", and the model is trained on that
silence rather than trusted to produce it. This is the part that removes the
sample-size cost: no model sees less data than it would have, and silence
becomes something learned rather than assumed. So when this document says a
type needs "enough" stretches, it is not about how many rows a model gets — it
is about how many separate occasions it has to learn the difference from.

**Where it lands across the stages** (the owner's placement): stage 1 types
each period, filters the coins and masks the labels; stage 2 holds the
`committee` and the bar; stage 3 is affected too, because the number of
`members` sets how many rungs the agreement dial offers, and that list
multiplies against every other dial in the block.

**Cost.** Twice the `members` is twice the stage 1 training. Stage 3 grows worse
than twice, for the reason above. **Neither has been measured.**

**A note on one word.** In the budget rule, "judging" means a claim about what
will happen, spent once. That is not what `members` do. Throughout this
document `members` **vote**; nothing they do is called judging. The owner's
instruction, 2026-09-12: *"Don't use the word judging there if it's gonna
confuse things. Voting, training, something like that."*

## 3. How a stretch is typed — the algorithm

**Two types only: rising overall, and falling overall.** No third bucket. Every
stretch is one or the other, so nothing is left unclassified.

**How a turn is found: by how far price falls back.** Walk the price forward
and keep the highest point seen. When price has fallen back from that high by
**at least** a set percentage, mark the high as where the `rising` stretch ended
and the `falling` one began. Same rule the other way. Between two turns the
stretch is `rising` or `falling` by construction.

*This paragraph said "more than" until 2026-09-12. The code has always read "at
least", and at the exact boundary those are different rules. The wording was
corrected to the code rather than the code to the wording: changing the
comparison moves every number on the tab, and neither side of that boundary is
more defensible than the other.*

**Two alternatives were considered and rejected**, and the reasons are kept
here so nobody re-proposes them:

- **Price against its own average over the last N days** — rejected: it flips
  back and forth in a flat market and produces one-week trends that are noise.
- **The slope of a straight line fitted through a window of price** — rejected:
  it still flickers where the slope crosses zero.

The fall-back rule was preferred because it gives a start date and a stop date
rather than a per-period vote, cannot produce a one-day trend, and has one
setting with a plain meaning: **how far price has to fall back before you call
it a change of direction.**

**Four hard requirements on it:**

- **Worked out from returns, never from price levels**, so a 10% move counts
  the same at $50 and at $5,000. Otherwise a model can learn this price level
  and this volatility rather than what a falling market looks like — it would
  look perfect in training and fail on a future stretch of the same type at a
  different price.
- **Per coin, not one market-wide clock.** Two coins will disagree about the
  same week. That is wanted: a coin that fell while everything else rose is
  exactly the case the falling models should be learning from.
- **The boundaries snap to period boundaries**, so every period is wholly one
  type and never half of each.
- **The type is only ever used to build what the forecasts are trained
  towards.** Nothing reads it at trade time. That is what removes any need to
  work out the market type live, and it is why the typing is free to look
  forward across a whole stretch without leaking anything.

## 4. The fall-back percentage is solved per coin

**The percentage is not a setting fixed across coins.** What is set is roughly
**how many changes of direction are wanted**, and each coin gets whatever
percentage delivers that.

Why: a fixed percentage gives a calm coin two stretches and a wild coin forty,
and then the falling models on the calm coin have one era to memorise.
Targeting the count fixes the thing that matters for training — how many
separate stretches of each type exist — and it keeps every coin on its own
scale, which is consistent with typing each coin on its own history.

**Two things about the search, both of which shape the build:**

- **The count moves in whole steps**, so it can jump from six to nine with
  nothing between. **The rule, decided by the owner on 2026-09-12: take the
  LARGEST percentage that gives AT LEAST the number asked for.** Largest keeps
  the stretches clean — a smaller percentage would chop them finer than needed.
  At-least means the search never comes up short of what was asked. Where the
  count jumps straight past the target, the percentage on the near side of the
  jump is the one taken, and the count it actually delivered is reported
  alongside the one that was asked for, so a coin that overshot says so.
- **The count does NOT simply rise as the percentage falls.** An earlier turn
  moves where later ones land. So walk the percentage across a range and read
  the count off each one. That is cheap, and **the shape of that walk, per
  coin, is the visual this tab wants** — it shows you at a glance whether a
  coin's count is stable across a band of percentages or balanced on a knife
  edge.

**The percentage found per coin becomes a stored result**, because the type
labels depend on it and stage 1 needs those labels. It is tied to the price
data as it stood on the day it was worked out.

## 5. Cutting stretches at the boundaries, and counting what is left

**A stretch does not respect the divisions.** The fall-back rule walks price
forward across the history and marks a turn wherever price falls back far
enough. It knows nothing about where `train` ends and `test` begins. So a
`rising` stretch can start in `train` and finish in `test`.

**Owner's decision, 2026-09-12: cut at EVERY boundary.** `train` / `test`,
`test` / `held`, and `held` / `reserve`. Every stretch then belongs to exactly
one part of the history, and every count in this document is unambiguous about
which part it is a count of.

### And each part is drawn by a walk that stops at that part's own end

**Added 2026-09-12, after the adversarial pass found the first build breaking
section 7.** The first build drew the stretches with ONE walk over the whole
span and only then cut them. The percentage it found was clean and stayed clean
under attack. The stretches were not.

A high only becomes a turn once price has fallen back from it, and that
fall-back can arrive in `held` or in the sealed `reserve`. Until it does, the
walk's last stretch runs to the end of ALL the data. So whether a piece sitting
inside `test` was a whole stretch or a left-over end depended on price the
reading is forbidden to consider — and the median those left-over ends are
measured against is built from that same set. Two price series identical for
every period of `train`, `test` and `held`, differing only inside the sealed
`reserve`, reported different medians and a different count of stretches **in
`train`**.

**So: `train` is read from a walk over `train`; `test` from a walk over
`train` + `test`; `held` from a walk out to the end of `held`; `reserve` from
the whole span.** The walk is prefix-deterministic — every stretch a turn
closed is identical in any walk that reaches that far — so the only thing this
changes is the unfinished run at the end, which is exactly the thing that was
reaching back. Nothing later can move an earlier part's figures now, at any
distance.

**The one coupling that remains is stated rather than hidden.** The median is a
`train` + `test` quantity by design (below), so a change inside `test` does move
`train`'s stub arithmetic. That is the rule as written and it is what the
owner asked for. What is not defensible, and no longer happens, is anything
past the end of `test` moving either of them.

**An unfinished run is a left-over end.** No turn ended it — it ran out of
data — which is exactly the definition below. It was not marked as one, so the
last part of every span counted an unfinished run as a whole stretch.

### The stubs that cutting creates

Cutting produces **stubs**: a stretch bounded by a turn on one side and a
calendar cut on the other. There are **at most two per part of the history**,
one at each end, because only the edges can be cut.

The question is whether a stub counts towards a demand like "two of each type
inside `test`". A stub of three days is not a trend; a stub of five weeks
plainly is. The owner, 2026-09-12: *"an algorithm that looks at the average
length of these stretches and figures out the stub pieces if they add up to
one."*

**The rule, and it needs no new parameter.** For each type, on each coin, take
the **median** length of that type's FULL stretches across `train` + `test`.
Then, for any part of the history:

> count = (full stretches of this type in it) + (that type's stub lengths) ÷ (that median)

Two half-length stubs add up to one. A three-day stub against a six-week median
contributes 0.07 and changes nothing.

**Median, not mean.** Stretch lengths are skewed — a few long trends drag a mean
upwards, which would make every stub count for less than it deserves.

**Fractions, not a threshold.** A threshold has a cliff: a stub one day under it
counts nothing, one day over counts as a whole stretch. That is the same fault
that sank the flat type in section 6 — a small move in a parameter flipping the
answer. A fraction has no cliff, and the median comes out of the coin's own
data rather than being typed.

### One demand does not need any of this

The stub rule serves ONE of the two demands. The other dissolves:

- **Balance** — how much of a part of the history is `rising` against `falling`
  — is about lengths. Stubs matter. Use the count above.
- **Handover** — does this part actually exercise the forecasts changing hands
  — is about **turns**. A turn either falls inside a window or it does not.
  **Turns never get cut.** So count them directly: two of each type means at
  least three turns inside the window, and no stub rule is involved.

One number cannot serve both. Two numbers, and only one of them reads the
median.

## 6. The training weight Coins produces

This section exists because of a question the owner asked on 2026-09-12, and
the answer changed the design. It began as *should there be a third type,
flat?* — and ended somewhere better.

### Why a third type was rejected, and what replaced it

A flat type would be a stretch that moved too little to be either. It has one
fatal problem, and the owner found it: **the typing has hindsight and a
`member` does not.** A turn is found by looking at where price went next, so
"flat" is a property of a whole stretch. At trade time a `member` sees only
what came before. Training it towards a target built from information it can
never have when it acts is training it towards something undetectable.

It is worse for flat than for the other two. Trends persist — thirty days into
a rise, the recent past looks like a rise. **A flat patch and the first days of
a trend look identical until the trend moves.**

So flat is not a type. **It is a weight.** Keep two types, keep exactly the
silence they already have, and weight down the periods where little was
happening so they teach each `member` less. Nothing has to be detected at trade
time; the model was simply taught less by the periods that had less to teach.

### What it buys, with the owner's own example

A `rising` stretch: 15% over six weeks. But twelve of those fifteen points
happen in one week, and the other three spread across five weeks.

On daily periods that is roughly 7 periods moving 1.6% each, and 35 periods
moving 0.086% each.

| | count | weight each | total pull |
|---|---|---|---|
| the fast week | 7 | 1 | 7 |
| the slow five weeks | 35 | 1 | 35 |

**Unweighted, the drift outvotes the real move 5 to 1**, and the `rising` set
learns the drift.

| | count | weight each | total pull |
|---|---|---|---|
| the fast week | 7 | 1.6 | 11.2 |
| the slow five weeks | 35 | 0.086 | 3.0 |

**Weighted, the fast week wins 3.7 to 1.** That reversal is the whole point.

### The mechanism

**One number per period, every period.** There is no chunking to invent: the
training already takes one weight per row and refuses unless the list is
exactly as long as the training rows, and one row is one period — one trade
that could have been opened and closed.

**The number is how far price moved over the span that period is about** — from
where its trade would open to where it would close. It needs no new parameter,
because it is already worked out: it is what that period's label comes from.

**Normalised so the average weight across the training rows is 1**, so what
changes is which rows matter relative to each other, not how much training
happens overall.

**Capped**, because one violent period would otherwise dominate everything. The
ceiling is a control on a screen, never a constant in a file (RULE FIVE).

### ONE weight vector, shared by both sets

This is the part that is easy to get wrong, so it is stated plainly.

**The same number applies to both sets of `members` on the same period. Not
mirrored, not inverted.** In a fast `rising` week the `rising` set learns hard
to call and the `falling` set learns hard to hold — because that is the week
where a falling model speaking would cost the most. In a slow drift both learn
faintly, for the same reason in reverse.

So it is one vector per coin and `trade length`, not one per set.

### What it does NOT change, and what it does NOT do

**It does not change who is silent.** The `rising` set is trained towards
silence across every `falling` stretch, and the `falling` set across every
`rising` stretch. That is unchanged and nothing here touches it. **The weight
says how hard to learn a row's lesson. It never changes which lesson that row
carries.** A falling-set row inside a `rising` stretch has the target "no call"
whether its weight is 0.1 or 3.0.

**It does not teach silence, either.** Down-weighting a period is not the same
as labelling it "no call". Those 35 drift periods still carry a target and the
`rising` set still votes on days that look like them — it has just been taught
about them faintly. **The thing that produces silence is the band**:
`balancedBandPct` already labels a period "nothing" when its move is under a
threshold, tuned so about one period in three says nothing.

So the two do different halves of one job and have to be set together:

- **the band is the cliff** — below it, no call at all
- **the weight is the taper above it** — small-but-not-tiny moves teach less

Without the weight the cliff is all there is, and 35 periods sitting *just*
above it still swamp the 7 that matter. That is the gap this fills.

### Why it is not a leak

It reads the period's own outcome, which the training already sees as that
period's label. It reads nothing from beyond the period that the label does not
already carry, and every weight is fixed before training starts. It is the same
shape as the class weighting already in use.

### The guard it needs, and the bet it makes

**It multiplies against weights that already exist** — the balance weighting,
the recency weighting on **History**, and the difficulty weighting proposed for
**Sweep** if that is ever built. Three or four multiplied together can leave
almost all of the effective training resting on a handful of periods. The
recency weighting already refuses when too little effective history is left.
**The same guard has to cover all of them together rather than each alone**, or
it passes three times and still leaves nothing.

**And the honest bet, recorded as a bet rather than a fact.** Weighting towards
the periods that moved means each `member` sees the big moves clearly and the
mild ones faintly. If what it actually meets is mostly mild, it has been
trained for the wrong thing. The counter is that mild periods do not need skill
— a fixed direction handles them and the four comparisons already price that —
but that is a claim about which kind of period will dominate, and nobody has
measured it.

### Where the work is split

**Coins works the number out and stores it** against the coin's history, beside
the type labels, per section 12. **Sweep multiplies it in** when it trains. How
the training applies it belongs with `TREND-TRAINING-DESIGN.md`, not here.

### Open, and not guessed at

**Whether the weight should act on runs rather than on single periods.**
Periods overlap in what they read: on `daily-4d` they start a day apart but
each reads back 96 hours, so neighbouring rows share three quarters of their
window. Four adjacent periods are not four independent observations — they are
closer to one seen four times. Which means down-weighting a single period
changes almost nothing, and **if this is going to bite it may have to act on
runs of periods rather than on rows one at a time.** Worth settling before it
is built.

## 7. Which stretches the search may read

**Owner's decision, 2026-09-12**, and it replaces what `TREND-TRAINING-DESIGN.md`
section A says. That document says *"Held and reserve are never opened by any of
this."* That is now half right, and here is the whole of it.

**The parameter is solved on `train` + `test` only.** The percentage is chosen
to hit the target count of direction changes across the two stretches the models
actually learn from. **`held` and `reserve` get no vote in choosing it.**

**Then the settled percentage is applied to `held` and `reserve`, and what is
there is reported.** Counts and balance per stretch, on the screen, and **never
fed back into the search**. So you find out before you sweep that a coin's
`held` runs 96% one way — instead of finding out at **Verify**, after the whole
sweep is spent, which is a failure that has already happened.

**It is never a gate.** The reading is shown, warned about and sortable, and
**any coin stays usable however it looks**. The owner, 2026-09-12: *"we can
override at any point and continue to use the data no matter how it looks."*

**And a one-directional `reserve` is a test case, not a defect.** It is exactly
where you would want to watch one set of `members` sit out while the other
votes, and see whether the thing still works. Rejecting those coins would throw
away the most informative ones.

**The bias this leaves, named rather than waved off.** If coins ARE dropped by
hand for a one-directional `held`, then the population **Verify** judges has
been selected for being measurable. That is mild — it selects for terrain, not
for profit, and the type labels never reach trade time — but it is a bias and
it is written down as one.

**Why holding the two stretches out entirely was rejected:** the worst tail
slice in section 11 is *defined* on the tail. Hold out the tail and the score
the owner asked for cannot be computed at all.

## 8. What is read, and where — reported, never enforced

**This tab reports. It does not refuse.** Owner's decision, 2026-09-12, and it
governs everything below: *"We're not even blocking coins with this anyways.
We're only reporting."*

That matters because the wording here used to say otherwise. It came out of
`TREND-TRAINING-DESIGN.md`, which opens stage zero as *"a pass that decides
which coins are eligible"* — and this document then carried both premises at
once, saying "never a gate" in one place and setting floors a coin "must stay
clear of" in another. **The owner's premise is the one that survives.** There
are no cut-offs anywhere on this tab. Every figure below is something you look
at and sort by, and you decide.

### What is read, per part of history

Worked out separately for each of the three jobs a stretch can do:

| type of history | what it is worth knowing |
|---|---|
| **fitting** | how many separate `rising` and `falling` stretches there are for the two sets of `members` to learn from, and whether either side is one era wearing a type's name |
| **choosing** | whether a choice made here would be a choice about one direction |
| **judging** | whether a claim made here is a claim about trading, or about a market that only went one way |

**Read per part, not per span.** A span can be beautifully mixed and still hold
a stretch inside it that runs one way from end to end. That is the whole reason
these are separate numbers rather than one.

### The readings

- **Turns inside each part.** Two of each type inside `test` means four
  stretches and three changes of direction — enough that it actually exercises
  the forecasts handing over. A weaker reading, some number of periods of each
  type, could be satisfied by one long rise and one long fall with a single
  handover, which shows almost nothing. **Counted as turns, per section 5** —
  turns never get cut at a boundary, so this reading needs no stub arithmetic.
- **Whether each type appears more than ONCE inside `train`, in SEPARATED
  stretches.** One long stretch of a type can be memorised as a period of the
  calendar rather than learned as a condition. A coin with one long rise and
  one long fall is worth knowing about before it is swept, not after.
- **The split of time, per part** — how much of `train` was `rising` against
  `falling`, and the same for `test`, `held` and `reserve`. Two numbers, one per
  type, reported. **Not a test, and there is no cut-off on either of them.**
- **The count of changes is NOT the same as the split of time.** A coin can turn
  ten times and still spend 85% of its time rising; the falling set then sees a
  tenth of the periods as real calls and the rest as stay-quiet. Both numbers
  are needed and neither substitutes for the other.
- **That a thin side is not corrected for AT ALL.** Stated as a plain sentence
  on the screen, not as a level, and not enforced. **Corrected 2026-09-12:**
  this bullet used to name a level — one row in sixty, about 1.7% — under which
  the training's weighting stops being able to compensate. That level is real
  but it lives in `trainMember` in `lib/bracket.js`, and the three-stage engine
  **does not call that function**. It trains through `trainProbMember` in
  `lib/stagework.js`, which passes the money weights and no class weights at
  all. So there is no weighting for a thin side to fall out of: it is not
  compensated for at any thinness. That is a plainer thing to say and a stronger
  reason to read the split of time, which is what this tab is for. See finding 1
  in section 14.

### The boundaries do NOT move — owner's decision, 2026-09-12

`TREND-TRAINING-DESIGN.md` section D had the test boundary sliding earlier
until `test` held two of each type, with a cap on how far it could go and
rejection of any coin that needed more. **That is dropped.** The owner:
*"We're gonna keep those fixed instead, and we're gonna tune the parameters,
the percentages, which identify what is rising and falling instead."*

**So the `window layout` divides the history and nothing this tab does moves
it.** The one thing that is tuned is the fall-back percentage of section 3.
No cap, no boundary search, and no coin rejected for needing one.

Three things follow, and two of them are improvements:

- **`test` is no longer selected for turning.** Under the old design every
  coin's `test` was, by construction, a turning stretch — a clean one-way
  stretch would never have been tested on. A rule could then be tuned on
  switching and judged on a stretch that never switched. With the boundaries
  fixed, `test` is whatever the history actually put there, and section 7
  reports it either way.
- **No training data is given away.** Moving the boundary earlier would have
  taken the most recent part of `train` — the periods closest to what the
  forecasts will face — and handed them to `test`. That cost is gone.
- **The one lever is pulled towards two things at once.** The number of changes
  across `train` and `test`, and two of each type inside `test`, are both
  reached by lowering the same percentage. Changes are not spread evenly in
  time, so getting four stretches into the last 13% may need far more total
  changes than would otherwise be wanted. **Solve for both at once, per coin,
  rather than in sequence, or they fight** — and when no percentage reaches
  both, say so on the screen rather than moving anything or dropping the coin.

## 9. Both window layouts, every coin

**Coins works out and tunes the parameters for BOTH `window layout` choices —
`61/13/13/13 (sealed exam)` and `70/15/15` — for every coin.**

- `61/13/13/13 (sealed exam)` is `train` / `test` / `held` / `reserve`.
- `70/15/15` is `train` / `test` / `held`.

They give different amounts of history to learn and choose on:

| `window layout` | train + test | kept back |
|---|---|---|
| `61/13/13/13 (sealed exam)` | 74% | `held` 13%, `reserve` 13% |
| `70/15/15` | 85% | `held` 15% |

Both are provided for all coins, and **a coin's fitness is assessed per
layout**: a coin can be fit under one and not the other. So the metadata is per
coin **per layout**, and so is the ordering.

**And it is worth knowing on this screen** that a `70/15/15` run can never reach
**Greenlight** — it has no `reserve`. That is a property of the layout, decided
elsewhere, and it is repeated here because it changes what a coin's fitness
under `70/15/15` is actually for.

## 10. What a coin ends up with

**Three readings per coin.**

| reading | how many | what it answers |
|---|---|---|
| two-set voting, `61/13/13/13 (sealed exam)` | one per coin | can this coin be trained two ways under this layout? |
| two-set voting, `70/15/15` | one per coin | can this coin be trained two ways under this layout? |
| traditional one-set voting | one per coin, **not** per layout | is this coin worth trading at all, the way we do it today? |

The third is the one that decides whether a coin is worth sweeping at all.

## 11. The traditional score

This is the reading for the way the system works today — one set of `members`,
voting everywhere — and it is **one reading per coin, not per layout**.

### The problem it has to catch

The owner, 2026-09-12: *"we could have a setup where the held is all up, when
the reserve is all down, which is problematic potentially if the training
period was a general mix of up and down ... We've seen that on some of the
testing so far that it was hard to get good results when the verified data was
all in one direction."*

So the question is not "does this coin's history contain a mix". It is: **could
a stretch of this history land all one way?** A span can be perfectly balanced
overall and still hand `held` nothing but a rise.

### It is computed from an untuned reading of direction

**The traditional score must not be worked out from the tuned `rising` and
`falling` parameters.** Those exist for two-set training, and the traditional
configuration has no such split. If the traditional number were built on them,
re-tuning the parameters for two-set training would silently move every coin's
traditional score with it.

So: a plain, fixed reading of direction, with nothing tunable in it — and, per
section 3, worked out from returns rather than price levels, for the same
reason.

### Two numbers, both shown, both labelled

**Number one — the most one-sided stretch.** Slide a window the size the layouts
actually carve — the last 13% and the last 15% — across the whole span. At each
position measure how balanced `rising` and `falling` are. The score is the
**worst** balance found anywhere. It answers the failure above directly:
somewhere in this history there is a stretch that runs all one way.

**Number two — the drift.** Cut the span into equal parts, measure the balance
of each part, and score how much that balance moves from part to part. This
catches "the training part was a general mix and the last part was all one way"
head on, and it is what makes the visual useful: it shows you WHERE the
one-sided stretch is, not merely that one exists.

**Both are shown, and both are labelled on the screen so it is plain which is
which.** Never two bare figures side by side.

**And both move with how much history a coin has** (measured 2026-09-12, after
the adversarial pass). Each measures over a SHARE of the span, so a short coin
is measured over short windows. On a coin with no trend at all, 300 trials per
length:

| periods | most one-sided stretch reads 0 | mean most one-sided stretch | mean drift |
|---|---|---|---|
| 40 | 72.7% | 0.046 | 0.120 |
| 100 | 1% | 0.185 | 0.094 |
| 1000 | 0% | 0.393 | 0.030 |
| 2000 | 0% | 0.425 | 0.021 |

Nearly three quarters of trendless forty-period coins score the worst value the
first number has. **Two coins with different amounts of cached history are not
comparable on either number**, and ordering the table by one of them orders it
partly by how much history each coin happens to have. That is said on the
screen, in the note above the table, and the period count sits beside both
numbers so it can be read with them.

**What is NOT done about it, and why.** No cut-off, no normalising, no
adjustment: this tab reports (section 8), and an adjustment would be a second
arithmetic to argue with. A reference point — what a no-trend coin of that
length would have scored — is the obvious next thing and it is **an open item
for the owner**, not something a session decides. It is in section 17.

**The widths are the ones the layouts actually carve**, read out of the
engine's own split at that period count — the sealed `reserve` of the four-way
layout and the held-back stretch of the three-way one. Both layouts always, so
this stays one reading per coin. They are never typed here; the first build had
`0.13` and `0.15` as a default argument nothing ever passed, which is a second
copy of the arithmetic and a value with no control (RULE FIVE).


### It characterises the HISTORY, never our treatment of it

**Added 3.122.0** (owner order, 2026-09-13: *"principally we are characterizing
the HISTORY, not our treatment of the history"*, and *"chunk shape and 24/5 are
actually completely irrelevant here — you need to look at the three hold types
and their possible starting anchors only"*).

Until this release the screen would say nothing until a `chunk shape` and a
`24/5` setting had been chosen, and then reported what ONE treatment of a
history holds while its own opening line said it reported what the history
holds. Both controls are gone.

**A chunk shape's name is its LOOK-BACK, not how long a trade is held.** The
look-back only feeds training; it changes nothing about the trade. So two shapes
that hold for the same time and start at the same moment offer the SAME trades.
Measured on an 80-day series: `Daily 1-day` and `Daily 2-day` share 78 of 79
entry times, `Daily 3-day` and `Daily 4-day` share 75 of 76. Five shapes, three
holds.

| how long a position is open | when one can start | starts a week |
|---|---|---|
| 17 hours | 01:00, any day | 7 |
| 41 hours | 01:00, any day | 7 |
| 60 hours | Tuesday 03:00 | 1 |

Fifteen possible starts a week, which is the whole of what this history has to
offer. **Every coin is read at all three, and nothing is asked for to make that
happen.**

**The anchors stay where they are** (owner, 2026-09-13: *"hold the anchors as
they are"*). The 01:00 entry and the Tuesday anchor are pinned in the engine's
own shapes and read back from there, never restated. They are choices, not facts
about the price — unpinned it would be twenty-four starts a day rather than one —
and unpinning them is a separate decision nobody has taken.

**`24/5` was never a property of a coin.** It is a rule about which start days we
allow ourselves. With the anchors held, every start day counts, so it is not a
setting here at all.

**The three numbers are derived, never typed.** The holds come from grouping the
engine's own shapes by how long each holds; add a shape with a new hold tomorrow
and this screen gains a row for it without anybody remembering to add one.

**And it closed a collision.** A reading used to be stored per coin and chunk
shape, with `24/5` not in the key at all — so reading a coin with it on
overwrote the reading taken with it off, same file, last press wins, with
nothing but the line under the row to say which one survived. One record per
coin now, carrying every hold.


### When a number does not tell the coin apart from one with no trend

**Added 3.121.0** (owner order, 2026-09-12: *"plan the code based on the length
of the history. And if you have to make some kind of flag or warning if there's
not enough history and things get sketchy, just put that on the screen."* And on
where the line sits: *"that's the code that needs to put something on the
screen. Not you."*)

**There is no line, and no number is written down anywhere.** The coin's own
periods are shuffled into a different order two hundred times — that is the same
coin with its trend taken away — and both numbers are read off each shuffle. The
question is then simply: **could a coin with no trend at all, of exactly this
length, have scored what this coin scored?**

If it could, the screen marks it, and the range the shuffles covered is in the
hover. **The mark does not say WHY**, because this reading cannot know: either
there is no trend in the coin to find, or there are too few periods here to
separate one from the other. Both read exactly the same. The first version of
the sentence behind the mark said "N periods is too few", and that is a cause
it cannot see — a coin with no trend at twenty thousand periods reads the same
as a coin with a trend at forty. **It is never a cut-off and no coin is refused
for it** (section 8).

Measured on a coin with a real one-way run buried in it:

| periods | can the most one-sided stretch tell? | the coin | its own shuffles |
|---|---|---|---|
| 40 | **no** | 0.000 | 0.000 – 0.167 |
| 100 | **no** | 0.000 | 0.000 – 0.308 |
| 300 | yes | 0.000 | 0.103 – 0.289 |
| 2040 | yes | 0.000 | 0.325 – 0.385 |

A coin with no trend at all is never tellable at any length, which is right:
there is nothing in it to tell.

**How many shuffles is a control**, with a default, like every other value on
this tab. It is a precision setting and not a threshold — there is nothing to
set a line at. Raising it is STRICTER, not sharper: the range the shuffles cover
only ever widens as more are taken, so more shuffles can turn a `can tell` into
a `cannot tell` and never the other way round.

**The shuffle is deterministic.** Same coin, same answer, for ever. Nothing this
system reports changes between two reads of the same data (RULE SEVEN).

**The first version of this test was wrong and the pre-registered rule caught
it.** It asked only whether the shuffles ever disagreed with each other, and at
forty periods two of two hundred did — so it passed the exact case the rule said
it had to catch. Two answers out of two hundred is not a number that can tell
anything apart. The criterion was changed; the check was not.

## 12. The metadata written on a coin's history

When the settings have been tuned on a coin's history, they are **saved as
metadata against that coin's history** — they belong to the coin, not to a run.

What is recorded:

- **the fall-back percentage found for that coin**, per `window layout`;
- **the shape of the walk** that found it — the count of changes at each
  percentage tried, which is what section 4's visual draws;
- **the type labels** the settled percentage produces, since stage 1 needs them;
- **the counts and the balance of each type, per stretch** — `train`, `test`,
  `held` and `reserve` separately, not just per span;
- **the three readings** from section 10;
- **the provenance: the total range the history data came from.**

The provenance is not decoration. A score cannot be read honestly without
knowing which span and which parameter values produced it, and a coin whose
history has since grown must read as **stale** rather than quietly wrong.

## 13. The screen

- A **score per coin**, with the coins **ordered by it**.
- The score reads **visually** — you can see what you are looking at per coin,
  not only a number. Section 4's walk and section 11's drift are what make that
  possible.
- Every figure labelled, per section 11.
- The `held` and `reserve` reading shown as a **warning, never a gate**, per
  section 7.

Nothing here has a name yet. Naming waits until the controls exist, are
deployed, and the word list is regenerated from what the box serves
(RULE ONE-A).

## 14. Findings read out of the code

Every one of these was read out of the named file. **They are findings, not
decisions.** Three bear directly on this tab; three belong to **Sweep** and are
listed so nobody thinks this tab solved them.

**Bearing on Coins:**

1. **THE SWEEP ENGINE DOES NOT WEIGH A RARE ANSWER UP AT ALL.** Corrected
   2026-09-12, and the correction is larger than the finding it replaces.

   This finding used to read: `lib/bracket.js` sets each answer's weight to the
   row count divided by the answers present times that answer's rows, capped at
   20, so with three answers the cap binds once an answer falls below about 1.7%
   of rows — a number worth SHOWING beside a coin. 3.119.0 shipped exactly that
   sentence onto the Coins screen.

   **It is false about every run the owner makes.** That arithmetic is inside
   `trainMember`, and nothing in `lib/` calls `trainMember` — it is referenced
   from one test file and from comments. The three-stage engine trains through
   `trainProbMember` in `lib/stagework.js`, which calls `tuneAndTrain` with
   `exampleWeights` and nothing else; `classWeights` there defaults to null.

   **So a rare answer gets no help whatever**, at 1.7% or at 30%. There is no
   ceiling to expose, because there is no weighting under it. Making that
   ceiling a control, which was the plan for this release, would have put a knob
   on code the owner never runs.

   **What the tab says now**: that a thin side is not corrected for at all. What
   is NOT settled, and is the owner's to settle: whether the engine SHOULD
   balance a rare answer. The two-set design in section 2 assumes something
   handles the thin side, and today nothing does. It is in section 17.
2. **Weighting cannot manufacture data.** On a coin that is 90% one way, each
   real period of the other counts nine times, so a handful of unusual periods
   in one short stretch drive the whole model. Weighting repairs a mild
   imbalance; it cannot repair a thin one. That is why the split of time is
   worth reading on this tab rather than assumed away — not so this tab can
   refuse a coin, but so nobody expects the weighting to fix a side that is
   simply not there.
3. **The band that decides "too small to bother with" must be chosen AFTER the
   mask.** `balancedBandPct` in `lib/dataset.js` picks that band as the move
   size making about one period in three say nothing, computed from the training
   periods only. If everything outside a type is then overwritten to silence,
   the band was tuned for a population that no longer exists. It has to be
   chosen on the periods inside that model's own type. Coins does not fix this,
   but the counts this tab produces are what it would have to be recomputed
   against.

**Belonging to Sweep, listed so they are not lost:**

4. **The copy check would silently undo the doubling.** `voiceGroups` in
   `lib/agreement.js` measures likeness as the share of ALL moments two
   `members` agree on. Two falling models are both silent through every rising
   stretch, so on a coin that rises 70% of the time they agree 70% of the time
   before either has said anything — and the default likeness threshold is 98.
   The fix is small: measure likeness only over the moments where at least one
   of the pair speaks.
5. **A bar set as a share of all the `members` becomes unreachable.** With half
   the `committee` structurally silent, a bar set as a share of the `members`
   that exist cannot be cleared above roughly a half. The `its own history` bar
   already handles this; `all of them` stops being a sensible bar for these
   committees.
6. **`families` should not treat a type as a kind of evidence.** A type is a
   different job, not different evidence. Left alone, a rising model and a
   falling model would look like two kinds of evidence agreeing when only one of
   them is awake.

## 15. The risk that is mine, not the owner's

> Proposed 2026-09-09 and recorded at the owner's request. Recording is not
> agreeing.

**The whole thing can collapse into following the trend.** If, inside a falling
stretch, nearly every real call is short, then the falling models have learned
"short" and the system reduces to a trend detector plus follow-the-trend.

This is not hypothetical. On the `reserve` of the set already on the box, going
short every period made money. A system whose entire skill was detecting the
fall and following it would have scored beautifully there, and against the money
gate as it stands today it would be indistinguishable from real signal.

**The comparison that separates them is the best of all four**, which is Part 2
of `VERIFY-DESIGN.md`. Nothing built out of this document should be judged
without it.

## 16. Decisions taken

- **2026-09-12 — the budget rule does not apply to this tab.** Coins reads all
  of the history, including `held` and `reserve`. A session raised that as a
  possible conflict with the rule that a judging stretch must not influence a
  choice. The owner's ruling: *"We are picking instruments that are useful for
  training and getting bent out of shape on making choosing at this stage is
  completely irrelevant."* Settled. Not to be reopened.
- **2026-09-12 — the parameter search reads `train` + `test` only; `held` and
  `reserve` are read and REPORTED, never fed back.** Section 7. This replaces
  `TREND-TRAINING-DESIGN.md` section A's "held and reserve are never opened".
- **2026-09-12 — the `held` / `reserve` reading is never a gate.** Warn, show,
  sort, override. A one-directional `reserve` is a test case, not a defect.
- **2026-09-12 — `members` vote; they do not judge.** Section 2.
- **2026-09-12 — the traditional reading is two numbers, not one combined
  figure**, and both are shown and labelled.
- **2026-09-12 — Sweep's coin list comes out of Coins**, rather than being
  typed in.
- **2026-09-12 — the fall-back percentage search takes the LARGEST percentage
  that gives AT LEAST the number of changes asked for.** The owner, asked
  directly, answered yes to the recommendation that had been sitting in
  section 4. That was the last thing genuinely blocking a build of this tab.
- **2026-09-12 — this tab REPORTS and never refuses.** No cut-offs anywhere on
  it, on any reading. The owner: *"We're not even blocking coins with this
  anyways. We're only reporting."* This replaces the premise inherited from
  `TREND-TRAINING-DESIGN.md`, which opens stage zero as a pass that decides
  which coins are eligible. Every figure is shown and sortable; the choice is
  the owner's at the screen. Section 8.
- **2026-09-12 — stretches are CUT AT EVERY BOUNDARY**, so each belongs to
  exactly one of `train`, `test`, `held`, `reserve`. Stubs count as fractions
  of that type's median full length; turns are counted directly and need no
  stub rule. Section 5.
- **2026-09-12 — there is no third type. Flatness is a WEIGHT, not a label.**
  A flat type cannot work: the typing has hindsight and a `member` does not,
  so it would be trained towards something undetectable at trade time. The
  weight does the same job with no detectability requirement. Section 6.
- **2026-09-12 — ONE weight vector, shared by both sets of `members`.** Not
  mirrored, not inverted. And it changes nothing about who is silent: the
  weight says how hard to learn a row, never which lesson that row carries.
  Section 6.
- **2026-09-12 — the word is `coin`, not `pair`.** This tab says `coin`, and
  **Data** was changed to say it too (3.114.1), so every screen now agrees.
- **2026-09-12 — the `train` and `test` boundaries are FIXED and this tab
  never moves them.** Only the fall-back percentage is tuned. This replaces
  `TREND-TRAINING-DESIGN.md` section D's sliding boundary, its cap, and the
  rejection of coins that needed the boundary moved too far. Section 8.

**Settled 2026-09-13, in the batch that shipped 3.121.0. Each of these was an
open item in section 17 until it was; they are struck from there, not left in
both places.**

- **2026-09-13 — the reference point for the two numbers is BUILT.** Both move
  with how much history a coin has, and there is now a per-coin answer to
  whether either of them tells that coin apart from a coin with no trend:
  shuffle the coin's own periods, read the same number off each shuffle, and
  mark the number when the coin's own answer sits inside what the shuffles
  cover. No line is written down anywhere and no coin is refused. Section 11.
- **2026-09-13 — a record written under an older shape is NAMED, not
  migrated.** The owner's ruling: *"I'm gonna be deleting all of the data that
  we have under the current system, so we don't care about any migration ...
  Just code it right for this time."* So there is no migration code on this tab
  and none is to be written; the reader says which shape a record is and to
  read the coin again. RULE TEN's point exactly: a repair nobody can retire is
  worse than none.
- **2026-09-13 — the share that is sealed off has ONE home.** The owner:
  *"just do it once in one place, like good code design."* `RESERVE_SHARE` and
  `reserveChunks` sit beside `splitBounds` in `lib/bracketwork.js`; the sealed
  layout, the retrain layout and this tab all read them. A test walks every
  file under `lib/` and fails on a second one.
- **2026-09-13 — the word list gets an exception for `24/5` and for no other
  all-digit label.** The owner, asked: *"Just make an exception for 24/5 and
  forget about the other numbers."* A label of bare digits is still invisible to
  the generator, deliberately — over-collecting authorises words the owner
  cannot see, which is the fault RULE ONE-A names.

**Settled 2026-09-13, in the batch that shipped 3.122.0:**

- **2026-09-13 — this tab characterises the HISTORY, not our treatment of it.**
  The owner: *"principally we are characterizing the HISTORY, not our treatment
  of the history"*, and *"chunk shape and 24/5 are actually completely
  irrelevant here — you need to look at the three hold types and their possible
  starting anchors only"*. `chunk shape` and `24/5` are gone from **Coins**;
  every coin is read at all three holds. Section 11.
- **2026-09-13 — the starting anchors stay exactly where the engine pins
  them.** The owner, asked directly: *"hold the anchors as they are"*. 01:00
  every day for the two shorter holds, Tuesday for the longest — fifteen
  possible starts a week. Opening them up is a separate decision and is not
  taken.
- **2026-09-13 — a blank coin box means every coin downloaded on the box.**
  The owner: *"either we keep count of the number of coins and the default
  tracks the number we've got downloaded OR we just say 'all coins'"*, and then
  chose the first. The typed list of seventeen is deleted, and with it four
  typed copies of the number 17 in labels and a refusal sentence. The cost,
  said out loud and accepted: a blank box is a moving target, so two blank
  launches on different days can read different coins. Every run writes down
  what it actually resolved to, so what ran is never in doubt afterwards.

## 17. Open items

- **Whether the training weight acts on runs of periods rather than on single
  periods.** Neighbouring periods share most of their look-back window, so
  down-weighting one changes almost nothing. Section 6.
- **Which of the two traditional numbers orders the list** — the worst tail
  slice, or the drift.
- **What the screen should show first** for each of fitting, choosing and
  judging — which of the readings in section 8 leads, and which sit behind it.
  There is no bar to set, so this is a question about presentation, not about
  what a coin has to clear.
- **The name of every control on this screen.**
- **Every cost in this document. Not one of them has been measured.**

**Added 2026-09-12 by the adversarial pass, and every one of these is the
owner's call, not a session's:**

- **WHETHER THE ENGINE SHOULD BALANCE A RARE ANSWER AT ALL.** Replaces the item
  that asked for its ceiling to be a control (2026-09-12). There is no ceiling
  to expose: the trainer the engine runs passes no class weights, so a rare
  answer is not weighed up by anything — see finding 1 in section 14. The two-set
  design in section 2 assumes the thin side is handled and today nothing handles
  it. Building that is a change to how every model is fitted and it is the
  owner's call, not a session's.
- **A percentage step small enough to be absurd is walked in full.** At a step
  of one ten-millionth over the default range that is roughly 290 million
  typings per coin, about 22 minutes with nothing else able to run. The box on
  the screen carries a smallest step, which is the owner's control; no cut-off
  was added in the code, because a cut-off is a number to argue with and this
  tab does not have those.

## 18. What is not in here

- **How the two sets of `members` are actually trained**, the masking, the
  balance weighting and the difficulty weighting. All of that stays in
  `TREND-TRAINING-DESIGN.md`; it belongs to **Sweep**. The one place this
  document crosses into it is section 6, and only as far as the boundary drawn
  there: **Coins works the training weight out and stores it; Sweep multiplies
  it in.**
- **The parameter values themselves.** This document says what is tuned and
  what it is tuned for; it does not pick numbers.
- **Anything about the record sets already on the box.** Coins changes nothing
  about them.
