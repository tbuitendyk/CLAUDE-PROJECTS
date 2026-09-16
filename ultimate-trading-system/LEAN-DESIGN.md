# Taking the direction out of the forecast, judging the tunings before the reserve, and two more sizing controls

Written 2026-09-16, the morning the reserve window was read for the first time on
a rule that had passed on the held window. **Nothing in this document is built.
Nothing in it is authorised. It is written so the owner can review it, change it,
and then hand the whole of it to one work loop from start to finish.**

Four kinds of thing are in here and they are kept apart on purpose:

- **What the numbers said.** Section 1. Read off the owner's own box on
  2026-09-16 with read-only probes, quoted exactly.
- **What the code does today.** Section 2 and the findings inside each part.
  Every one names the file and the line it was read from in the session that
  wrote this. These are findings, not decisions.
- **What I propose.** Parts A, B and C. The owner asked for these to be fleshed
  out; fleshing out is not agreeing, and not one of them is decided.
- **Defects found while writing this.** Reported, not fixed. The owner
  decides if and when any of them is touched (RULE ZERO).

## Read the words first

| Word here | What it is |
|---|---|
| train, test, held, reserve | The four stretches a coin's history is cut into. The owner's four words, used exactly (RULE ONE-D). |
| `held-back` | What **Held** calls the third stretch on its own controls. Quoted when naming a control there, `held` everywhere else. |
| setting | One row of a board: one whole combination of the dials. |
| survivor | A setting a rule keeps. On **Held** and **Reserve**. |
| rule | A Stage 4 record set: one cut on **Funnel**, or a half-life set built on **History**. |
| the capture | The per-trade record a press on **Tune** writes beside a Stage 4 record set. Its own control is `Capture the trades of this set`. |
| `argmax`, `directional` | The two ways one member turns its own three probabilities into a call. They appear in every setting's name. |
| `count`, `conviction`, `voices`, `families`, `trained` | The five ways the members' calls are added up into one call for the coin. These also appear in every setting's name, with a share beside them. **They are a separate layer from `argmax` and `directional`, and the two layers sit side by side in one label, which is why they read as one control.** |
| agreement | How many members voted the way the trade went. What the conviction sizing reads. |
| the lean | How far a rule's trades fall on one side rather than the other. **There is no name for this on any screen, because nothing on any screen measures it.** |
| the second pass | A run of **History** and **Tune** whose data stops before the reserve. **No screen has a name for this; nothing does it today.** |

**Every control this document proposes has no name, because it does not exist.**
Each is described by what it does. Naming happens when it is built and deployed
and the word lists are regenerated from what the box serves (RULE ONE-A).

**And one honest note about the word list itself.** The served record still pins
3.148.0 while the box runs 3.156.0, because the owner deferred that step through
the last batch. So three labels that ARE on the owner's screen are not on the
generated list: `Apply the conviction sizing`, `Take the sizing off` and `your
reason for the sizing`. I have used all three in conversation this session. They
are on the screen, so the owner can point at them, but the mechanism that proves
it is stale. **Recapturing the served record and regenerating the lists is the
first thing to do before the loop starts**, and it is a few minutes.

Every other control named in this document was read out of the rendering code in
the session that wrote it. On **History**: `Stage 4 record set`, `half-lives`,
`12 months` through `48 months`, `Retrain at the ticked half-lives`, `name`,
`Build the half-life set from this table`. On **Tune**: `Stage 4 record set`,
`Capture the trades of this set`, `scan target`, `survivor`, `windows the scans
read`, `training`, `test`, `held-back`, `reserve`, `or apply a custom stop %`,
`Apply custom`, `No stop (clear)`, `your reason for this choice`, `Save the
reason`, `Tune protective stop`, `Run conviction sweep`.

## Where this sits among the other documents

- `TREND-TRAINING-DESIGN.md` holds the owner's design for sorting history into
  trending up and trending down and training a doubled committee on it, spoken
  2026-09-09. **It is the large answer to the same problem this document opens
  with**, and its closing section already named what then happened on the
  reserve: "If, inside a down stretch, nearly every real call is short, then the
  down models have learned short and the system reduces to a trend detector plus
  follow-the-trend... On the reserve of the set already on the box, going short
  every period made money."
- **This document is the small answer and it is not a replacement.** Part A is
  four steps that can be taken now, cheaply, mostly as choices on a screen,
  without doubling the committee and without a new stage. If the owner builds the
  trend design later, Part A's measurement is what will show whether it worked.
- `VERIFY-DESIGN.md` holds **Held**, **Reserve**, the verdict and the five
  passes. `SELECTION-DESIGN.md` holds the doctrine. `AGEDIAL-DESIGN.md` holds the
  half-life run on **History**. This document touches all three and replaces
  none.

---

# 1 — What the numbers said

Read off the box on 2026-09-16, for the rule cut on LTCUSDT alongside DOGEUSDT
and LINKUSDT at the four-day shape, and for the half-life set built from it.

| a setting | held | reserve |
|---|---|---|
| the rule, plain | +214.03 | -4.10 |
| the rule, half-life | +225.25 | -59.03 |
| buy and hold | +48.90 to +72.01 | -48.66 |
| short and hold | -72.51 to -49.40 | +48.16 |
| always long | -7.23 to +340.21 | -465.41 to -182.95 |
| always short | -509.71 to -162.27 | +8.45 to +293.41 |

Survivors in the money: on held, 98 of 98 and 68 of 68. On reserve, 42 of 98 and
**0 of 68**.

Four things follow.

1. **The held window rose and the reserve window fell.** Buy and hold made money
   on one and lost it on the other; short and hold did the reverse.
2. **The rule beat always long on the reserve by 188 to 248 a setting, and every
   one of the 68 beat it, by between 57 and 462.** The forecasts were not
   worthless there. They could not be positive while mostly buying a falling
   market.
3. **A directionless strategy would have lost about 86 a setting on the reserve**,
   the midpoint of always long and always short: the cost of being in the market
   at all over 349 chunks. The plain rule lost 4 and the half-life one lost 59,
   so both beat a coin flip and neither beat the fall.
4. **All 68 sank together because they share one committee.** Settings within a
   unit differ only in entry and exit shape, which moves each by tens of dollars.
   A directional lean in the forecasts moves all of them by hundreds.

