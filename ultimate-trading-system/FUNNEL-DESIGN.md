# The Funnel — design

Written 2026-08-31 on the owner's `GO NOW!` for a detailed design. Nothing in
here is built. No code, no schema change, no deploy has happened.

The owner's three rulings, taken as given:

1. Position of the "does it hold" step is my judgement — **but it must work on a
   single-coin probe.**
2. The Funnel **must run with no null set**, whether or not the stages feeding
   it declared one.
3. The tab is **Funnel**. Its output is **Stage 4** data.

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

## 3. Every step reports three things

This is the uniform contract, and it is what satisfies ruling 2.

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

---

## 4. Part A — what Stage 3 must capture first

The Funnel cannot be built on the current record. These are the additions, each
with where the requirement was learned. All are already computed; none adds
meaningful compute.

### 4.1 From `simCell` — currently returns eight numbers, stage 3 keeps three

`lib/bracket.js:339` returns `pnl, trades, wins, stops, ambiguous,
trailAmbiguous, unpriced, grossPerTrade`. Stage 3 keeps `pnl, trades` on test
and `pnl, trades, stops` on held-back.

Store all eight, **on both windows**.

- `ambiguous` / `trailAmbiguous` — the old census: *"How much of the result rests
  on an unknowable within-bar ordering. Meaningless to report money without
  it."* A candidate at 128 stops on 150 trades is unreadable without this.
- `wins`, `grossPerTrade` — the old census: *"A system can be right more often
  than noise and still lose, if its mistakes are larger than its wins."*
- `unpriced` — bars that could not be priced. Currently invisible.

`lib/batch.js` stored `holdWins`, `holdGrossPerTrade`, `searchWins`,
`searchGrossPerTrade`, `searchStops` and `cellAmbiguous`. The three-stage system
dropped them. This restores them.

### 4.2 New from `simCell` — free, because it already walks trades in order

`simCell` accumulates `pnl` one trade at a time in chronological order. A running
minimum inside that same loop yields, at zero extra cost:

- `maxDrawdown` — the deepest the running total ever sat below its own high
- `worstTrade`, `bestTrade`
- `pnlThirds` — the money in each of three equal slices of the window

`pnlThirds` is the single most valuable addition for a **single-coin probe**: it
answers "did the money come from the whole window or from one lucky month?" when
there are no other coins to check against.

Rationale for the exposure numbers, from `lib/convictionsweep.js`:

> $ totals flatter big clips, so exposure-honest metrics ride along: return per
> deployed dollar, worst single trade, max drawdown of the cumulative book, and
> the PEAK CONCURRENT notional.

Peak concurrent notional is NOT included here — it depends on position overlap
and is not free. Parked, named as absent.

### 4.3 From `holdControls` — computes four, stage 3 keeps one

`lib/bracket.js:364` computes `alwaysLong`, `alwaysShort`, `buyHold`,
`shortHold`. Stage 3 keeps only `alwaysLong`, as `avg vs always-long $`. Keep
all four. They are cached per unit and per t, so this is three numbers and no
compute.

`lib/bracket.js:344`:

> The objection every result on this board has to answer: "you did not find a
> strategy, you found an asset that went up." Owner's proposed answer, and it is
> the right one — put long-and-hold and short-and-hold on the same window and
> make the strategy beat them.

Buy-and-hold is the comparison a crypto result owes most and it is currently
calculated and discarded.

### 4.4 Denominators

- how many periods each window held, and how many the 24/5 mask dropped
- a record for a setting that reached no trades, rather than silence — the old
  board's QC 74: *"recorded so the denominator stays honest"*

`$248` has no meaning without the count of periods behind it.

### 4.5 The null set's shape, not just its tally

Today: `beat`, `pairs`, `lead`. Since `lead = (real − mean) / spread`, that is one
equation with two unknowns, so neither the noise average nor its spread is
recoverable. Store both. Two numbers, no compute, and it turns "beat 661 of 800"
into an effect size in dollars.

Per-deal detail beyond that is NOT stored and does not need to be: the shuffles
are a pure function of the set's id (`seedOf` is a hash of the name, the shuffle
is seeded Fisher-Yates), so any single row's deals can be re-priced in seconds
off its stage 2 parent.

### 4.6 The sealed reserve

`unitChunks` seals the final 13% of history under `reserve61`. Stage 1 captures
it and passes it up. **Stage 3 does not even read it** — line 297 destructures
`geo, maps, split` and drops `reserve`.

Stage 3 must stamp the sealed window's boundaries on its record set, so that a
Stage 4 set can carry them and the one-touch grade has something to bind to.

This is a prerequisite, not part of the Funnel. Without it the chain has no final
judge — `startReserveGrade` lives only in `lib/batch.js` and refuses anything
that is not a History Tuning run.

### 4.7 Board-level noise information

For each shuffled world, what the best of the whole board did.

