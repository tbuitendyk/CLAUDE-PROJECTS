# The Funnel — design

Written 2026-08-31 on the owner's `GO NOW!` for a detailed design, revised the
same day on the owner's direction that the Funnel builds the missing numbers
rather than stage 3 storing them. Nothing in here is built. No code, no schema
change, no deploy has happened.

The owner's rulings, taken as given:

1. Position of the "does it hold" step is my judgement — **but it must work on a
   single-coin probe.**
2. The Funnel **must run with no null set**, whether or not the stages feeding
   it declared one.
3. The tab is **Funnel**. Its output is **Stage 4** data.
4. **The Funnel builds the missing numbers on demand.** Stage 3 does not grow.
5. **A field sets the target size** of the resulting record set.
6. **No restrictions** on an empty or one-setting result — warn, never refuse.

---

## 1. What this is, and the hole it fills

Stage 3 produces a fully enumerated grid: every declared setting priced on every
coin. The owner's last set was 524,832 settings over 10 units — 5,248,320
records, ~412,000 rows on the every-coin table.

Nothing carries out of it. `lib/stages.js` says so in its own comment:

> nothing carries out of stage 3, so the sort is only how the table reads.

So the only way from that grid to a candidate is a person sorting a table and
picking a row by eye. That is the fluke-finding machine, not the analysis — and
at half a million rows it is not humanly possible anyway.

The Funnel is the missing step. It sits between Boards and Verify, walks a fixed
sequence of readings over the stage 3 grid, and writes a **Stage 4** record set
holding the settings that survived, the rule that selected them, and the record
of every look taken to get there.

**What makes this possible here and impossible on the old board:** the grid is
FULL FACTORIAL. Every setting was priced, not just a search winner. Grouping the
rows by any one dial therefore averages evenly over all the others, which is
what makes a marginal reading of that dial honest. A search-based board cannot
do any of what follows, because its rows are a biased sample of its own menu.

---

## 2. The governing decision

**The Funnel reads TEST money. The held-back window is opened once, at the end,
on what survives.**

Stage 3 already stores both per record — `avg test $` and `avg held-back $` sit
side by side on Table 3.A today. So this costs nothing to adopt.

It is also the system's own stated principle, from `lib/bracketwork.js`:

> Select on search, judge on holdout, and never let money pick the rung you then
> evaluate as a predictor.

Today the eyeball selection happens on held-back numbers, which spends them. Six
steps of narrowing on test money spends nothing, and the held-back read at the
end means what it says.

**Consequence for the interface:** every money figure shown during steps 1–6 is
test money and must be labelled as such on the screen. The held-back columns are
not shown during the funnel at all. Showing them would re-open the exact hole
this decision closes.

---

## 3. Every step reports three things, and shows the distance to target

The three-part contract is what satisfies ruling 2.

| | What it is | When available |
|---|---|---|
| **The reading** | The step's own answer | Always |
| **Split-half agreement** | The same reading computed on two disjoint halves of the data — do they say the same thing? | Always. Needs no null set and no extra capture. |
| **The noise twin** | The same reading on the set's noise boards | Only when the parent set carries them |

**Split-half is the workhorse when there is no null set.** It answers a real
question — "would I have reached this conclusion from the other half of my
data?" — and it costs one extra pass. A dial that looks decisive on one half and
does nothing on the other is noise, and you learn that without any null
machinery at all.

The halving rule per step is stated with each step below. The split is seeded
from the Stage 4 set's own id so it is reproducible, the same way stage 3's
deals are seeded from theirs.

**When there is no noise twin, the page says so on every step** — not by omitting
a column, but by naming the absence. A missing comparison that shows as a blank
reads as "nothing to report", which is the opposite of the truth.

**Split-half is weaker than a noise twin** and the page says so where it stands
in for one. It tests whether a reading is stable, not whether the effect is real.

### The target size (ruling 5)

A field on the tab sets how many settings the Funnel is aiming to end with. It
is a TARGET, not a cut. From the moment it is set, every step shows the current
survivor count against it, so the owner can see whether they are narrowing too
fast or too slowly while there is still time to change course.

It never trims anything on its own. What happens when the rule overshoots is
decided at step 7 (§5.7), by the owner, from three named options.

---

## 4. The missing numbers — built by the Funnel, not stored by stage 3

**Stage 3's record shape does not change.** This is ruling 4 and it is the right
architecture for a reason beyond cost: stage 3's job is to price the grid, and
these numbers are analysis inputs. Analysis belongs to Stage 4.

### 4.1 Why on-demand works

Two pieces of machinery already exist and are in use:

- `s3Payload({ …, settings })` takes an arbitrary SUBSET of settings. The
  fill-in path already prices subsets this way.
- The backfill door in `lib/stagework.js` rebuilds a unit off its stage 2 parent
  and walks the same streams without pricing everything: *"A set priced before
  this was measured can still have it: the votes are on its stage 2 parent and
  the answer never depended on the trade shape."*

So the Funnel, at the step that needs them, rebuilds the units once and prices
only the survivors. Rebuilding a unit is the expensive part and there are ten of
them; pricing a few thousand narrowed settings against them is seconds.

### 4.2 What gets built

All of these are already computed inside the pricing pass and thrown away. None
adds meaningful work.

**From `simCell`** — `lib/bracket.js:339` returns eight numbers; stage 3 keeps
`pnl, trades` on test and `pnl, trades, stops` on held-back:

- `ambiguous` / `trailAmbiguous` — the old census: *"How much of the result rests
  on an unknowable within-bar ordering. Meaningless to report money without
  it."* A candidate at 128 stops on 150 trades is unreadable without this.
- `wins`, `grossPerTrade` — the old census: *"A system can be right more often
  than noise and still lose, if its mistakes are larger than its wins."*
- `unpriced` — bars that could not be priced. Currently invisible.

**New, and free, because `simCell` already walks trades in chronological order
accumulating `pnl` one at a time.** A running minimum inside that same loop:

- `maxDrawdown` — the deepest the running total ever sat below its own high
- `worstTrade`, `bestTrade`
- `pnlThirds` — the money in each of three equal slices of the window

`pnlThirds` is the single most valuable addition for a **single-coin probe**: it
answers "did the money come from the whole window or from one lucky month?" when
there are no other coins to check against.