**Nothing in that table was a defect.** Two real defects were found beside it and
both are fixed and deployed: the two hold comparisons came back empty on the
reserve window so most survivors could never clear (3.155.0), and a survivor
sized at up to ten clips was averaged with sixty-seven at one clip (3.156.0).
What is left is the lean, and it is a design question.

---

# 2 — What the code does today, where the lean could live

Read out of the files named, in the session that wrote this. **Every line of this
section is a finding.**

**The target a member is trained on is the raw sign of the move.**
`lib/dataset.js:243-251` computes `diffPct` as `((c2 - c1) / c1) * 100` and the
label as `scoreDiff(diffFrac, dormantFrac)`, which is `lib/dataset.js:152-155`:
zero inside the band, otherwise `diffFrac > 0 ? 1 : -1`. Every engine caller
passes a dormant percentage of zero at build time, so the label written there is
pure sign and is always overwritten later at the fitted band.

**The band is a threshold on the size of the move, and it is sign-blind.**
`balancedBandPct` (`lib/dataset.js:157-164`) sorts the **absolute** moves of the
training chunks and takes the 33rd percentile, so about one third of them land
inside the band and become "stand aside" while two thirds become calls. **It
balances the dormant share and nothing else. Nothing in that function or
anywhere downstream of it balances up against down**; the two thirds divide by
however the coin's moves happen to fall. It is fitted on the training chunks
alone (`lib/bracketwork.js:199`, and the comment at `:211-214`: "a band fitted
with the judging stretch in hand has read the answer before the question"), then
every chunk in the pool is relabelled at it (`lib/bracketwork.js:200`).

**Nothing weights the two sides in the fit.** Inverse-frequency class weights
capped at twenty **are already written**, in `trainMember`
(`lib/bracket.js:641-648`) — and that is not the trainer the sweep runs. The
file says so itself at `lib/bracket.js:599-607`: "`trainMember` is NOT the
trainer the three-stage sweep engine runs... no sweep the owner launches weights
a rare answer up by anything at all". The sweep trains through
`trainProbMember` (`lib/stagework.js:371-373`), which calls `tuneAndTrain` with
example weights and nothing else (`lib/stagework.js:396`), so the class weights
default to null.

**The one weighting that does run is sign-blind too.** With the training choice
set to money rather than direction, the weight of a chunk is built from
`Math.abs(d)` (`lib/stagework.js:335`), so a rise of five per cent and a fall of
five per cent weigh the same. The default is direction, which is no weights at
all (`lib/stages.js:676-677`).

**A tie inside one member goes short.** `callFromProbs`
(`lib/committee.js:28-33`) walks the three probabilities `[down, flat, up]` with
the best index starting at zero and replaces it only on a strict improvement,
and `CLASSES[0]` is `-1`. So a dead tie between down and up returns SHORT. The
measurement copy in `lib/agreement.js:29-34` reproduces it deliberately so a
reading can never disagree with a vote. **It is a structural lean, it is small,
and it points the opposite way from the one section 1 found.**

**Nothing anywhere counts how many trades went long and how many short.**
Searched across the engine, the screens and the server. The side is written per
trade in the capture (`lib/stagework.js:1123`, `side: call === 1 ? 'LONG' :
'SHORT'`) and per decision in the live path, and **no reader aggregates it**. The
window tallies count trades, priced, unpriced, stopped and clips, never sides.

**The agreement the sizing reads is a plain head count of members whose own call
equals the call that was taken** (`lib/stagework.js:1115-1123`). Its range is
zero to the number of members. It is on a different scale from the agreement
figure the record stores, which is on the rule's own scale — a sum of fractional
weights for `voices`, a lean sum for `conviction` and `trained`, a count of
evidence families for `families` (`lib/agreement.js:226-247`).

**The capture only covers part of the board.** It is taken only for a setting
that enters at market with no trailing stop (`lib/stagework.js:1130`), because
those are the only trades the two scans on **Tune** price.

**A pass that slides the boundary already exists**, and it is the shape Part B
needs. `lib/passes.js` retrains a whole committee from scratch on only what came
before its judging stretch, and its own comment states the trick: "A PASS'S
JUDGING STRETCH ARRIVES IN THE HELD-BACK SLOT, which is what lets the pricing
task read it without knowing a pass happened at all." The arithmetic is
`passGeometry` (`lib/stagework.js`), and the cut is a modifier inside
`unitChunks` (`lib/stagework.js:525-529`).

**And the exact layout Part B wants existed and was deleted.** The comment in
`unitChunks` records it: "(The 72% retrain layout of 3.94.0, which reached
through the held-back slice and judged on the Reserve, went in 3.142.0: the
History retrain run uses the set's own layout, and since 3.144.0 is judged on
the Test window with the held-back slice never priced, so no layout without a
held-back slice exists any more and none is needed.)"

**The reserve is sealed before any pass cuts anything** (`lib/stagework.js:488-493`),
which is why no pass can reach it and why Part B is a layout question rather than
a pass question.

**The live path has no notion of sizing at all.** It computes the per-member calls
(`lib/live/stagesignal.js:95`) and reports them, but derives no agreement count
and sizes nothing: the intent carries one flat clip (`lib/live/signal.js:183`).
A greenlight records the frozen sizing as evidence (`lib/live/greenlight.js:140`)
and nothing in the live code reads it back.

**There is already a size multiplier in the engine, and it is a precedent.** The
confirmation overlay prices confirmed and unconfirmed trades at two different
multipliers and recombines them (`lib/confirm.js:27-31`,
`lib/stagework.js:1501-1518`), and at one setting it sits unconfirmed trades out
entirely.

---

# A — the directional lean, in four steps

The lean is not in the stops and not in the sizing. It is in what the members are
taught to want. The four steps are ordered cheapest first, and **each is worth
doing alone**; none depends on a later one.

## A1 — Measure it before changing anything

### The problem

Nothing records how many of a rule's trades went long and how many short. We
spent a morning arguing about a lean instead of reading it. Every later step here
is unjudgeable without this number, and so is every part of
`TREND-TRAINING-DESIGN.md`.

### The change