- **Cheap, always on:** per unit, per shuffle, the best money and the widest
  region size across all settings in that unit. ~2,000 numbers for a whole run.
  Combined across units it slightly overstates the noise board, which makes a
  real row work harder — a safe screen, never a flattering one.
- **Exact:** needs a settings × shuffles accumulator before the maximum. At 19
  shuffles that is ~10 million numbers and is feasible. At 100 it is ~52 million
  and I would argue against it.

Build the cheap one always. Make the exact one a control on Sweep beside
`null set size`, with its cost printed on the page.

---

## 5. Part B — the Funnel, step by step

Grain: steps 1, 2, 3, 5, 6 read the **setting** grain (Table 3.A's grain). Step 4
reads the **setting × coin** grain (Table 3.B's grain). Both come from the tally
already built.

Throughout, "money" means test money (§2).

### Step 1 — which dials move the result at all

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

### Step 2 — the shape of each surviving dial

For each dial carried forward from step 1, mean money by value, with counts and
the within-value spread.

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

### Step 3 — do the dials interact

For the top three dials by `M`, three grids: mean money by dial A × dial B, with
the count in each cell and a thin-count flag below a floor the owner sets.

This is where "short d only works with long t" becomes visible. It is invisible
in any ranked list.

- **Split-half:** the same grid on each half; report the share of cells that
  agree in sign.
- **Noise twin:** the noise board's grid.

### Step 4 — does it hold when what you did NOT choose changes

**Positioned here, fourth, deliberately.** Before this step the survivors are
still a wide region, so a consistency check has something to be consistent
across. Run earlier, it tests a set so wide the answer is always yes; run later,
it tests a set so narrow the answer is always no.

**The axis is chosen automatically from what the set actually contains**, in this
priority order, and the page NAMES which one it used:

1. **coins**, if the set holds more than one
2. **chunk shapes**, if more than one
3. **time thirds**, from `pnlThirds` (§4.2)
4. **the free dials** — those the rule has not fixed

**This is the single-coin probe path.** With one coin the step falls to chunk
shapes, then to time thirds, then to the free dials, automatically, and prints
which check it was able to make and that it is a weaker one. It never silently
skips and it never silently produces a meaningless "1 of 1 positive".

Report per slice: mean money, and the headline **how many slices out of how many
are positive**, plus the worst slice.

- **Split-half:** halve the slices where there are enough; below four slices say
  so rather than halving into nonsense.
- **Noise twin:** the same count on the noise board — how many slices a noise
  region gets positive by chance.

### Step 5 — plateau or knife edge

Run `lib/plateau.js` `widestRegion` on the survivors. Report region size, the
region's **interior centre** (not its peak — the library already refuses to hand
back the maximum, for the right reason), cells considered and cells clearing.

**Required change to `plateau.js`:** its `ORDERED_AXES` is a module constant
naming `quorum`, which is not a stage 3 field — the agreement dials replaced it.
The axis list must come from the caller. That is also RULE FIVE: which dials have
an order is a property of the run, not of the library.

- **Split-half:** region size on each half.
- **Noise twin:** the widest region each noise board produces. This is the
  comparison that makes the number a finding rather than an adjective, and it is
  exactly what §4.7's cheap capture provides.

### Step 6 — exposure

Now, and only now, the ugly-path numbers: max drawdown, worst single trade, stops
per trade, trade count. Shown as distributions across the survivors, not as a
mean — a mean drawdown hides the row that would have ended you.

The owner sets floors. Dollar totals flatter; this is where an unacceptable path
is cut regardless of its total.

### Step 7 — declare and cut

The choices made in steps 2, 3, 4 and 6 ARE the rule. The page states it back as
one sentence and shows the survivor count.

One press writes the **Stage 4** set.

**Then, and not before, the held-back window is read** — once, on the survivors —
and reported beside the test figures that selected them.

---

## 6. The Stage 4 record set

Id `s4-<slug>-<n>`, in `data/stagesets`, alongside `s1-`, `s2-`, `s3-`, with its
rows in the same block store the other stages use.

It holds:

- the parent stage 3 set id, and the release that set was written under
- the release this Funnel run was made under
- **the steps, in order**: what each showed, what was chosen, and when
- **the back-steps**, also in order — going back and re-choosing is more looking,
  and the record must not hide it
- per-step survivor counts: real, split-half, and noise where present
- **whether a noise twin existed at all**, as a first-class field
- the surviving settings, by label and by their parent's setting index
- the sealed reserve's boundaries, carried from the parent (§4.6)
- the held-back reading taken at step 7, stamped as the first held-back read

**A Stage 4 set must be replayable.** Re-running its recorded steps against its
parent must yield exactly the same survivors. That is a test, not a hope.

Several Stage 4 sets may hang off one parent. They are record sets like any
other and the existing delete and parent-protection rails apply unchanged.

---

## 7. What reads a Stage 4 set

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

**Per-trade capture is a Stage 4 job, not a stage 3 one.** Capturing entry time,
direction, agreement count, return, deepest adverse move and stop-hit for
524,832 settings is unaffordable. For a few dozen survivors it is nothing. This
is the cost control that makes the stop tuner and conviction sizing reachable at
all.

---

## 8. Interface

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
  survive, and **that every money figure on this tab is test money**.
- The rule so far, in words, always visible.

Alignment: match the pattern the page already uses — grep the class before
relying on it, and never introduce a second convention beside the existing one
(RULE FOUR).

Word list: a new tab gets its own generated list under RULE ONE-A. It cannot be
generated until the tab is deployed and `SERVED.json` re-fingerprinted — the
generator reads what the box serves, not the repo. No control on this tab may be
named to the owner until that has happened.

---

## 9. Honest limits — to be printed on the tab, not buried here

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

**Split-half is weaker than a noise twin** and the page must say so where it
stands in for one. It tests stability, not whether the effect exists.

**Peak concurrent notional is absent** (§4.2) and is named as absent.

---

## 10. Release numbering

Two parts, and they carry different costs (RULE ONE-C).

- **Part A** adds a new measurement block to the stage 3 record. That is the
  FIRST digit — `4.0.0` — and a stage refuses a parent written under a different
  first digit, so **every chain on the box refuses afterwards**. The owner has
  said the current data is being discarded, which is what makes this affordable.
- **Part B** — the Funnel tab and the Stage 4 record kind — is new behaviour and
  new controls: the second digit on its own.

Shipped together, `4.0.0` covers both.

**No migration is possible for Part A.** The numbers were never computed; there
is nothing on disk to translate. Under RULE NINE the alternative to migrating is
deleting, and that is the owner's call, already made.

---

## 11. Tests, and what each one reads

Under RULE EIGHT, a guard names the test that reads the line it breaks.

| Test | What it asserts |
|---|---|
| `everyNumberTheSimulatorReturnsIsStoredOrDerivable` | Reads the return shapes of `simCell` and `holdControls` and fails on any field that is neither stored nor listed as derivable. **This is the test that would have prevented this whole episode.** |
| `theFunnelNeverReadsHeldBackMoneyBeforeStepSeven` | Scans the funnel's own code path for the held-back fields |
| `aFunnelSetReplaysToTheSameSurvivors` | Re-runs a recorded step list against its parent and compares |
| `everyStepReportsSplitHalfWithNoNullSet` | Runs the whole funnel on a set built with `null set size` 0 and asserts every step still answers |
| `theHoldsAcrossStepNamesTheAxisItUsed` | Single-coin fixture: asserts it falls through to chunk shapes / thirds / free dials and says which |
| `theHoldsAcrossStepRefusesAOneSliceAnswer` | Asserts it never prints "1 of 1 positive" |
| `plateauTakesItsAxesFromTheCaller` | Asserts `quorum` is not hardcoded |
| `aFunnelSetRecordsItsBackSteps` | Going back and re-choosing appears in the record |
| `theTabSaysWhenThereIsNoNoiseTwin` | Source scan: the absence is named, not blank |
| `drawdownAndWorstTradeComeOutOfTheSameWalk` | Fixture with a known equity path |
| `pnlThirdsSumToThePnl` | Arithmetic guard |

Mutation guards go on the lines those tests read, and are run filtered
(`node tests/mutate-servicecontrol.js <fragment>`), never as the whole harness.

---

## 12. Build order

1. Part A capture in `lib/stagework.js` and `lib/bracket.js`, with its tests.
2. The sealed-reserve stamp (§4.6).
3. The cheap board-level noise capture (§4.7).
4. `plateau.js` axes from the caller.
5. The Stage 4 record kind and its store.
6. The Funnel steps as pure functions, tested headless before any screen exists.
7. The tab.
8. Deploy, re-fingerprint, generate the Funnel word list.
9. Re-point Verify, History, Tune and Greenlight at Stage 4 sets.

Steps 1–4 are prerequisites and produce nothing the owner can see. Step 6 is
where the design either works or does not, and it is testable without a screen —
which is where it should be proved.

---

## 13. Open questions for the owner

1. **The thin-count floor** in steps 3 and 4 — a cell with two settings in it is
   not a reading. I would default it to a number the owner sets on the tab
   rather than choose one in code.
2. **How many survivors is the funnel aiming at?** The design does not target a
   number, and probably should not — but if the answer is "a few dozen" then
   per-trade capture is trivial, and if it is "a few thousand" it is not.
3. **Whether step 7 should refuse an empty or a one-setting result**, or write it
   with a warning. I lean write-with-warning: refusing removes the owner's
   choice, which is the fault RULE ZERO and RULE FIVE exist to stop.