From `lib/convictionsweep.js`, on why the exposure numbers matter:

> $ totals flatter big clips, so exposure-honest metrics ride along: return per
> deployed dollar, worst single trade, max drawdown of the cumulative book, and
> the PEAK CONCURRENT notional.

Peak concurrent notional is NOT included. It depends on position overlap and is
not free. Parked, and named as absent on the screen.

**From `holdControls`** — `lib/bracket.js:364` computes four benchmarks;
stage 3 keeps one, as `avg vs always-long $`:

- `alwaysShort`, `buyHold`, `shortHold`

`lib/bracket.js:344`:

> The objection every result on this board has to answer: "you did not find a
> strategy, you found an asset that went up." Owner's proposed answer, and it is
> the right one — put long-and-hold and short-and-hold on the same window and
> make the strategy beat them.

Buy-and-hold is the comparison a crypto result owes most and it is currently
calculated and discarded.

**Denominators** — how many periods each window held, and how many the 24/5 mask
dropped. `$248` has no meaning without the count of periods behind it.

**The null set's shape** — `beat`, `pairs` and `lead` are stored, but since
`lead = (real − mean) / spread` that is one equation with two unknowns, so
neither the noise average nor its spread is recoverable. Both are rebuilt: the
shuffles are a pure function of the set's id (`seedOf` is a hash of the name, the
shuffle is seeded Fisher-Yates), so a survivor's deals re-price exactly.

### 4.3 The backfill proves itself

Every rebuild recomputes `pnl` and `trades` alongside the new numbers and
compares them to what stage 3 stored.

**A mismatch means the rebuild is not the same run** — the price files moved, or
the engine did. It refuses and says which setting disagreed and by how much. It
never writes numbers from a different world beside numbers from this one.
Stage 3 launch already carries a guard of this shape for the votes: *"stage 2
votes do not line up with the rebuilt chunks — the price files changed underneath
the set."*

It also **refuses to backfill across a first-digit release change**, and stamps
which release computed each rebuilt number.

### 4.4 Where the rebuilt numbers live

**In the Stage 4 set. Never back into the stage 3 store.**

The row store's columns only ever grow, and rows written before a growth read
back short. So backfilling only the survivors into stage 3 would leave two record
shapes on disk — some rows carrying the new columns, some not. That is precisely
the two-vocabularies-on-disk problem RULE NINE forbids.

Stage 3 stays immutable and uniform. The enriched rows are Stage 4's, written
once and cached there, so a second pass over the same Funnel set costs nothing.

### 4.5 The kept scrambles — a whole board made of luck

**Every noise comparison in this design wants the same thing**: not a summary
number, but a COMPLETE SECOND COPY of the tables, made entirely of luck, so that
each reading can be taken twice and compared. Six places want it — steps 1, 2, 3,
4, 5 and Verify's board null — and one mechanism serves them all.

**The mechanism: keep the money from a few of the scrambles.** A run already
builds `null set size` scrambled copies of the calendar. Store, per priced row,
the money that row made in the first N of them, and every one of those six
readings can be run a second time against pure luck.

**Rounded to cents on purpose.** One stored row measures 623 characters; a raw
double is 18 of them and gzips badly because the digits are noise. These figures
are only ever averaged, curved, gridded and region-searched — a cent is far below
any difference that could matter. Ten kept scrambles at cents is about +22% on
the store; the same ten raw would be +61%.

#### What the scrambles cost, measured not guessed

**The held-back money is free. The test money is not.** The pricing loop scrambles
ONLY the held-back window (`lib/stagework.js`, `streamFor(..., d, 'hold')`); every
call on the test window passes deal index `-1`, the real calendar. The Funnel runs
on TEST money (§2) precisely so the held-back window stays sealed until step 7 —
so its noise twin needs test-window scrambles, and those are new pricing.

| Kept | What it adds | Cost |
|---|---|---|
| the held-back figures | nothing — already computed inside the `beat` loop and discarded | free |
| N test-window scrambles | N pricings per setting per unit | about N% on a run that already prices ~101 times per setting per unit |

Measured on the owner's set (2026-08-31): 5,248,320 priced rows, 332,572,800
pricings, 12.63 hours on 4 workers — about 7,300 pricings a second. Ten kept
scrambles is 52.5M more pricings, so **about two hours** to backfill, and about
10% longer for a fresh run.

#### It CAN be backfilled

The earlier claim that this "cannot be built afterwards" was wrong, twice over.
The scrambles are a pure function of the set's id (`seedOf` is a hash of the name,
the shuffle is a seeded Fisher-Yates), so scramble number N is identical every
time, forever. Re-pricing the test window under those same orders reproduces
exactly what the run would have written.

Backfilling is therefore a RULE NINE migration, not a re-run: price the kept
scrambles for every existing row, write the store BESIDE with the same row count
and the same block boundaries so every stored block index still points where it
did, verify, then swap. The real test money is re-priced alongside and checked
against what is stored — §4.3's self-proof — so a moved price file cannot slip in
silently.

#### Release digit: SECOND, not first

Nothing already on disk stops being readable or comparable. No existing number
changes, no existing record changes shape, and each block of the row store
carries its own column list in its own header, so blocks written before the
column read back exactly as they do now. The set document already records whether
the capture happened (`boardNull`), so no reader branches on a record's age.
Stage 1 and stage 2 sets stay valid parents.

That control belongs on Sweep, in the `Stage 3 — price any settings from the kept
votes, no training` panel, beside that panel's `null set size`, with its cost
printed.

---

## 5. How the current data fits

**The stage 3 row store does not change, so the owner's existing set fits the new
design exactly as it stands. There is nothing to migrate and nothing to re-run.**

Steps 1 to 5 of the Funnel read `pnl` and `trades`, which every existing record
already carries. Step 6 is where the rebuild button lives, and it operates on
whatever has survived by then.

Two fields are added to the stage 3 **set document** — not to the records:

| Field | Why | Existing sets |
|---|---|---|
| the sealed reserve's boundaries | Stage 3 seals the final 13% of history and never records where. Without this the one-touch grade has nothing to bind to. | Recomputable exactly from the stored parameters (`unitChunks` is deterministic), so a one-pass migration of the set documents fills it in |
| whether board-wide noise was captured, and if not, why not | So a reader never has to ask which era a set is from | Written as "not captured — this set predates the reading" |