The capture already holds what is needed, per survivor and per window: one row a
trade carrying its time, its side, its agreement and its money
(`lib/stagework.js:1123`), for train, test and held, and since 3.150.0 for the
reserve as well. **So A1 is arithmetic over a file that already exists. Nothing
is re-priced and no run is started.**

Per survivor, per window: trades long, trades short, money long, money short,
**the side lean** as `(long - short) / (long + short)` between minus one and plus
one, **the money lean** the same over money, and the window's own direction from
the buy-and-hold figure already on the block. Per rule: the same pooled over its
survivors, and how many of its survivors lean the way the window went.

### The limit, stated plainly

**It can only be measured where there is a capture, and a capture covers only the
survivors that enter at market with no trailing stop.** A survivor of another
shape reads as not recorded, as it already does for the tuned block. Two other
sources exist on disk and neither is a substitute: the stored label arrays on
every stage 1 record are what the members were TAUGHT, not what was traded; the
stored probability arrays could reconstruct the calls, which is a re-derivation
and a much larger job. **Off the capture is the honest cheap answer and its
coverage has to be printed beside it.**

### Where it goes

One line and two columns under the survivors table on **Held** and on **Reserve**,
written once because both tabs are one renderer. Two more columns on "The picture
through every period" on **Greenlight**. A block on the set, so a verdict stamped
today can be read against one stamped in a year.

### What it is not

**It is not a gate.** A coin that rose for three years is allowed to have taught a
model that it rises. The number exists so the owner can see it. Making it a gate
is a separate decision and is not proposed here.

### The success rule, written before any number

A1 is right if the figures reproduce by hand from the capture file to the cent,
and if the held reading of the rule in section 1 shows a long lean while the
reserve reading shows a lean nearer zero or of the other sign. **If the held lean
comes out near zero, the lean explanation of section 1 is wrong and A2 onward
must be reconsidered before it is built.** That is the test that can falsify the
premise and it costs nothing.

### The digit

Second. A new reading on three screens and a new block on new records. A record
without it says so rather than being translated (RULE NINE).

## A2 — Make the fit stop preferring the common answer

### The problem

If the training window rose, "did it go up" has more yes than no in it, and a
model fitted to it leans long for free. It is rewarded for the tide rather than
for the swimming.

### The change, and it is two different things

**A2a — weight the two sides equally in the fit. Most of this is already
written.** The inverse-frequency weights in `lib/bracket.js:641-648`, capped at
twenty, are exactly the arithmetic wanted; they are simply not reachable from the
trainer the sweep uses, which the file itself points out. A2a is: make the class
weights a choice, pass them from `trainProbMember` into `tuneAndTrain` beside the
example weights that already travel there, and record the choice on the set.
**Leave the target alone. Nothing about what a forecast MEANS changes.**

**A2b — change what the forecast means.** Subtract the training window's own
drift from the target, so a member predicts whether the next move beats the
typical move rather than whether it is positive. A call then means "better than
drift". Everything downstream keeps working, because a call is still long or
short, but the quantity being predicted is a different one.

### The cost, corrected. My first draft had this backwards and it is the most important paragraph in the document.

I wrote, from my own reading, that a set already records how its members were
trained and that therefore "neither A2a nor A2b moves the first digit and nothing
on the box refuses". **The second half is true and it is the problem, not the
reassurance.**

**Nothing on disk carries a version for what the members were trained to predict.**
The measurement block has its own version and it covers the FEATURES only; a
change to the target does not move it. So there is no reader anywhere that would
refuse a record trained under one target when it meets one trained under another.
What each artefact does on a first-digit move, and what it does on a target change
with no first-digit move:

| artefact | refuses on a first-digit move | refuses on a target change alone |
|---|---|---|
| stage 1 set, stage 2 set | yes | **no** |
| stage 3 set | only a rebuild and a kept-copies fill | **no** |
| stage 3 totals | no, they are re-totalled | **no** |
| Stage 4 record set | it prints a warning and carries on | **no** |
| held set, reserve set | yes | **no** |
| reserve board, capture, half-life run | no | **no** |
| greenlight | minting yes, one already written no | **no** |

So the honest conclusion is the opposite of my draft's:

- **A2b, changing what a member is trained to want, has to move the first
  digit** — not because a reader refuses it, but because **nothing does**, and the
  first digit is the only mechanism in the system that would make yesterday's
  chains refuse. Without it a paused stage 3 run continued after the change would
  hold old rows and new rows in one store, and a stage 2 set whose missing units
  were filled in later would be **half a committee on each target**. The stage 2
  alignment guard compares timestamps only, so a relabelled parent lines up
  perfectly and is accepted. The engine's own comment forbids exactly this: "half
  a committee trained on direction and half on money would be two different
  committees wearing one name".
- **And moving the first digit throws away every chain on the box** (RULE ONE-C).
  So before release 6 is started, what is on disk is read and the cost is put to
  the owner in writing. **It is their call and not a session's.**
- **The clean alternative, and it is more work:** make the target a recorded
  choice AND add the comparison that is missing, so a set says which target it was
  trained on and every reader refuses a mismatch in words. That is the RULE NINE
  answer — a record says what it is in today's words, and no reader translates.
  It is roughly eleven places and it is the right thing. **This is a decision for
  the owner and it is added to the list below.**
- **A2a, the class weighting, does not change the target**, so it does not raise
  this. It does raise a smaller version of it, and that hole is already open for
  the training choice that exists today: see defect 6.

### Where it goes

A choice on **Sweep**, beside the training controls that are there, carried on
every set built from the run. It must be a choice and never a replacement, so
both can be run and compared (RULE FIVE).

### What it costs

A new stage 1, stage 2 and stage 3 run to have anything to look at. Nothing
existing is touched or invalidated.

### The success rule, written before any number

A2a is right if, over the same unit and windows, the lean of A1 falls toward zero
while the held money does not collapse. **A fall in the lean with a collapse in
the money means the lean WAS the money**, which is a finding worth having and an
argument against the whole approach. Both outcomes are written down now and
either is an answer.

A2b is judged on the reserve, once: does a rule trained this way lose less on a
falling window than the rule of section 1 did, at the same unit? One look,
stamped.

### The digit

Second for either, because both are a new choice with the old behaviour intact.

## A3 — Let the band be uneven, so the calls come out even

### The problem

Corrected from my first draft after reading the code. The band is **not** centred
anywhere: it is a single threshold on the SIZE of the move, and it is
deliberately sign-blind. It makes about a third of the training chunks stand
aside. **What it never does is make the surviving calls balanced.** On a coin
that spent the training window rising, the two thirds that become calls are
mostly up, and no part of the current code notices.

### The change

Allow the band to be **two thresholds instead of one** — one for rises and one
for falls — chosen so that up-calls and down-calls come out equal in number over
the training chunks, while the dormant share stays where it is. The existing
automatic band already demonstrates the pattern: fit it on the training chunks,
never on the judging stretch, and record what was fitted.

### One thing to know before choosing it

On a setting that enters at market, the band's only effect is on the training
labels; the trade is taken at the entry candle's open and no rail is involved. On
a setting that enters on a price level, the band is also the unit of the distance
dials, so **changing the band changes the rails too**, and a comparison between
two bands on those settings is not a comparison of one thing. That is a reason to
read A3's result on market entries first.

### Where it goes

Another value of the band choice on **Sweep**, beside the automatic one.

### The success rule

A3 is right if the counts of up-calls and down-calls over the training window
come out within a few per cent of each other, printed, where today they do not,
**and if the dormant share stays near a third**, which is the property the
current band was built to hold.

### The digit

Second. A new value for an existing choice.

## A4 — Cap one-sidedness at the decision, not in the model

### The problem

A1 to A3 all work through the training and all need a fresh chain to see. There
should be one control that acts on a rule that already exists.

### The change

**No more than a set share of a survivor's trades may fall on one side.** Once the
share is exceeded, the next trade on the heavy side is stood aside.

### Which side of the scale line it belongs on, and why it matters

3.156.0 settled that a stop is read into every reading while a sizing never is,
because a stop changes which trades happen at one clip a trade while a sizing
changes how much is bet. **A one-sidedness cap changes which trades happen, one
clip a trade. It is the stop's kind of control** and is read into the reading the
same way.

That has a practical consequence: **it can be tried on a captured set in seconds
with no stage 3 re-run**, because the capture holds every trade with its side and
applying a cap is a filter over that list, on the same path the stop scan already
uses.

### The honest trap, and it is the same one the floor of C1 has

A filter over the capture changes the money and **does not change the trade count,
the four comparisons, the scrambled copies or the beat and lead figures**, because
those were all priced when the record was made. A cap applied this way is a
reading of what the money would have been, which is exactly what the stop already
is and is honest so long as the screen says so. **A cap that must change all of
those has to move into the pricing path, which is a stage 3 re-run.** Both are
defensible; the cheap one comes first and the screen must not overstate it.

### The honest cost in money

**In a real trend this control loses money on purpose.** If a coin rises for a
year, capping the long side means standing aside through the best of it. Whether
it was worth it is a reserve question and will differ window to window. This is
the control most likely to look good on one stretch and bad on the next, and this
document says so before any number exists.

### Where it goes

A per-survivor choice on **Tune**, recorded beside the stop and the sizing in the
same record, with its own reason box, applied and cleared by the owner, frozen
into the next held set or reserve set and carried by a greenlight, exactly as the
stop is.

### The success rule

A4 is right if, applied to the rule of section 1, the lean of A1 moves toward
zero and the money changes by exactly the sum of the trades the cap stood aside,
checkable against the capture by hand. Whether the reserve money improves is the
question, and both answers are recorded.

### The digit

Second.

---

# B — a second pass of History and Tune, stopping before the reserve

## B0 — What already exists, and it is more than it looked

Three findings, and together they change the shape of this part.

**The windows are already separable on Tune.** A scan is aimed at whichever
windows the owner ticks, and the capture holds train, test, held and reserve
apart. **So a scan that reads train, test and held while leaving the reserve
alone is possible today by ticking three boxes.**

**A pass mechanism already exists and works.** `lib/passes.js` retrains a whole
committee from scratch on only what came before its judging stretch, and delivers
that stretch in the held slot so everything downstream prices it without knowing
a pass happened. That is precisely the trick this part needs.

**And the layout this part wants was built and then deleted.** The comment in
`unitChunks` records a 72% retrain layout from 3.94.0 "which reached through the
held-back slice and judged on the Reserve", removed in 3.142.0 when the retrain
run moved to judging on the test window. **The owner is asking for it back, for a
different purpose, and the code remembers what it was.**

**And the gap is already named in the code, by whoever declared the tab order.**
The preamble above the tab list says it in full (`public/construct.js:440-443`):

> "AND MOVING THE TAB DOES NOT MOVE THE READ. History and Tune still read the
> judging stretch until their reads are moved to the choosing stretch, so until
> that lands the strip states an order the engine does not yet keep. That is
> named here rather than left for somebody to discover."

**Part B is that read being moved.** The owner arrived at it from the money; the
code had it written down at the place the order is declared.

What is genuinely missing is three small things:

1. **A choice does not say what it was chosen on.** A stop or a sizing choice
   records a number, a reason, a time and who set it, and not which windows the
   scan that informed it was run over. A choice made on train and test is
   indistinguishable from one made on train, test and held.
2. **The half-life table is measured on the test window.** The surviving retrain
   layouts judge there. A second pass needs the same table measured on the held
   window, with the reserve still untouched.
3. **Nothing says which pass a record belongs to**, so two half-life sets built
   from one rule under two passes would differ only in their names.

## B1 — One screen with a pass choice, not History2 and Tune2

**That is my recommendation.** Three reasons, and the owner's instinct for
separation is answered by the third.

- **It is the shape that already worked twice.** **Held** and **Reserve** are one
  renderer over two stretches, built that way deliberately in 3.147.0, and the
  five passes deliver their judging stretch in the held slot so nothing
  downstream needs to know. Two screens that describe the same thing and disagree
  leave the owner no way to tell which is lying, which is the argument of RULE
  TWO.
- **A new tab doubles a vocabulary surface.** Every control on it needs a word
  list generated from the box, and two screens of near-identical labels is how
  "one job, two names" comes back.
- **What separation is actually for** is stopping the two passes' records being
  confused, and that is solved by the record carrying its pass, not by the screen
  being duplicated. With the pass on the record, every table, choice and set says
  which pass it belongs to, on one screen, and a reader in a year can still tell.