Both are written on EVERY set, old and new, so no reader ever branches on the
record's age (RULE NINE). Set documents are small; the migration is one cheap
pass and touches no records.

**And subsequent stage 1–3 runs need change nothing either.** The numbers in §4.2
stay unstored by design — a new run and an old run present the Funnel with the
same shape, and the Funnel rebuilds either. One code path, one record shape,
forever. The only thing a new run can offer that an old one cannot is §4.5's
board-wide noise, and that is a control the owner sets at launch.

---

## 6. The Funnel, step by step

Grain: steps 1, 2, 3, 5, 6 read the **setting** grain (Table 3.A's grain). Step 4
reads the **setting × coin** grain (Table 3.B's grain). Both come from the tally
already built.

Throughout, "money" means test money (§2).

### 6.1 Step 1 — which dials move the result at all

For each dial — decision, band, 24/5, entry, gate, d, t, trail, arm, and each
agreement dial — group the surviving settings by that dial's value and compute:

```
gᵢ  = mean money of the group at value vᵢ,  nᵢ = its count
ḡ   = Σ nᵢ gᵢ / N
B   = sqrt( Σ nᵢ (gᵢ − ḡ)² / N )        between-value spread
W   = sqrt( Σ Σ (x − gᵢ)² / N )         within-value spread
M   = B / W                              movement
```

Present dials ordered by `M`, each with its dollar range (`max gᵢ − min gᵢ`). A
ratio with no magnitude beside it is unreadable.

- **Split-half:** random halves of the settings, seeded. Report whether the top
  three dials agree between halves. Disagreement at step 1 means the funnel
  should not proceed, and the page must say that in those words.
- **Noise twin:** the same `M` per dial on the pooled noise board.

**What the owner does:** nothing is cut here. This step chooses which dials the
next steps ask about. Typically most of fifteen dials do nothing, and that is
the largest single collapse of the space — reached without choosing a value.

**Caution the page must print:** at half a million rows every dial shows some
movement. The ORDERING is the finding. The magnitude is a claim only against the
noise twin or the split-half.

### 6.2 Step 2 — the shape of each surviving dial

For each dial carried forward, mean money by value, with counts and the
within-value spread.

Ordered dials (d, t, trail, arm, band %, agreement share, and the copy dial) get
a curve and a mechanical shape class:

| Class | Rule |
|---|---|
| flat | `max gᵢ − min gᵢ < W` |
| monotone | ordered along the axis, no reversal larger than `W/2` |
| hill / valley | one interior extreme, falling on both sides |
| spike | best value beats both neighbours by more than `2W`; the rest sit within `W` of each other |
| ragged | none of the above |

Categorical dials (decision, entry, gate, agreement rule, 24/5) get a bar list
ordered by money with counts.

- **Split-half:** the same curve on each half, drawn together. Two curves of the
  same shape is the finding; two different shapes is noise.
- **Noise twin:** the noise board's curve on the same axes.

**What the owner does:** picks a RANGE on each dial, never a single value. The
page may suggest one; it never applies one (RULE FIVE).

**Why a range:** a hill or a monotone ramp is a relationship. A spike at one
value is what luck looks like, and picking its peak is the shopping the whole
design exists to avoid.

### 6.3 Step 3 — do the dials interact

For the top three dials by `M`, three grids: mean money by dial A × dial B, with
the count in each square.

**The thin-square floor.** Some squares are built from thousands of settings and
some from two. A square built from two tells you nothing, but it looks like every
other square — and it will often be the best-looking square on the grid, because
small groups swing further. So a floor is set: below it, the square greys out and
prints how many settings it had.

**The floor is a field, and the page shows what each choice costs** before it is
set: "240 squares; a floor of 20 keeps 187, a floor of 50 keeps 94." Choosing
blind is what this whole tab exists to end. The starting value is labelled
GUESSED, per the project's convention that every threshold says whether it was
derived or guessed.

- **Split-half:** the same grid on each half; report the share of squares that
  agree in sign.
- **Noise twin:** the noise board's grid.

### 6.4 Step 4 — does it hold when what you did NOT choose changes

**Positioned fourth, deliberately.** Before this step the survivors are still a
wide region, so a consistency check has something to be consistent across. Run
earlier it tests a set so wide the answer is always yes; run later, a set so
narrow the answer is always no.

**The axis is chosen automatically from what the set actually contains**, in this
priority order, and the page NAMES which one it used:

1. **coins**, if the set holds more than one
2. **chunk shapes**, if more than one
3. **time thirds**, from `pnlThirds` (§4.2)
4. **the free dials** — those the rule has not fixed

**This is the single-coin probe path (ruling 1).** With one coin the step falls to
chunk shapes, then to time thirds, then to the free dials, automatically, and
prints which check it made and that it is a weaker one. It never silently skips
and it never silently produces a meaningless "1 of 1 positive".

Report per slice: mean money, the headline **how many slices out of how many are
positive**, and the worst slice. The same thin-square floor applies — a coin with
three settings left in it is not a slice, it is a rounding error, and it greys
out with its count shown.

- **Split-half:** halve the slices where there are enough; below four slices say
  so rather than halving into nonsense.
- **Noise twin:** how many slices a noise region gets positive by chance.

### 6.5 Step 5 — plateau or knife edge

Run `lib/plateau.js` `widestRegion` on the survivors. Report region size, the
region's **interior centre** — not its peak; the library already refuses to hand
back the maximum, for the right reason — plus cells considered and cells
clearing.

**Required change to `plateau.js`:** its `ORDERED_AXES` is a module constant
naming `quorum`, which is not a stage 3 field — the agreement dials replaced it.
The axis list must come from the caller. That is also RULE FIVE: which dials have
an order is a property of the run, not of the library.

- **Split-half:** region size on each half.
- **Noise twin:** the widest region each kept scramble produces — the same region
  search, run on the all-luck copy of the same table (§4.5). This is what makes
  the number a finding rather than an adjective. With one kept scramble, "wider
  than luck" is a single draw; with ten it is ten out of ten, which is the point
  of the count being a field and not a constant.

### 6.6 Step 6 — exposure

**This is where the rebuild happens** (§4). The button says how many settings it
will re-price and roughly how long, before it runs.

Then the ugly-path numbers: max drawdown, worst single trade, stops per trade,
trade count, ambiguous bars. Shown as distributions across the survivors, not as
means — a mean drawdown hides the row that would have ended you.

The owner sets floors. Dollar totals flatter; this is where an unacceptable path
is cut regardless of its total.

### 6.7 Step 7 — declare and cut

The choices made in steps 2, 3, 4 and 6 ARE the rule. The page states it back as
one sentence and shows the survivor count against the target size.

**If the rule overshoots the target, three options, all offered, none removed
(rulings 5 and 6):**

| Option | What it does | What it costs |
|---|---|---|
| accept the rule's answer | Ignore the target | Nothing. The target was only ever a guide. |
| tighten toward the middle | Narrow each range a step at a time, widest-effect dial first, moving inward from both ends — never toward the best value | Little. It keeps the region's interior, which is the defensible part. |
| take the top N by a column | Rank and slice | **The most.** This is shopping, on the very board the funnel exists to stop you shopping. It is offered because removing the owner's choice is the fault RULE ZERO and RULE FIVE exist to prevent — and it is labelled exactly this plainly on the screen. |

Whichever is used is recorded on the Stage 4 set, so the reserve grade at the end
knows what it is judging.

**An empty or one-setting result is written with a warning, never refused**
(ruling 6).

One press writes the Stage 4 set.

**Then, and not before, the held-back window is read** — once, on the survivors —
and reported beside the test figures that selected them.

---

## 7. The Stage 4 record set

Id `s4-<slug>-<n>`, in `data/stagesets`, alongside `s1-`, `s2-`, `s3-`, with its
rows in the same block store the other stages use.

It holds:

- the parent stage 3 set id, and the release that set was written under
- the release this Funnel run was made under
- **the steps, in order**: what each showed, what was chosen, and when
- **the back-steps**, also in order — going back and re-choosing is more looking,
  and the record must not hide it
- the target size, and which of the three closing options was used
- per-step survivor counts: real, split-half, and noise where present
- **whether a noise twin existed at all**, as a first-class field
- the thin-square floor that was set
- the surviving settings, by label and by their parent's setting index
- **the rebuilt numbers** from §4.2, with the release that computed them and the
  proof that test money and trades matched what stage 3 stored
- the sealed reserve's boundaries, carried from the parent
- the held-back reading taken at step 7, stamped as the first held-back read

**A Stage 4 set must be replayable.** Re-running its recorded steps against its
parent must yield exactly the same survivors. That is a test, not a hope.

Several Stage 4 sets may hang off one parent. They are record sets like any
other and the existing delete and parent-protection rails apply unchanged.

---

## 8. What reads a Stage 4 set

This replaces the broken "selected row" path. `doc.selection` is written only by
`POST /api/bracketlab/:id/select`, which **no screen calls** — Verify, History,
Tune and Greenlight all gate on it and it can never be set. Rather than repair
that, every one of them comes to read a Stage 4 set instead.

| Reader | What it takes from the set |
|---|---|
| Verify — the board null | The rule, and the same rule's result on each noise board |
| History Tuning / age dial | The surviving settings, one at a time |
| Tune — stop tuner, conviction sizing | Per-trade detail, captured for these settings only |
| Compare | Pairs of survivors differing in exactly one dial — answerable inside the grid, for free |
| The one-touch reserve grade | The sealed boundaries plus the rule, stamped before the seal is opened |
| Greenlight | The evidence chain: this set's id and each tool's verdict on it |

**Per-trade capture is a Stage 4 job.** Entry time, direction, agreement count,
return, deepest adverse move and stop-hit for 524,832 settings is unaffordable.
For a few dozen survivors it is nothing. This is the cost control that makes the
stop tuner and conviction sizing reachable at all, and it is the same rebuild
mechanism as §4, one level deeper.

---

## 9. Interface

A new tab between Boards and Verify. `TABS` in `public/construct.js:219` becomes
nine entries, `['funnel', 'Funnel']` inserted after `boards`.

Layout:

- A rail across the top: the seven steps, each showing its survivor count, the
  current one marked. Steps not yet reached are inert. Going back is allowed and
  is recorded.
- One step visible at a time, filling the panel. Each step: the question in one
  line, the view, the reading, the split-half beside it, the noise twin beside
  that or a plain statement of its absence, and the controls for the owner's
  choice.
- A standing line, always visible: which stage 3 set is open, how many settings
  survive, the target size and the distance to it, and **that every money figure
  on this tab is test money**.
- The rule so far, in words, always visible.

Alignment: match the pattern the page already uses — grep the class before
relying on it, and never introduce a second convention beside the existing one
(RULE FOUR).

Word list: a new tab gets its own generated list under RULE ONE-A. It cannot be
generated until the tab is deployed and `SERVED.json` re-fingerprinted — the
generator reads what the box serves, not the repo. **No control on this tab may
be named to the owner until that has happened.**

---

## 10. Honest limits — printed on the tab, not buried here

**The Funnel is itself a search.** Seven steps of choosing is seven chances to
shop, and the design does not pretend otherwise. Three things limit the damage
and all three are in the design above:

1. It runs on test money, so the held-back window is untouched until step 7.
2. Every step carries a split-half and, where available, a noise twin — so a
   funnel that is finding nothing says so at step 1, not after a week.
3. Every choice and every back-step is recorded in order, so the reserve grade
   at the end knows how much looking preceded it.

**It is a template on purpose.** The same seven steps every time, so two hunts
are comparable. Not a free-form explorer.

**Peak concurrent notional is absent** (§4.2) and is named as absent.

**Rebuilt numbers are computed by later code than the numbers beside them.**
§4.3's self-check and the first-digit refusal are what keep that honest, and the
Stage 4 set records which release computed what.

---

## 11. Release numbering

Under ruling 4 the stage 3 record shape does not change, so **nothing on disk
stops being readable and no first-digit bump is owed**. This is second-digit
work: new behaviour, new controls, a new record kind.

The set-document migration in §5 adds fields to small JSON documents and touches
no records. It runs the way the totalling already does — announced, in the
background, once — and it is a user function, not a script somebody remembers
(RULE NINE).

**There is no first-digit item in this design.** §4.5's kept scrambles were
listed as one and are not: they add columns, change no existing number, and leave
every existing block readable. Second digit, like the rest.

---

## 12. Tests, and what each one reads

Under RULE EIGHT, a guard names the test that reads the line it breaks.

| Test | What it asserts |
|---|---|
| `everyNumberTheSimulatorReturnsIsStoredOrRebuildable` | Reads the return shapes of `simCell` and `holdControls` and fails on any field that is neither stored, rebuilt, nor listed as deliberately dropped. **This is the test that would have prevented this whole episode.** |
| `theFunnelNeverReadsHeldBackMoneyBeforeStepSeven` | Scans the funnel's own code path for the held-back fields |
| `aFunnelSetReplaysToTheSameSurvivors` | Re-runs a recorded step list against its parent and compares |
| `aRebuildThatDisagreesWithTheStoredMoneyRefuses` | Fixture where the rebuild differs; asserts it refuses and names the setting |
| `everyStepReportsSplitHalfWithNoNullSet` | Runs the whole funnel on a set built with `null set size` 0 and asserts every step still answers |
| `theHoldsAcrossStepNamesTheAxisItUsed` | Single-coin fixture: asserts it falls through to chunk shapes / thirds / free dials and says which |
| `theHoldsAcrossStepRefusesAOneSliceAnswer` | Asserts it never prints "1 of 1 positive" |
| `thinSquaresGreyOutAndShowTheirCount` | Grid fixture below the floor |
| `theFloorPageShowsWhatEachChoiceCosts` | Asserts the survivor-count-per-floor readout exists |
| `plateauTakesItsAxesFromTheCaller` | Asserts `quorum` is not hardcoded |
| `aFunnelSetRecordsItsBackSteps` | Going back and re-choosing appears in the record |
| `aFunnelSetRecordsWhichClosingOptionWasUsed` | All three of §6.7 |
| `anEmptyResultIsWrittenWithAWarning` | Asserts it is not refused |
| `theTabSaysWhenThereIsNoNoiseTwin` | Source scan: the absence is named, not blank |
| `everySetDocumentCarriesTheReserveBoundsAndTheNoiseFlag` | Both directions — no reader branches on a set's age |
| `drawdownAndWorstTradeComeOutOfTheSameWalk` | Fixture with a known equity path |
| `pnlThirdsSumToThePnl` | Arithmetic guard |

Mutation guards go on the lines those tests read, and are run filtered
(`node tests/mutate-servicecontrol.js <fragment>`), never as the whole harness.

---

## 13. Build order

1. `plateau.js` axes from the caller, with its test.
2. The set-document migration: reserve bounds and the noise flag on every set.
3. The rebuild path — subset re-pricing off the stage 2 parent, with §4.3's
   self-proof. Testable headless.
4. The Stage 4 record kind and its store.
5. The seven funnel steps as pure functions, tested headless before any screen
   exists. **This is where the design either works or does not**, and it is
   provable without a tab.
6. The tab.
7. Deploy, re-fingerprint, generate the Funnel word list.
8. Re-point Verify, History, Tune and Greenlight at Stage 4 sets.
9. §4.5's kept scrambles: the field on Sweep, the columns on the row store, the
   matching columns on `Table 3.A` and `Table 3.B`, the Funnel reading against
   them, and the backfill for sets priced before the column existed. Second
   digit. Owner ordered it at ten kept, backfill included, 2026-08-31.
10. §15's auto mode: the mode switch, the narrowing choice, the automatic walk
    through steps 1-6, the scrambled-copy run beside it, and the machine-made
    marks on every recorded step. Second digit. Owner ordered the design
    2026-09-01 and said it may be revised before any of it is coded, so nothing
    here is a build order until they say otherwise.
11. §16's guided walk: the check drawn beside every reading (it is claimed and
    not drawn today), the recommendation pre-filled from that check, a box per
    value for the seven word-valued dials, pickers on step 3, a block control on
    the grid, an accept on step 4, `keep the widest region` on step 5, the
    ladder on step 6, and marks on the Stage 4 set. Second digit. Comes BEFORE
    item 10: auto mode has nothing to do at steps 3-5 until this exists.

Steps 1–4 produce nothing the owner can see. Step 5 is the one that matters.

---

## 14. Decisions taken, for the record

| Question | Owner's answer |
|---|---|
| Thin-square floor | A field, with the page showing what each choice keeps. Starting value labelled GUESSED. |
| How many survivors to aim at | A target-size field, live from step 1, never auto-trimming. Three named ways to close a gap at step 7. |
| Empty or one-setting result | Write it with a warning. No restrictions. |
| Where the missing numbers come from | The Funnel rebuilds them on demand. Stage 3 does not grow. |
| Should there be an auto mode | Yes — a second way to run the tab (§15). Not built; may be revised before coding. |
| What auto mode ends with | It writes the RULE and stops on `7. declare and cut`, waiting for approval to write the record set. |
| Split-half disagreement under auto | Carry on and mark it. It does not stop the walk, and the mark rides on the set. |
| How auto narrows a dial | The owner's choice, per run: the middle of what was swept, or the best value. The second is shopping and says so. |
| Which closing auto uses | None chosen up front. It stops and offers all three, exactly as the manual walk does. |
| What the recommendation at each step is built from | The check §3 already names — scrambled copies when kept, the split-half otherwise — and nothing else. Sign agreement only; no margin, no multiple, no threshold. The owner refused a third mechanism with a chosen multiple in it (2026-09-02). |
| Steps 3, 4 and 5 | Get controls: box a block on the grid; accept across slices with a recorded mark; keep the widest region. Step 5's middle is a rule and gets a button (§16). |
| Marks | Recorded observations the walk was carried past; they ride on the Stage 4 set and print wherever it is read (§16.5). |

---

## 15. Auto mode — a second way to run the tab (owner order, 2026-09-01)

**NOT BUILT. This section is the agreed design, and the owner has said it may be
revised before any of it is coded.**

The owner's words: "some kind of auto mode where the software probes the various
dials, the effectiveness of narrowing the selections is done as an initial test.
And then there's some kind of iterative process which runs through all the steps
heading for the selected target size automatically. It would be a second mode of
operation for the funnel page."

### 15.1 What it does

Steps 1 to 6, walked by the machine toward `target size`. Then it **stops on
`7. declare and cut` and hands the walk back**, with the rule it arrived at,
the survivor count, and every choice it made written into the record as steps.

Step 7 is untouched and gains nothing: the owner gets the same
`how to reach the target` list with the same three options, the same count, the
same `write the Stage 4 set` button. Auto mode stops exactly where the manual
walk stops.

That is one stopping point, not two. The owner first asked for a choice between
the two narrowing closings up front, then revised it: "that should probably be a
stopping point where we can choose one of the three options just like when we
run the funnel manually." Because auto mode is chasing the target by definition,
`accept what the rule gives` still appears — the owner may take whatever the
automatic rule reached and go no further.

**It never writes the record set on its own.** Owner's answer to question one:
"it's going to write the rule and stop and wait for the approval to write the
record set."

### 15.2 THE RULE THAT KEEPS IT HONEST: it may not choose by money

The tab exists to stop the owner shopping a board of half a million settings. A
machine that tries many narrowings and keeps the best-looking one is shopping at
machine speed, which is strictly worse than doing it by hand — it can try more
and it leaves no memory of what it rejected.

So auto mode may only decide using what the manual walk already decides on:

- which dials move the result, in the step 1 ordering;
- whether the two halves agree;
- how wide the surviving region is, and how deep inside it a setting sits;
- whether a dial's values were swept evenly.

It may never prefer a range because that range made more money. The one
exception is the option in §15.4 that the owner asked for explicitly, and that
option says what it is in its own label.

### 15.3 Its defence is the scrambled copies

Auto mode runs its **whole procedure twice** — once on the board, once on a
scrambled copy of it (§4.5) — and reports both. `nullCopy` and the single
`applyRule` already make this possible: the procedure is a sequence of rules,
and a rule applies to a scrambled copy exactly as it applies to the real board.

If the same procedure reaches the target on luck alone with a result that looks
comparable, the procedure found nothing, and **auto mode says so rather than
handing over a rule**. A set is still writable — RULE ZERO, the owner decides —
but the tab must not present a fitted-to-noise rule as a finding.

**On a set with no kept scrambles auto mode falls through to the split-half,
exactly as every step does (§3), and carries the weaker-check mark.** An earlier
draft of this paragraph said it must refuse to report at all; that contradicted
§3, which names the split-half as the workhorse when there is no null set, and
the owner struck it (2026-09-02). It still says which control on Sweep would
have kept scrambles, because the stronger check was available and was not
bought.

### 15.4 The one automatic choice the owner asked to control

Owner's answer to question three: a choice between narrowing a dial to **the
middle of what was swept** and narrowing it to **the best value**.

- **Middle of what was swept** — the same arithmetic as
  `tighten the ranges toward the middle`: give up the outermost value from BOTH
  ends, one at a time. Keeps the interior of a region, which is what makes a
  wide region defensible. Never looks at the money.
- **Best value** — keeps the best-averaging value of each dial. **This is
  shopping, on every dial, automatically.** It is offered because the owner
  asked for it and removing a choice is the fault RULE ZERO and RULE FIVE exist
  to prevent. It must carry the cost in its own label, the way
  `take the top N by a column (this is shopping)` does, so it cannot be chosen
  by accident. With it selected, §15.3's comparison is the only thing between
  the owner and a rule fitted to noise, which is why §15.3 refuses without it.

### 15.5 A disagreement at step 1 is marked, not fatal

Owner's answer to question two: "we carry on and mark if the split half
disagrees at step one."

The manual tab prints, at step 1, that nothing below means anything until the
halves agree. Auto mode does not stop on it. It marks the run, carries the mark
onto the Stage 4 set beside the rule, and the mark is not clearable — a walk
that began on a disagreement is a different kind of evidence from one that did
not, and the reserve grade at the end of the chain has to be able to see it.

### 15.6 The record is the same record

Every automatic choice is written with `recordStep`, in the same shape a manual
choice is written, plus a flag saying a machine made it. Every time the
procedure narrows and then widens again is a back-step and is written with
`recordBackStep`. A machine that walked back forty times has seen far more of
the board than an owner who walked forward once, and the one-touch reserve grade
can only count what was written down.

### 15.7 What is NOT settled

- The starting control and the mode switch have no names. Under RULE ONE-A no
  control here may be named to the owner until it is built, deployed and
  `SERVED.json` re-fingerprinted.
- The stopping condition when the target cannot be reached without collapsing a
  range — `tightenRule` already stops honestly and says so; the automatic walk
  needs the same behaviour agreed across all six steps, not just the ranges.
- Whether auto mode may set the exposure limits at step 6 at all, or must leave
  `worst losing streak allowed` and `fewest trades` to the owner.
- Whether the two runs in §15.3 should be one scrambled copy or all of the kept
  ones. All of them is the stronger claim and costs a pass over every setting
  per copy.

---

## 16. The guided walk — every step makes its decision (owner order, 2026-09-02)

**NOT BUILT.** Where this section and §6 differ on what a step shows or what
control it has, this section wins; §6 stays as the record of what is built and
why it was built that way.

The owner's words: "the point of the funnel is to give a step by step guided
process to finding a set of strong candidates to move forward to Verify,
History, and Tune tabs. The point is not to look at screens of data and 'guess'
what might help and walk it back and forth trying to find the best zone. It is
supposed to be an actual guided *process* that actually *helps* the decision
making process at each point ... controls with visual results on each screen
where all of the necessary decisions can be made."

And the question that exposed it: "if nothing is actually done on those sub
steps, what is the point of them exactly?" Only two of the seven steps cut
anything today — `2. the shape of a dial` adds ranges, `exposure` adds limits.
Steps 1, 3, 4 and 5 are readings with no control: the owner looks, forms a
judgement, and walks back to step 2 to act on it by hand. Nothing records that
they looked or what they concluded.

### 16.1 The principle every step is held to

> Each step asks ONE question, shows the evidence beside the same evidence from
> the check, recommends an answer derived from that check — never from the
> peak — and has one control that records the decision and shows what it does
> to the count. The owner's job at each step is to accept or override, not to
> hunt.

"The check" is the one §3 already names: the scrambled copies when the set
carries them, the split-half when it does not. The page says which it used and
that the second is weaker. Nothing in this section adds a third.

### 16.2 The recommendation comes from the check, and from nothing else

§6.2 already allows a suggestion ("the page may suggest one; it never applies
one"). This says how it is made, and the rule is that it is made from the SAME
mechanism the check uses, so there is never a number to choose:

- **With kept scrambles:** a value counts if its real average beats its
  scrambled average on every kept copy. Recommend the widest run of neighbouring
  values that count.
- **Without:** a value counts if it sits above the dial's own overall average on
  BOTH halves of the settings. Recommend the widest run of neighbouring values
  that count.

Sign agreement only. No multiple, no margin, no wobble formula. The one figure
on the screen is K, the number of kept copies, and the page prints what K is
worth: at 0, *cannot be checked against scrambled copies — set `null set money kept` on
Sweep before the run; the two halves were used instead*; at 1, *a single draw*;
at more, a count.

The same construction gives the block at step 3 (the largest rectangle of
squares that count, clearing the thin floor) and needs nothing at step 5, where
the widest region already is the recommendation.

**The corner that was cut and refused (2026-09-02), recorded so it is not
proposed again:** a "margin scaled to the scatter" — the real average beating
the scrambled one by a chosen multiple of the average's wobble. That is a third
mechanism beside the two §3 names, it has a number in it somebody has to pick,
and it was proposed because the design had not been read. The owner: "If we
have nulls, we want to use them. If we don't have nulls, then you are going to
split the hold data ... don't cut corners."

The recommendation is pre-filled into the step's own controls. It is never
applied on its own (RULE FIVE).

### 16.3 What was found that does not work today

Three defects, logged in `DEFECTS.md` under 2026-09-02:

1. **The bold comparison heading on steps 1-3 is a false claim.** It prints "the
   same reading on 1 of this set's 10 scrambled copies of the table is drawn
   beside", and nothing is drawn beside. The reading is computed in
   `funnelRead` (`out.reading.noise.reading`) and never rendered. Only step 5
   shows numbers from its check.
2. **Seven of the fifteen dials cannot be narrowed from the screen.** `decision`,
   `weekdaysOnly`, `entry`, `gate`, `agreeRule`, `agreeBar` and `agreeBoth` have
   words for values. `applyRule` handles them through `allowed`; nothing on the
   screen writes `allowed`. `keep from` / `to` cannot express "gate is active or
   always".
3. **Steps 3, 4 and 5 have no control, and step 5 prints the region's middle as
   raw JSON.** The middle is a set of dial values — it is a rule — and the
   system already treats exactly this as a first-class choice elsewhere
   (`widest region` on the Greenlight anchor list).

### 16.4 Step by step

**Step 1 — which dials move the result**

- *Decision:* which dial to narrow next, and in what order.
- *Shown:* the table as now, plus the check drawn beside it: **how many of the
  dial's values make more money than that same value on every scrambled copy**
  (or sit above both halves' averages) — step 2's own test, rolled up. A dial
  with none is greyed however far apart its piles sit.

  **Corrected 2026-09-02, after the first run.** The first build bolded a dial
  when its `movement` beat the scrambled copies' movement. Movement has no
  direction: on the owner's board `gate` was bold because the real forecast
  made two of its three values LOSE more than a shuffle does — the piles sat
  further apart, in the wrong direction — and step 2 then had nothing to keep.
  Owner: "why would you attract a view to a set-up that varies from the null
  set IN THE WRONG DIRECTION?" A bold row on step 1 must be a bold row waiting
  on step 2, so it is now the same test.
- *Control:* each row enters step 2 with that dial chosen. The `dial` list on
  step 2 stays, for override.
- *Recorded:* the order the dials were taken in. Marks: the halves disagreed;
  the leading dial was not evenly swept.

**Step 2 — the shape of a dial**

- *Decision:* which range to keep — or, for a word-valued dial, which values.
- *Shown:* the value table with the check's `avg test` beside the real one and
  the number of settings each value carries forward; `keep from` / `to`
  pre-filled with §16.2's recommendation; a live line as the boxes are edited:
  *this range keeps N of M — target T*.
- *Control:* `add this range to the rule` as now. For a word-valued dial, a box
  per value, writing `allowed` — the missing half of the rule.
- *Recorded:* the range or the values; whether the recommendation was accepted
  or edited, and to what; the shape word. Mark: the shape was a spike.

**Step 3 — do two dials interact**

- *Decision:* whether the range on one dial depends on the other, and if so,
  box both at once.
- *Shown:* two pickers, not typed names (RULE FIVE — the choices come from the
  engine), defaulted to step 1's top two. The grid, thin squares marked, with
  the check's grid beside it. The recommended block highlighted.
- *Control:* choose a block of squares — corner to corner — and it becomes
  ranges on both dials in one recorded step.
- *Recorded:* the block. Mark: the best block is not the product of the two
  single-dial ranges — the dials interact.

**Step 4 — does it hold elsewhere**

- *Decision:* accept the rule across the slices it was read on, or go back.
- *Shown:* `N of M` positive as now, beside the check's `N of M`. If both say
  five of six, five of six is what the scrambled copies give.
- *Control:* an explicit accept.
- *Recorded:* the mark, in words: *accepted 4 of 6 positive; the check managed
  3 of 6*.

**Step 5 — a plateau or a knife edge**

- *Decision:* keep the widest region.
- *Shown:* the region's bounds as a from/to table per dial, never JSON; its size
  against the check — the widest region on every kept copy, or the size on each
  half; what keeping it would leave against the target.
- *Control:* keep the widest region. It replaces the rule's ranges (and
  `allowed`, for the region's word-valued dials) with the region's bounds. One
  recorded step.
- *Recorded:* size, the check's figure. Mark: not wider than every copy, or not
  wider on both halves.

**Step 6 — exposure**

- *Decision:* the two limits, as now.
- *Shown:* for each limit, a ladder — what each threshold would keep — in the
  form step 3's floor line already uses. The number is set with its cost
  visible.
- *Control:* as now.
- *Recorded:* as now, plus the count each limit kept.

**Step 7 — declare and cut.** As built in 3.38.0. Unchanged.

### 16.5 Marks

A mark is a recorded observation that the walk was carried past. The full list:
the halves disagreed at step 1; the leading dial was not evenly swept; a kept
range had a spike shape; the dials interact and the single-dial ranges were kept
anyway; accepted N of M slices; the region was not wider than the check; the
check used was the split-half because no scrambles were kept; a step was walked
back (already recorded as a back-step).

Marks ride on the Stage 4 set beside the rule and print wherever the set is
read — Verify, History, Tune and Greenlight (§8) — so a rule walked past a
disagreement is visibly thinner evidence than one that was not, everywhere it
is used. They are never clearable.

### 16.6 What this does to §15

Auto mode "walks steps 1 to 6" now has content at steps 3, 4 and 5, which it did
not: it takes §16.2's recommendation at each of them, records the same marks a
manual walk would, and stops on step 7. And §15.3 no longer refuses on a set
with no kept scrambles; it falls through to the split-half like everything else.
§16 is therefore built BEFORE §15 (build order, item 11).

### 16.7 Open, for the owner

1. **Step 4 — may the rule exclude a coin** from what goes forward? A coin is a
   unit, not a dial; that is a new kind of clause and the Stage 4 readers would
   have to honour it.
2. **Step 3 — the block replaces the single-dial ranges it covers?** Proposed
   yes, recorded as such.
3. **Marks — acknowledged to move on, or recorded silently** on leaving the step?
4. **"Every kept copy" or a share of them?** Proposed every copy, with K printed.
   At K = 1 that is one of one, and the page says so.

---

## 17. One rule per coin-and-shape unit — ten rules, not one (owner order, 2026-09-02)

**The owner's words:** "i don't trust your theory that jumbling all of the coin
+ shape configs together into a set for the dial tunings makes any sense at
all. who says that they are going to behave the same way? you? the market
doesn't agree. you're just adding noise to a system that is looking for PER
COIN signal." And, on the shape of the answer: "IT'S ONE RULE PER COIN+SHAPE
-- 10 RULES, NOT 5."

**The data agreed before the design did.** The same gate question, asked per
coin from the records: XRPUSDT's `active` beats every one of the ten scrambled
copies (+2.51 against -8.79..1.40); BCHUSDT daily-4d's beats nine; DOGEUSDT's
`directional` beats none anywhere. The blended board showed `active` at -1.33
and nothing to keep. Averaging the units into one row per setting destroyed
exactly the signal the system exists to find, and `does it hold elsewhere`,
asked afterwards, cannot recover what step 2 has already thrown away.

### 17.1 The unit is the board

The Funnel walks **one coin-and-shape unit at a time**. The board for a unit is
that unit's records -- one per setting, every dial on it, its own test money,
its own ten kept figures. A Stage 4 set is cut **per unit** and carries the
unit; ten units make ten sets. That is what Verify, History and Tune consume
per coin anyway (§8).

**Why the records and not Table 3.B.** The per-coin table folds the eight
settings that share a name prefix and differ only in `decision` and `band %
(or auto)` into one row (658,560 rows for 5,248,320 records, `rows: 8`). A
per-unit walk on it would be blind to two dials. The records hold one row per
setting per unit with every dial named (decision record 9), in contiguous
stretches per unit, so a unit's board is a read of its blocks and nothing
else: no join, no new table, no totals rebuild.

### 17.2 The board is read once per unit and held once

`loadUnitBoard(id, unit)` reads the unit's blocks -- the union of the block
indexes the per-coin table records for that unit -- and maps each record to a
board row in the shape every reading already takes: the dials, `avgTest` from
the record's test money, `avgHold` and `avgTrades` from its held-back result,
`noiseTest` and `noiseHold`, `beat` and `pairs`, and the rest of the blended
row's measures read from the one record (`avgVsLong`, `avgLead`, `avgRung`,
`avgVoices`, `coinsInMoney`), so a column means the same thing on both boards.
`avgAgreed` is not carried: it lives in the agreed sidecar and a board is read
from the records alone. One unit's board is held in memory at a time -- 524,832
rows for this set, one record per setting per unit, about 200 MB measured;
choosing another unit lets the first go. Reading a unit yields between blocks
so the pages keep answering. **The walk opens on the set's first unit.** The
blended board stays available as one more choice -- `all units together`,
chosen by name -- because removing a choice is the fault RULE FIVE exists to
prevent; nothing is walked on it unless it is asked for.

### 17.3 What changes per step

- **Every reading** (steps 1-3, 5, 6) runs on the unit's board exactly as it
  ran on the blend. The check is the unit's own ten kept figures. Nothing in
  §16 changes here except the rows underneath it.
- **Step 4 becomes what it was meant to be.** `does it hold elsewhere` applies
  the rule to each of the OTHER units' boards -- loaded one at a time and let
  go -- and reports, per unit, the survivors' average test money and whether
  it is positive, beside the same on the unit's scrambled copies. It is a
  pressed action, not part of the automatic read: every other board is one
  read. It is started in the background and polled, the totalling's shape,
  because nine boards is about a minute and the web server in front allows a
  request sixty seconds; the line beside the button counts the boards read. The count of other units positive, and of those whose
  survivors beat every one of their own copies, and the accept mark stay. The
  rule is applied with the rebuilt numbers laid on per unit, so a limit on the
  worst losing streak reads each unit's own.
- **The cut** records the unit on the set, by key and by name, and names the
  set for its unit unless the owner types a name; the replay loads the unit's
  board. The read and the cut resolve the board through one function, so the
  board walked and the board cut cannot be two boards.
- **The picker** sits on the standing line beside `target size`, offering the
  set's units by the names the set was launched with. The walk's state is
  kept per unit, so ten walks can be in flight and none forgets its place.

### 17.3a The rebuilt numbers are kept per unit

The numbers rebuilt at step 6 are kept beside the set per setting, as the
average across units AND per unit. A unit's board lays on the unit's own; the
blend lays on the average. That is a new shape for the file, so it carries a
new version, and a file of the older shape reads as absent: the screen offers
the rebuild again and writes it back in today's shape. Derived, so rebuilt,
never translated (RULE NINE).

### 17.4 Not in this build, said plainly

- The tables' own `beat the kept null money` column compares the real money to
  the kept figures without the cents rule (3.40.1) and is wrong on every
  always-gate row -- 0 or 10 at random. It needs a totals rebuild
  (`TALLY_V` 7) and the totalling's memory has to be fixed first (DEFECTS.md,
  01:44). Deferred, logged.
- The per-coin table's eight-settings-per-row fold is a fact about Table 3.B
  that predates the Funnel. Whether Boards should show one row per setting per
  unit is the owner's call.
- Auto mode (§15) runs per unit when it is built; nothing about it changes.