Concretely:

- **On History**, a choice of which stretch the table's money is measured on: the
  test window as today, or the held window for the second pass. The retrain
  trains on what precedes it either way and the reserve is untouched in both.
- **On Tune**, the windows are already ticked per scan; what is added is that
  **every choice records the windows it was chosen over**, printed beside it.
- **Every record grows one field**: which pass. A half-life table, a half-life
  set, a stop choice, a sizing choice, a cap choice.

### The alternative, honestly

Two tabs is not hard and not wrong. It costs two more entries in the tab list,
one more renderer or one called twice, two more help entries, two generated word
lists, and a rule about which tab may open which set. The gain is that a
second-pass record can never be mistaken for a first-pass one by somebody reading
carelessly. **The owner decides. If they say two tabs, the build is the same work
plus the tab plumbing and the release plan does not otherwise change.**

## B2 — What it buys, and what it spends

Everything on **Tune** today is chosen on data ending where the test window ends
and judged on the held window, which is honest. Those choices then go forward to
the reserve, which is also honest, and there is one reserve and it can be spent
once.

**With a second pass the order becomes: choose on train and test, judge on held;
then choose again on train, test and held, and judge on the reserve.** The reserve
is still spent once, but what it judges is a set of choices that has already
survived a window it did not see.

**The cost is stated plainly: after the second pass has been judged on the
reserve, that rule has no unseen window left, ever.** There is no third pass to
be had, and no amount of building makes one.

### The success rule, written before any number

B is right if a choice made under the second pass, judged on the reserve, does
better than the same choice made under the first pass and judged on the reserve.
**Written down now: if the second pass does no better, the tunings are not
carrying out of sample at all, and the honest conclusion is to stop tuning rather
than to tune twice.** That is the finding I would most want and least expect.

## B3 — Six things in the way, all of them known

Read out of the files named. **None is a reason not to build it. Each is a cost
the owner should see before the loop starts.**

1. **The splitter it needs was deleted too.** The comment in `lib/bracketwork.js`
   records it: "(A splitter with no held-back slice at all, `splitAndLabelAt`, sat
   here for the 72% retrain layout from 3.94.0 to 3.142.0; both went together.)"
   The current splitters always carve a test and a held slice off the end of what
   they are handed. One has to be written again.
2. **It is impossible on a set with no reserve, and must refuse in words.** A
   70/15/15 layout seals nothing, so there is no reserve to judge on. Only a
   61/13/13/13 set can carry a second pass judged on the reserve.
3. **The half-life run file's version refuses across judges on purpose.** It is at
   3 and its own comment explains why: a version 2 file was judged on the held
   window, "so a set built from its table would be a choice made on held — the
   one thing this screen no longer does; it reads as absent... RULE NINE: no
   reader translates it; a held reading cannot become a test one." **So a
   reserve-judged run is either a new version, which makes the owner's existing
   half-life table read as absent, or a per-run marker that all six readers of
   that file honour.** I recommend the marker, and the six readers are the work.
4. **A guard will fire and has to learn a distinction.** The run throws if any
   pricing came back with held-back figures, because History never reads that
   window. The only door to the reserve puts it IN the held slot. So the guard has
   to tell "read the held window" from "read the reserve in the held window's
   slot".
5. **The money arrives in a different slot.** The table reads the test figures
   today; under the reserve door the figures arrive where the held ones would, and
   the window comes back on the job rather than off the parent's record.
6. **Judging on the reserve makes it a counted look, and History stamps none
   today.** The reserve's look count is assembled from board pricings, rides and
   capture reads. A retrain judged on the reserve is a look and has to be stamped
   so **Reserve** counts it.

**And one thing that is genuinely easy, which is worth saying because it is the
part that sounds hard:** a choice can carry which pass it came from as one extra
field, and every one of the eleven places that read a choice projects named
fields rather than enumerating them, so an extra field rides through all of them
untouched. What is *not* safe is a second choice for the same survivor: that slot
is single, both writers own it outright, and no reader has a selection step.

### The digit

Second for the pass choice and the pass stamp. A record with no pass stamp reads
as the first pass, which is what it was — a statement of fact, not a legacy
branch. **The one thing that would move the first digit is bumping the half-life
run file's version**, which is why item 3 recommends the marker instead.

---

# C — the two new sizing controls

Both are the owner's, spoken 2026-09-16. Both live on the conviction sizing panel
on **Tune**, beside the sizing that is there.

## C1 — A forced sit-out below an agreement floor

**The owner's words:** "not withstanding all other rules, force sit-out until an
agreement of at least x".

### What it does

Below the floor, no trade, whatever every other rule says. At or above it, the
trade happens as it otherwise would.

### Which side of the scale line, and where it has to live

**It changes which trades happen, one clip a trade. It is the stop's kind of
control, not the sizing's**, so it is read into the reading against copies and
comparisons that also bet one clip.

But there is a choice about depth and it must be made deliberately:

- **As a filter over the capture** it changes the money and nothing else — not the
  trade count on the record, not the four comparisons, not the scrambled copies,
  not the beat and the lead. Cheap, instant, honest if the screen says so. Same
  standing as the stop has today.
- **As a gate in the pricing path** — in the stream that turns member calls into
  one call, or in the capture loop — it changes which trades exist, and then
  every one of those figures follows. That is a stage 3 re-run.

**I recommend the filter first**, because it can be judged on the owner's
existing sets the same day, with the gate as a later release if the filter earns
it.

### Three mechanics that have to be handled, from reading the code

1. **The agreement can be zero.** Its range is zero to the number of members, and
   zero is reachable through the `trained` way of adding calls up, which takes the
   sign of a lean sum without forming a majority at all. **A floor stated as
   "below x" must say what it does with zero explicitly.**
2. **The multiplier lookup treats an out-of-range agreement as one clip.** A
   missing rung falls back to a multiplier of one, so an agreement of zero is
   currently bet at full size. Any floor expressed as a zero rung in the ladder
   has to survive that fallback.
3. **The sweep's bucket table starts at an agreement of one**, so trades at zero
   sit in no bucket while still counting in the totals. A floor that reads the
   buckets has to say which population it is quoting.

### What to show beside the box, so the floor is not chosen on noise

The conviction sweep already builds one bucket per agreement count, each carrying
how many trades fell in it, how many won, and a flag when there are fewer than
ten. **A floor set at a level holding four trades is a floor chosen on four
trades. The bucket's count and the thin flag must be on screen beside the box.**

### What has to be decided

- **A count or a share.** I recommend a count, because the buckets the owner reads
  are counts, and a share would be resolved to a count for the screen anyway.
- **Whether a floor may be set with no sizing applied.** I recommend yes. A forced
  sit-out is useful alone, and tying it to the sizing is the kind of hidden
  coupling this system keeps removing.

## C2 — A ladder that starts at one at the first level that passes

**The owner's words:** "apply trade sizing from 1 to n starting at first agreement
level pass".

### What it does today, and why the owner is right to want it changed

The ladder is one clip per agreeing member and the multiplier is the agreement
itself, capped at the member count. On a unit of ten members an agreement of
three bets three clips and one of ten bets ten. Two consequences the owner has
already met:

- the money at risk varies tenfold across one survivor's own trades, which is what
  made one survivor read 2,557.73 where its plain money was 321.02;
- the low-agreement trades, the ones least worth taking, are still taken.

The owner's shape fixes both: **with a floor at f and a top at n, an agreement of
f bets one clip, f plus one bets two, and so on, capped at n.** Below the floor,
nothing, which is C1.

### The one real obstacle, found in the code

**"The first agreement level that passes" and the agreement the sizing reads are
on two different scales.** The level a setting needs is on its own rule's scale: a
sum of fractional weights for `voices`, a lean sum for `conviction` and `trained`,
a count of evidence families for `families`, and for a bar read from the setting's
own history it need not even be a whole number. The agreement the sizing reads is
a plain head count of members. **The two are directly comparable only when the
rule is `count` at the shared bar.**

Three ways out, and the owner should pick one:

1. **Offer the control only where it is meaningful** — the `count` rule at the
   shared bar — and refuse in words elsewhere. Cheapest and honest.
2. **Let the floor be the owner's own number** rather than the setting's level, so
   nothing has to be compared. Nearly free, and it is what C1 already is.
3. **Capture a second number per trade on the rule's own scale**, beside the head
   count, so the two can be compared properly. It is the right answer and it is a
   change to the capture's shape, which means the records move with it (RULE NINE).

**I recommend 2 for the first release and 3 as its own later release if the owner
wants the level itself to drive the ladder.** Worth knowing: the level is already
carried on the capture's survivor rows and is simply not passed to the sweep, so
option 3 is smaller than it sounds.

### Where it belongs

**It changes how much is bet, so it stays out of every average and every
comparison**, under the rule settled in 3.156.0. Its money is worked out, written
on the set per survivor, carried to a greenlight, and printed beside the untuned
money with the clips a trade it deploys.

### What has to be decided

- **What the top defaults to.** The members of the unit is the obvious default and
  makes the new shape a strict generalisation of the old one when the floor is
  one.
- **Whether the top may exceed the members.** I recommend not: a multiplier higher
  than the number of voices has nothing behind it.

### The one figure that would let the sizing into an average one day

The sweep already works out, per agreement level, the money the level made over
the money put to work in it, and the ladder scales both by the same multiplier,
so **that rate is the same number whether the book is sized or not**. If the owner
ever wants a sized survivor back inside an average, that rate is what should be
averaged and the dollars never are. Not proposed here; recorded so the door is
findable.

## C3 — How the controls compose, in one order

Fixed now, before anything is built, so no result can be talked into a different
order afterwards:

1. **The agreement floor** decides whether the trade happens at all.
2. **The one-sidedness cap of A4**, if applied, decides whether a trade that
   passed the floor is stood aside for balance.
3. **The protective stop** decides how the trade that happens ends.
4. **The ladder** decides how much was bet on it.

Steps 1 to 3 are read into every reading at one clip a trade. Step 4 is recorded
and shown and enters no average and no comparison.

## C4 — None of this reaches the live path, and that must be said on screen

The live path computes each member's call and reports it, and **derives no
agreement count and sizes nothing**: an intent carries one flat clip. A greenlight
records the frozen sizing as evidence and nothing in the live code reads it back.

**So every control in Part C is a lab control until the live path is taught to
honour it**, and teaching it is its own release touching the signal, the intent
and the executor's own limit on clip size. Until then the screens must not imply
otherwise. The existing wording is already careful — the sizing's own hover text
says nothing is applied to any trading machine — and the new controls must be
just as careful.

---

# The releases, with the rule for each written before its numbers

Each is a release on its own, each ships and deploys on its own, and each is
useful if the loop stops after it.

### Release 1 — the lean, measured (A1). Second digit.

Side and money lean per survivor per window, read off the capture, on the set and
on three screens, with its coverage printed beside it. Nothing re-priced.

**Pass:** the figures reproduce by hand from the capture to the cent, and the held
reading of the rule in section 1 shows a long lean.
**Fail, and informative:** the held lean is near zero, and section 1's explanation
is wrong.

### Release 2 — the agreement floor and the new ladder (C1, C2). Second digit.

Both controls on **Tune**, saved per survivor, the floor read into the readings at
one clip a trade as a filter over the capture, the ladder recorded and never
averaged, the zero-agreement case handled explicitly, the bucket count and thin
flag beside the floor box, and the composition order of C3 enforced in code and
stated on screen.

**Pass:** on the rule of section 1, with a floor applied, the money changes by
exactly the sum of the trades below the floor, checkable by hand; the untuned
money beside it is unchanged; and the screen says which figures the filter does
not move.

### Release 3 — the one-sidedness cap (A4). Second digit.

The third control of the stop's kind, as a filter over the capture.

**Pass:** the lean of release 1 moves toward zero on the window the cap is applied
to, and the money changes by exactly the trades stood aside.

### Release 4 — the pass choice and the pass stamp (B1, B2). Second digit.

**History** measures its table on the test window or the held window at the
owner's choice. Every table, set and choice records its pass. **Tune** prints the
windows a choice was chosen over.

**Pass:** two tables from one rule under two passes, both on the box at once, each
reading back its own pass, neither readable as the other.

### Release 5 — the training choices (A2a, A3). Second digit.

The class weighting that is already written, wired through as a choice; and the
two-sided band as another value of the band choice. Both recorded, neither
replacing what is there.

**Pass:** on a fresh small chain, up-calls and down-calls over the training window
come out within a few per cent while the dormant share stays near a third, and
release 1's lean falls, with the held money reported whatever it does.

### Release 6 — the drift-relative target (A2b). First digit, or the refusals written first.

What a member is trained to want. **This is the one release in the document whose
digit is not mine to choose**, for the reason set out under A2: nothing on disk
would refuse a record trained under a different target, so either the first digit
moves and every chain on the box is thrown away, or the missing comparison is
written into about eleven readers first and the target becomes a recorded choice
that refuses a mismatch in words.

**Before this release starts, what is on disk is read and the cost is put to the
owner in writing** (RULE ONE-C). If they choose the first digit, the loop stops
here and waits. If they choose the refusals, that is its own release ahead of
this one.

**Pass:** one stamped look at the reserve, on a rule trained this way at the unit
of section 1, losing less than the rule of section 1 did. One look, and the rule
for it written before it is taken.

### The order, and why

Releases 1, 2 and 3 need no new run of anything and can be judged on the owner's
existing sets the same day. Release 4 makes the tunings judgeable out of sample.
Releases 5 and 6 each need a fresh chain and are where the compute is. **If the
loop runs out of night, it should stop after 4.**

---

# What the owner has to decide before a loop starts

1. **One screen with a pass choice, or History2 and Tune2 as separate tabs** (B1).
2. **Whether the agreement floor is a count or a share** (C1).
3. **Which way out of the scale mismatch** the ladder takes: offer the control
   only where it is meaningful, let the floor be the owner's own number, or
   capture a second number on the rule's scale (C2).
4. **What the ladder's top defaults to, and whether it may exceed the members**
   (C2).
5. **Whether the lean is ever a gate.** This document proposes it never is.
6. **Whether release 6 is in the loop at all**, given it needs a fresh chain.
7. **Whether the floor and the cap ever move into the pricing path**, which is a
   stage 3 re-run, or stay as readings over the capture.
8. **For release 6, the first digit or the refusals.** Move the first digit and
   throw away every chain on the box, or write the missing comparison into every
   reader so a record says which target trained it and a mismatch refuses. The
   second is more work and is the RULE NINE answer. **Neither is a session's call
   and the loop stops at this release until it is made.**

Nothing else here needs the owner mid-loop. Every other choice is naming, file
layout, test structure and ordering, which are the session's to make and to record
(RULE SIX).

# What I am assuming

- **That the capture on the box is complete enough to measure the lean.** The rule
  of section 1 carries one; a rule without one says so rather than guessing.
- **That the fee is the fee.** Every number in section 1 is at the fee the set was
  priced at, and the cost of being in the market scales with it.
- **That one unit's reserve is one observation.** Section 1 is a single coin at a
  single shape over one falling window. Every conclusion here is drawn from it and
  would be stronger from more.
- **That releases 1 to 5 do not need the first digit, and that release 6 does.**
  The first part is checked. The second is argued under A2 from the fact that
  nothing on disk would refuse a target change, and it is the single claim in this
  document I would most want a second pair of eyes on before anything is built.

# What it costs

- Releases 1, 2 and 3: an evening each at most, no compute on the owner's data.
- Release 4: a day, and a re-press of **History** to get a second-pass table.
- Release 5: a day to build, then a fresh stage 1, 2 and 3 run to see anything.
- Release 6: the same, plus either the cost of a first-digit move, which is
  every chain on the box, or a release of its own to write the refusals. And the
  reserve spent once on the answer.

**Not one of these has been measured.** They are estimates and they are mine.

# The risks, and they are mine

- **The lean may be the money.** If a rule's edge over always long comes entirely
  from being long in a rising market, taking the lean out takes the money out, and
  the honest end of this document is that the system had less than it looked.
  Release 5's success rule is written to expose exactly that, before the number
  exists.
- **Four controls on one survivor is four ways to fit one window.** The floor, the
  cap, the stop and the ladder can each be chosen to flatter the held window, and
  together they can flatter it a great deal. **Part B is the only thing here that
  defends against that, which is why it is release 4 and not release 7.**
- **One reserve, spent once.** Every release after 4 has one honest look at a
  given rule's reserve. After that, that rule's reserve is a window the choosing
  has seen.
- **A filter over the capture is not a re-pricing, and it would be easy to let the
  screen blur that.** Three of the controls proposed here change the money without
  changing the trade count, the comparisons or the copies. Every one of them has
  to say so on screen, every time.

---

# Appendix — what each release touches, so one loop can be handed the whole thing

At this level because the owner wants to fire one loop from start to finish. A
session inside the loop still makes its own choices about naming, file layout,
test structure and ordering (RULE SIX). This is the map, not the orders.

**Every release ends with the same ship sequence, and it is not optional:** the
narrowest check that can fail run first and the ladder climbed from there (RULE
EIGHT), then the whole suite, then the commit with the release number moved in
the same commit (RULE ONE-C), then both branches pushed, then the deploy and its
health line read, then the served record captured and the word lists regenerated
from what the box serves (RULE ONE-A), then the mutation guards in a separate
worktree, which never hold the deploy.

### Release 1 — the lean, measured

- A function that reads a capture and returns, per survivor per window, the counts
  and money by side and the two lean figures, called where the tuned block is
  built so it rides a path that already exists; the block gains a lean section
  carrying its own coverage.
- Nothing in the verdict module. **The lean is not a gate and must not enter it.**
- On the screens: one note and two columns on the survivors table, drawn by a
  helper with braces so the word-list walk reads the text (the lesson of the
  own-hold cell), and two columns on the picture.
- One help entry under **Held** and **Reserve**, one under **Greenlight**.
- Test: a fabricated chain, a capture whose entries are known by hand, the lean
  read back to the cent, and a survivor with no capture reading as not recorded.
- Guard: on the line that counts the sides, aimed at the test that reads the lean
  back — **the test that exercises the behaviour, not the one with the nearest
  name** (RULE EIGHT).

### Release 2 — the agreement floor and the new ladder

- The sizing choice gains a floor and a top; a setter for the floor that works
  with no sizing applied; the money path drops entries below the floor before
  pricing and works the multiplier out from the floor and the top.
- The zero-agreement case handled where the multiplier is looked up, explicitly,
  with a test that reaches it.
- On the screen: two number boxes, an apply and a clear each, the reason boxes,
  the bucket count and the thin flag beside the floor, and the green "your choice"
  line saying the floor and the ladder's shape.
- Test: the composition order of C3 exercised on a fabricated capture where the
  floor drops a known trade and the stop changes a known one, and the money moves
  by exactly their sum.

### Release 3 — the one-sidedness cap

- The cap in the same per-survivor record, applied after the floor and before the
  stop, at one clip a trade, marked as read into the reading.
- On the screen: one box, an apply and a clear, the reason box, and the cap named
  in the survivors table's tunings cell.
- Test: a capture with a known one-sided run, the cap standing aside exactly the
  trades it should.

### Release 4 — the pass choice and the pass stamp

- **The layout is the piece to get right, and the code remembers it.** The 72%
  retrain layout that trained through the held slice and judged on the reserve was
  deleted in 3.142.0; the commit that removed it is the best specification
  available and should be read before a line is written. The reserve is sealed
  before any pass cuts, so this is a layout, not a pass.
- The retrain run and the set builder carry the pass; the table and the set record
  it; the stop and sizing setters record the windows a choice was chosen over.
- On the screen: the choice on **History**, the pass printed on every table, set
  and choice, and the windows printed beside a choice on **Tune**.
- Test: two tables from one rule under two passes, both on disk, each reading back
  its own pass, neither readable as the other.
- **If the owner chooses two tabs instead**: the tab list, the dispatcher, the
  renderer, the help entries, a generated word list each, and the rule for which
  tab may open which set.

### Release 5 — the training choices

- Wire the class weighting that is already written into the trainer the sweep
  actually uses, as a choice, passed beside the example weights that already
  travel there. **Read the comment above it first: it explains why it was left
  unreachable.**
- The two-sided band as another value of the band choice, fitted on the training
  chunks only, recorded on the set.
- On the screen: both choices on **Sweep**, both recorded and printed.
- Test: a fabricated window deliberately tilted one way, the up-call and
  down-call counts level with the choice on and tilted with it off, and the
  dormant share still near a third.
- **Read defect 4 of the next section before writing any measurement that touches
  a chunk's label.**

### Release 6 — the drift-relative target

- Where a chunk becomes a training label, the drift subtracted, as a choice.
- Every set records which target it was trained on, and the screens print it.
- Test: on a fabricated rising window, a model trained the new way calls both
  sides where the old way calls one.
- **This is the release to stop and think at.** It changes what a forecast means
  and the reserve judges it once.

---

# Defects found while writing this. Reported, not fixed.

Each was read out of the file named. **None is authorised and none has been
touched** (RULE ZERO). They are here so they are not lost, and the owner decides
if and when any is worth a release.

**Read the first one today. It can bite the owner on the set they are holding.**

1. **Pressing the stop's reason button wipes the sizing off a survivor.** The two
   writers disagree: the one that records a stop REPLACES the survivor's whole
   choice, while the one that records a sizing MERGES into it. So applying a stop
   to a survivor that already carries a sizing deletes the sizing silently — and
   so does `Save the reason`, which re-posts the stop to save nothing but the
   words. No test covers the two writers on one survivor; they are exercised in
   two different test functions with two different fixtures.
   `lib/stages.js:8213-8215` against `lib/stages.js:8244-8250`.
   **This matters now**: the half-life set on the box carries a sizing on
   "conviction 50% own market t89h · argmax auto 24/7", and one press of the stop
   controls on that survivor would remove it without a word.
2. **A trade with no member agreeing is sized at a full clip.** The multiplier
   lookup falls back to one when the agreement is out of the ladder's range, and
   an agreement of zero indexes before the start of the ladder. Zero is reachable
   through the `trained` way of adding calls up, which takes the sign of a lean
   sum without forming a majority. `lib/convictionsweep.js`, `multFor`;
   `lib/agreement.js:162-166`.
2. **The sweep's bucket table loses those same trades while still counting their
   money.** The bucket loop starts at an agreement of one, so zero-agreement
   trades appear in no bucket and in every total. `lib/convictionsweep.js`.
3. **A near-copy default in the live path is undefined.** One line reads a default
   from the committee module that the module does not export; the real default
   lives in the agreement module. It is currently unreachable because a valid
   configuration always supplies the value, so it reads as a working default and
   is not one. `lib/live/stagesignal.js:41`.
4. **The reserve chunks keep a band-free label.** The path that rebuilds them
   never relabels at the fitted band, so their label is the raw sign of the move.
   Harmless today, because calls there come from saved models and pricing reads
   the unit's own band — **but any new measurement that read a chunk's label on
   the reserve would read the wrong thing**, which is a trap directly in the way
   of Part A. `lib/stagework.js:820-828`.
5. **Half a committee can be trained one way and half another, which the engine's
   own comment forbids.** A stage 2 set whose missing units are filled in later
   inherits the training choices from the parent rather than comparing them, and
   the guard that lines a filled unit up against the parent's stored votes
   **compares timestamps only**, so a set trained under a changed choice lines up
   perfectly and is accepted. The comment beside it says what that would be: "half
   a committee trained on direction and half on money would be two different
   committees wearing one name". **This hole is open today for the training choice
   that already exists, not only for the one Part A proposes.**
   `lib/stagework.js:684-694`, `lib/stages.js:1525`.
6. **A stale comment points at a layout that is gone.** A line in the chunk
   builder still says the retrain layout's judge is the reserve; it has judged on
   the test window since 3.144.0. Worth correcting because Part B reads exactly
   there. `lib/stagework.js`.

---

# What is NOT in this document

- The trend design of `TREND-TRAINING-DESIGN.md`. It is the larger answer to the
  same problem and is untouched here.
- Any change to the verdict's gate. The lean is a reading, not a bar.
- Any name for any control described here. They do not exist, so they have no
  names (RULE ONE).
- Teaching the live path to size a trade. Named in C4 as its own release and not
  designed here.
- The served record and the word lists, which are a step of every release's ship
  and not a design question.
