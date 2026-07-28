# Pre-registered verdicts and declared one-look screens

Written 2026-07-26, before any of the outcomes below are knowable. Git
history is the timestamp. Rules here are mechanical on purpose: the person
reading a finished book must not be the one deciding what "success" meant.

## Fee policy (recorded here because it changes how research reads)

From 2026-07-26, research screens (pair / consensus / meta-lens) price paper
trades at **$0.125 per leg ($0.25 per round trip on $100)**: Binance spot
taker 0.10% per side plus a spread/slippage allowance. The former $0.50 per
leg remains, permanently, the declared rate of the three frozen live books
(TRACKER.md, TRACKER-DOGE.md, engine book #1) — their records are untouched
and their rate never changes mid-record. Screens run before this date used
$0.50 per leg; comparisons across the boundary must be made gross, not net.

## Book 1 — DOT/AVAX weekly tracker (TRACKER.md; horizon 26 live weeks)

Thesis: the weekly Tue→Thu consensus vote carries real edge (screening:
DOT 8/8 with 0/286 null rotations, AVAX 7/8 with 0/281).

At 26 live weeks:
- **Success**: combined vote net P&L (DOT + AVAX) > $0, and at least 26 of
  the 52 pair-weeks produced a settled record (data quality floor).
- **Failure**: combined vote net P&L < $0 with both pairs individually < $0.
- **Mixed** (combined > $0 with one pair < $0, or combined < $0 with one
  pair > $0): extend once by 13 weeks, then apply the same rule with no
  further extension.

## Book 2 — DOGE daily-3d (TRACKER-DOGE.md; horizon 90 live periods)

Thesis: DOGE daily-3d predicts its own 41-hour move (vote book 0 exceedances
in ~1,072 label rotations; family-wise ≈ 8% after the pair/geometry search).
Primary rules per its protocol: vote and q7.

At 90 live periods:
- **Success**: vote net > $0 AND q7 net > $0 (both at the book's declared
  $0.50/leg stress friction).
- **Failure**: vote net < $0 AND q7 net < $0.
- **Split verdicts**: whichever rule is positive carries a WEAK pass only if
  its gross-per-trade exceeds $1.00 (i.e. it would clear stress fees with
  margin); otherwise the book fails as a whole.
- Secondary reading (no action attached): does the win-rate ordering across
  q5→q8 reproduce the backtest's 53.7/57.4/62.6/67.3 gradient?

## Book 3 — DOT daily-3d, engine book #1 (horizon 90 live periods)

Thesis: DOT's individual lenses are dead but their AGREEMENT carries signal
(1000-shift null: q6 exceed 2%, q7 1%, vote dead at 40%).

At 90 live periods:
- **Success**: q6 net > $0 AND q7 net > $0 (the two calibrated rungs).
- **Failure**: q6 net < $0.
- **Control**: the vote book is EXPECTED to be ~flat-to-negative. If the
  vote finishes clearly positive while the gates finish negative, the
  agreement thesis is wrong regardless of dollars, and the configuration is
  rejected even if a rung made money.

## What any success buys

A completed book that meets its success rule earns exactly one thing:
consideration of a small live pilot at real fees, sized to be survivable
and boring. No backtest result, however calibrated, earns that directly.
A failed book retires its configuration; re-entering the same configuration
requires new evidence (a new mechanism or new data era), not a re-run.

## Interim looks

Anyone may look at any book at any time. No action follows an interim look.
Books end at their horizons or by explicit retirement, never because an
interim number looked good or bad. (Stopping early "for time" is retirement
and closes the record as FAILURE-BY-DEFAULT unless the book was net-positive
on every primary rule at retirement.)

## Screen R1 — the recency test (declared before running)

Question: is the DOGE/DOT daily-3d signal concentrated in the recent era
(the meta-lens found DOGE's gross edge NEGATIVE on mid-history and positive
on the test era, while DOT's was thin-positive throughout)?

Protocol, one look:
- Classic consensus screen, daily-3d, pairs DOGEUSDT + DOTUSDT only,
  months **2023-01 through 2026-06** (fixed lookback, chosen before running,
  no other lookbacks will be tried), auto band, argmax, 24/7, 1000 null
  shifts.
- **Recency confirmed for a pair** if: vote-book null exceed ≤ 2% AND
  vote gross-per-trade strictly exceeds the full-history run's
  ($1.02 DOGE / $0.72-at-q5-era DOT baselines, gross basis).
- **Recency rejected** if exceed > 10% or gross-per-trade below the
  full-history figure.
- Between: inconclusive, and it stays inconclusive — no follow-up lookback
  scans. Consequence of confirmation: FUTURE books may declare a 2023+
  training window; existing books are untouched.

## Screen H1 — the hunter campaign (declared before running)

Question: does the directional hunter (class-weighted training, ±1-only
decisions, τ tuned on validation dollars) find tradable big-move edges the
argmax machinery can't see?

Protocol, declared breadth:
- Classic consensus screen, decision = directional hunter, daily-3d, all
  loaded data, 24/7, all 17 pairs, 0 null shifts, at three FIXED bands:
  **±3%, ±5%, ±8%** — three distinct hunting regimes (common swings /
  uncommon moves / tail), not tunings of one. τ self-tunes per run on
  validation paper P&L; the band menu is the declared breadth.
- **All three sweeps run regardless of interim results** — the denominator
  is fixed at 3 × 17 = 51 looks by this declaration, not by enthusiasm.
  No off-menu bands afterward; a new band is a new declaration.
- Reading gate per pair-band: net > $0 at research friction ($0.25 round
  trip) on ≥ 30 trades, with a τ that actually traded on validation
  (a zero-validation-trade τ is absence of evidence, not conviction).
  **Gate amended — see Amendment log (A1).**
- Anything clearing the gate earns a deep null (200–1000 shifts, that
  pair and band only), read against the ledger's full denominator.
  Nothing here earns belief, a book, or capital directly.

## H1 deep-null results log (one look each, recorded as read)

### UNIUSDT ±5% — consensus-20260726-0038, read 2026-07-26

Vote book +$47.71 net on 43 trades (24 wins, gross/trade $1.36, 37.3
trades/yr) — gate PASS, lane (a). Deep null, 1000 shifts:

- **Vote P&L exceed 2.6%** (primary test). Super (q6) 2.8%. Gate ladder
  q5 5.1% / q6 2.8% / q7 4.4% (q8 99.3% is vacuous — that rung almost
  never fires). Consensus-fraction exceed 13.6%.
- Null median book: $0.00 on 0 trades — under label-shift noise the
  committee almost never agrees enough to trade, so part of the low exceed
  rate is "agreement is itself rare under noise".
- Edge exceed 79.9%: per-call accuracy is indistinguishable from noise.
  Whatever is here lives in WHEN the book trades, not in call accuracy.

**Verdict: misses the ≤2% forward-ticket bar; gray zone; no book on this
result alone.** Read against H1's declared 51-look denominator, 2.6% is
suggestive, not significant. Disposition of the UNI configuration is
governed by A2 below.

### AVAXUSDT ±5% — consensus-20260726-1448, read 2026-07-27 (owner-adjudicated)

The doc was interrupted at 6,667/8,008 runs (deploy accident, disclosed
under A2). The owner ruled the on-screen partial result IS the A2 look:
833 distinct shifts of the declared 1,000, an interruption, not a
selection — the exceed counts were not knowable when the run died. This
supersedes the disclosure's "relaunch verbatim" plan; the relaunched doc
(consensus-20260726-2347) was cancelled unread so A2 stays one look.

Vote book +$76.55 net on 157 trades (79 wins), accuracy 54.3%
(edge −14.3%); super 6/8 +$27.87 on 36 trades. Null calibration:

- **Vote P&L exceed 1% of 832 shifts** (primary). Super 1% of 832.
  Gate ladder: q5 1% (98t, gross/trade $0.89) / q6 1% (36t, $1.02) /
  q7 97% and q8 99% (vacuous — those rungs never fired, 0 trades).
- Consensus-fraction exceed 94%: ZERO of 8 specs had positive true edge.
  As with DOT, whatever is here lives in the book — in WHEN it trades —
  not in per-spec call accuracy. Same caveat as UNI's 79.9% edge exceed.
- Gradient gross/trade rises $0.89 → $1.02 from q5 to q6; the tight rungs
  are silent at this band.

**Verdict per A2: 1% ≤ 2% — the joint ticket triggers. Both UNIUSDT
(2.6% of 1,000) and AVAXUSDT (1% of 832) earn paper-book forward
tickets.** Caveats carried: correlated pairs, UNI's number known when the
rule was written, and the AVAX look at 833 of 1,000 declared shifts.
Consequence executed: hunter paper books drafted for both pairs via the
book engine (decision = directional added to the engine for exactly this;
the frozen trackers are untouched). Declaration awaits owner sign-off.

## Bracket-lab results log (execution-permutation sweeps)

### DOTUSDT singles — bracketlab-20260727-2323, read 2026-07-28

The lab's first null-tested candidate. Sweep: DOT alone (singles), all four
options permuted = 72 branches, 516 trainings; slim grid then top-25
promoted to the full 12-member grid with quorum rungs.

**Candidate (leaderboard row 9, promoted):** daily-3d, adaptive band frozen
at ±2.13%, argmax, 24/7, quorum **4 of 12**, **direction-filtered** gate,
rails at **1.5x band**, horizon **65h**.
Test window: 427 periods. **+$185.08 on 235 trades** (130 wins, gross/trade
$1.04, 40 stops, 0 ambiguous fills) at research friction ($0.25/round trip).
**vs control +$173.80** — the best model-free (always-gate) cell on the same
branch made only ~$11.28, so essentially all of the dollars came from the
committee's gating, not from blind bracket-chasing.

**Null replay, 1000 rotations** (12,516 trainings, 6.4h, 0 failures). Each
rotation retrained the full grid on circularly shifted labels and was handed
the SAME downstream freedom the real machine had — whole execution menu, all
quorum rungs, same best-cell rule:

- **best-of-menu (search-replayed) exceed: 0.9% of 1000**, null median
  **+$122.13**
- same-config-only exceed: 0.1%, null median +$101.71

**Methodological finding worth preserving: the 0.1% -> 0.9% gap is the
measured price of within-branch cherry-picking — a factor of ~9.** The naive
(same-config) reading would have overstated significance ninefold. This is
the first direct measurement of the search tax in this project, and it
justifies the search-replayed null as the default reading everywhere.

**What is NOT priced:** the candidate was the best of **72 branches**, and
that multiplicity cannot be replayed (it would mean 72 x 12 trainings inside
every rotation). Crude Bonferroni 0.9% x 72 = 65%; independent-branch
1-(1-0.009)^72 = 48%; branches are heavily correlated (one asset, one
history, overlapping geometries) so the honest range is **~10-25%**.

**Also load-bearing:** the null median of +$122 means a committee trained on
scrambled labels, allowed to shop, typically finds +$122 in this window. The
real book's excess over the noise floor is therefore about **$63, not $185** —
roughly $110 of the apparent edge is purchasable with a large enough menu in
any world, real or fake. Capital note: a 65h hold on daily signals runs up to
3 concurrent positions (~$300 implied, not $100).

**Verdict: survived its within-branch search replay at 0.9%; does NOT survive
the 72-branch family correction; forward test required.** No book, no
capital, no belief on this result alone. The declared next step that would
make it mean more is **replication** — the same fixed configuration tested on
fresh assets — not a deeper null on DOT.

### DOT row 9 — REPLICATION FAILED, configuration RETIRED (bracketlab-20260728-0741, 2026-07-28)

Declared before the run (the config was already fixed in the entry above, so
this was a genuine out-of-sample test of a pre-specified hypothesis):
**daily-3d, adaptive band, argmax, 24/7, direction-filtered gate, d 1.5x band,
t 65h, quorum = 1/3 of the member set (4 of 12 on singles).** Scored on all 17
assets as singles, one fixed cell per asset — one look apiece, so no shopping
tax and no branch correction is owed. Pre-registered reading: >=12 of 16 fresh
assets positive = mechanism; 8-11 = ambiguous; <8 = window artifact, retire.

Result:
- **positive dollars 7/17 (binomial p = 0.83)**
- **positive vs control 5/17 (binomial p = 0.98)**
- Excluding DOT itself: **6 of 16** on dollars, **4 of 16** on vs-control.

Both readings are WORSE than a coin flip. DOT is a lone outlier rather than
the top of a distribution: gross/trade DOT $1.04, then a cliff to $0.58-0.63
(ETC, DOGE), most of the field under $0.30, and five assets negative before
the $0.25 round trip.

**The gating actively destroyed value on most assets.** vs-control was
negative on 12 of 17 — XLM -$503, XRP -$316, ZEC -$302. ZEC is the clean
illustration: the declared cell made +$122 while the model-free always-gate
control on the same asset made +$424.

**Verdict: DOT row 9 was a window artifact. The configuration is RETIRED**
per "What any success buys" — re-entering it requires new evidence (a new
mechanism or new data era), not a re-run. Its 0.9% search-replayed null
stands as correct and correctly caveated: it measured a real within-branch
coincidence, which is exactly what the 72-branch family correction warned
it might be.

**Standing finding carried forward:** the direction-filtered gate does not
generically improve bracket books — it hurt on ~70% of assets tested. Any
future bracket candidate must clear replication BEFORE earning a deep null,
not after. Cost note: this test took ~6 minutes of compute and closed a
question a 6-hour null could not.

### Doubles sweep — bracketlab-20260728-0804, read 2026-07-28

All 17 assets x every double (trade + one context) = 272 combos on one branch
(daily-3d, auto band, argmax, 24/7). Slim grid on all 272, mechanical top 25
promoted. 1h30m, no failures. **Discovery run — no verdict is claimed from it.**

**METHOD CORRECTION, recorded because it changes how an earlier deliverable
must be read.** The `vs control` column on a SEARCH leaderboard is not
evidence and never was. Each row is the argmax of a menu that already contains
every always-gate (model-free) cell, so a row whose winner is gated has beaten
the control by construction, and a row whose winner is ungated *is* the
control. The column can only come out positive or blank. The finished 0804
board shows exactly that: 32 of the top 50 rows gated, all 32 positive; the
other 18 blank; not one negative anywhere.

The same subtraction stays valid in REPLICATION mode, where the cell is
declared before the run and cannot be swapped for a better one while the
control keeps its full 35-cell search — which is why the DOT row 9 entry above
could report vs-control negative on 12 of 17 assets. That reading is
unaffected. The column has been relabelled in the UI (`vs control*`), with a
footnote under the board and a paragraph in the help.

What the board does say, none of it a candidate:
- **Drift, not skill.** ZEC and XLM as trade asset own the whole top of the
  board; they are the two largest movers in the test window.
- **The base narrowed under promotion.** Five assets had gated winners at the
  slim stage; after promotion ZEC and XLM had displaced UNI, ETH and XRP from
  the top 50 entirely. Two of seventeen.
- **The exit horizon is pinned at the menu ceiling.** 161h — the largest value
  offered — wins 23 of the 32 gated rows on both surviving assets. An optimum
  on the edge of the search range is not an optimum. The menu was NOT widened;
  doing so mid-hunt would add multiplicity to everything downstream. Flagged to
  the owner as deserving its own declared test.
- **Quorum has no mode.** Among promoted rows the winning rung is a four-way
  tie (3, 6, 8, 12 of 16 — both assets, three rows each). Strongest evidence
  yet for the standing finding that committee diversity does not move the
  weights.

**Declared for Run 3 / Run 4, fixed before either was fired:** modal knob
values counted over DISTINCT trade assets, ties broken on row count —
**active gate, d 1.0x band, t 161h, quorum = 25% of the member set**, on
daily-3d / auto / argmax / 24-7. The quorum term is the one knob NOT derived
from the board (there is no mode); it is on the record as the weak link.
Run 3 scores that cell on 17 singles (one look apiece, clean binomial); Run 4
scores the same cell on all 272 doubles. Same pre-registered reading rule as
row 9: >=12 of 16 fresh assets positive = mechanism; 8-11 = ambiguous;
<8 = artifact, retire.

**Tooling fix made in the same session:** replication mode now promotes EVERY
unit rather than the leaderboard's top K. The declared cell is only read at
the promoted stage, so a P&L-ranked promotion made every per-asset number in
the replication table conditional on slim performance. It was harmless on the
17-unit runs done so far (17 of 17 promoted either way) and would have
silently biased Run 4.

### Doubles-derived config — REPLICATION FAILED, configuration RETIRED (bracketlab-20260728-0946, 2026-07-28)

Declared before the run, mechanically, from the finished 0804 doubles board
(modal knob value over distinct trade assets, ties on row count):
**daily-3d, adaptive band, argmax, 24/7, on-active gate, d 1.0x band, t 161h,
quorum = 25% of the member set (3 of 12 on singles).** Scored on all 17 assets
as singles, one fixed cell apiece. Pre-registered reading (same rule as row 9):
>=12 of 16 fresh assets positive = mechanism; 8-11 = ambiguous; <8 = retire.
The quorum term was flagged in advance as the one knob the board did not
determine.

Result — 4.0 min on 3 workers, no failures:
- **positive dollars 6/17 (binomial p = 0.93)**
- **positive vs control 1/17 (binomial p = 1.0000)**

**Verdict: RETIRED.** Below the artifact threshold on dollars, and the
vs-control reading is the worst yet recorded: on 16 of 17 assets the declared
gated cell made LESS than the model-free always-gate control on the same
asset. Even the three assets that made real money lost to their own controls
(ZEC +391 vs control +423, XLM +297 vs +388, XRP +252 vs +309).

**Standing finding, now on two independent declared configurations.** Row 9
(direction-filtered, 65h, 1/3 quorum) lost to control on 12 of 17. This one
(on-active, 161h, 25% quorum) lost on 16 of 17. Two configs, derived from
different boards by different rules, fail the same way: **the committee's
calls subtract value from bracket execution rather than adding it.** Any
future bracket candidate must clear replication BEFORE earning a null, and
must be read against a DECLARED control, not the search board's column.

**Diagnostic raised by this result, and the run that answers it.** Backing the
control out of the 0946 rows puts the model-free bracket in profit on 14 of 17
assets. That number CANNOT be quoted: the control is the best of 35 always-
cells picked per asset in-sample, so it is search-inflated by construction —
the same error this file corrected for the search board's column. Run 4
(bracketlab-20260728-0953) replaces it with ONE always-cell declared in
advance at Run 3's own distance and horizon, making the pair a single-variable
comparison: classifier on versus classifier off, everything else held.
Declared AFTER reading 0946 — disclosed — with the reading rule fixed before
firing: >=12 of 17 positive means the bracket mechanic carries the edge and
the classifier layer is subtracting from it (which reframes the hunt and needs
its own null before anything else); 8-11 means the 14/17 was search inflation;
<8 means neither layer has anything on this geometry. It is a diagnostic
baseline and earns no paper book on its own.

### Model-free baseline + the paired reading — CORRECTION (bracketlab-20260728-0953, 2026-07-28)

Declared before firing, after reading 0946 (timing disclosed there): the same
cell as Run 3 with the gate set to **always** — daily-3d, adaptive band,
argmax, 24/7, d 1.0x band, t 161h, 17 assets as singles. One declared cell per
asset on both sides, so Run 3 vs Run 4 is a single-variable comparison:
classifier on versus classifier off, everything else held.

Result — 4.2 min on 3 workers, no failures:
- **positive dollars 8/17 (binomial p = 0.69)** — the declared 8-11 band:
  coin flip. The bracket mechanic has nothing on this geometry either.
- positive vs control 0/17, as expected by construction (the control is the
  best of 35 always-cells; a declared always-cell can only equal or trail it).
  SOL came in at exactly 0.00, i.e. the declared cell WAS the best cell there —
  a clean confirmation that the control is what this file says it is.

**CORRECTION to the 0946 entry above.** That entry, and the email sent with
it, said the committee's calls "subtract value from bracket execution". That
overstated the evidence, and it did so by leaning on vs-control — a best-of-35
in-sample baseline — which is the same search-inflation error this file had
corrected for the leaderboard column earlier the same day, applied in the
opposite direction. Against a DECLARED control the picture is flat:

    gate helps on 8 of 17, hurts on 9 of 17    sign test p = 0.69
    median per-asset difference                -$0.37
    total dollars   gated -$923.27   model-free -$1,062.24
    the gate stood aside on 20.9% of periods, so it IS acting — to no effect

The gated total is $139 better, but that comes entirely from BNB, ETC and BCH,
where both versions lose heavily and the gate merely trades less of a losing
book. It is not evidence of skill.

**Corrected standing finding.** The classifier layer neither adds nor
subtracts measurably on bracket execution; **both layers are null on daily-3d
at a 161h exit.** Every apparent success on the 0804 board was drift: ZEC, XLM
and XRP are positive with the gate and without it, and the other fourteen
assets are negative either way. The earlier "12 of 17" and "16 of 17"
vs-control readings stand only as statements about a search-inflated baseline,
not about the classifier, and are not to be quoted as the latter.

**Run 6 (bracketlab-20260728-0959) fired to test whether the null is general.**
The model-free cell — the simpler layer, whose failure makes the other moot —
scored across all five chunk shapes on the same 17 assets. Diagnostic, not a
candidate hunt; reading rule fixed before firing: every geometry in the 6-11
band means the bracket layer is null generally and the branch is dead; any
geometry at >=12/17 or <=5/17 is a LEAD only, owing a fresh declared test on
data it was not chosen from, because five geometries is five looks.

### Bracket layer — NULL ON EVERY GEOMETRY, branch closed (bracketlab-20260728-1010, 2026-07-28)

Declared before firing (see the 0953 entry): the model-free cell — **always
gate, d 1.0x band, t 161h**, adaptive band, argmax, 24/7 — scored across all
five chunk shapes on the same 17 assets. 85 units, one declared cell apiece,
every unit promoted. Reading rule fixed in advance: every geometry inside 6-11
of 17 means the bracket layer is null generally and the branch is dead; any
geometry at >=12 or <=5 is a LEAD only, owing a fresh declared test on data it
was not chosen from, because five geometries is five looks.

Result:

    daily-1d    8/17   p = 0.69   total   +110.13   median  -21.03
    daily-2d    8/17   p = 0.69   total    +69.89   median  -17.03
    daily-3d    8/17   p = 0.69   total  -1062.23   median  -58.72
    daily-4d    8/17   p = 0.69   total  -1111.17   median  -58.49
    weekly-8d   9/17   p = 0.50   total   -179.38   median   +4.33

**Verdict: the bracket execution layer is NULL on every chunk shape tested.**
Five independent looks, all 8 or 9 of 17, none within three assets of the
12/17 threshold and none near the 5/17 floor either. There is no geometry on
which this mechanic works and no lead to follow.

Descriptive, not a finding: the short chunks come out near breakeven in total
dollars (+110, +70) while daily-3d and daily-4d are deeply negative (-1062,
-1111), which is what a fixed 161h exit does when it is long relative to the
chunk. The declared statistic is the count, and the count does not move.

**The bracket branch is closed.** Chain of evidence, all pre-registered:
1. Row 9 (directional, 65h) — replication failed, 7/17. Retired.
2. Doubles-derived cell (on-active, 161h) — replication failed, 6/17. Retired.
3. Classifier on vs off, declared control — coin flip: helps 8, hurts 9,
   median difference -$0.37. The classifier neither adds nor subtracts.
4. Model-free bracket across all five geometries — 8/8/8/8/9 of 17. Null.

Steps 3 and 4 together say the branch does not fail because the classifier is
weak. It fails because **the bracket mechanic has no edge to gate.** Every
apparent winner on every board was drift: ZEC, XLM, XRP and ETH are positive
with the gate, without it, and on nearly every chunk shape; the rest are
negative the same way.

Nothing here retires the classifier itself — the weekly-chunk direction
question that Books 1-3 test forward is untouched by this and those books run
on. What is retired is the idea that bracket/OCO execution over these chunk
geometries is a place to look for edge.

**Where the hunt goes next is the owner's call, not the session's.** No
further bracket runs were fired after this result.

### Method — minute confirmation, and the first measurement of the hourly assumption (2026-07-28)

Not a verdict on a candidate; a rule about what may be quoted.

An hourly bracket knows only OHLC, so when a bar both extends and touches the
stop the data cannot say which came first. simBracket takes the pessimistic
order and counts each occurrence in `trailAmbiguous`. With a STATIC stop that
fires rarely (only a bar spanning both entry rails — 0 to 47 periods out of
~500 across the runs logged above). With a TRAILING stop it fires on any bar
that extends and retraces.

**First measurement** (bracketlab-20260728-2132, DOTUSDT daily-3d, declared
always-gate, d 1.0x, t 65h, trail 1.0x, arm 0, q4/12; minute coverage 99.8%):

                net P&L   trades   wins   stops   trail-amb
    hourly      -118.92      427    156     424          23
    minute      -103.87      427    154     424           1
    delta        +15.05       +0             +0

The ambiguity count falls 23 -> 1: minute resolution settles 22 of the 23
questions, and the survivor is a single minute in which the same thing happens
again. The pessimistic assumption was worth **$15.05, about 13% of the cell's
result** — material, and in this instance conservative.

**Standing rule from this point: no trailing result is quotable without minute
confirmation.** The hourly figure is an estimate resting on an assumption, and
`trailAmbiguous` is how much of it rests there. Confirmation may move a number
in EITHER direction — the hourly bar hides the ordering both ways — so a
favourable delta is not evidence of anything either.

Note on the cell itself: it is a loser before and after (-118.92 -> -103.87),
and it stops out on 424 of 427 trades because arm=0 with trail=1x band puts
the stop one band below entry immediately. It was chosen to generate stop
activity for the test, not on merit, and nothing about it is a finding.

**Also recorded: the API silently dropped `trailing` and `holdout`.**
startBracketLab read them; server.js never forwarded them. Every run fired
before this was fixed ran with trailing OFF regardless of what was requested.
One conclusion was drawn and withdrawn on the strength of it ("trailing did
not beat market entry on DOT" — trailing had never been swept). A test now
derives the parameters the orchestrator consumes and asserts the endpoint
forwards each one. Third silently-dropped-parameter defect in this system.

## Amendment log

- **A1 (2026-07-26) — H1 reading gate: low-frequency lane added.** The
  original gate's flat ≥ 30-trade floor was set by the session, not the
  owner, and contradicts the campaign's own premise at wide bands: a tail
  hunter that fires a handful of times a year can never reach 30 trades in
  any test window. Amended gate, per pair-band:

  Net > $0 at research friction ($0.25 round trip), with a τ that actually
  traded on validation, AND either:
  - **(a)** ≥ 30 trades in the test window, or
  - **(b)** ≥ 10 trades AND gross-per-trade ≥ $1.00 AND a trade rate of at
    least **7 trades per 365 days of test window**. The rate term makes the
    low-N lane scale with the testing timeframe — 10 signals in one year is
    a jump-on-able pattern; 10 signals in ten years is not, and lane (a)
    already covers any window long enough to accumulate 30. The $1.00
    gross-per-trade term restricts the lane to rare-but-fat signals, the
    only regime where low frequency is worth acting on.

  Timing disclosure: this amendment was written AFTER the ±3% sweep was
  read and BEFORE the ±5% and ±8% sweeps were read. It is therefore clean
  (pre-registered) for ±5% and ±8%, and post-hoc for ±3%. Any ±3%
  candidate admitted only by lane (b) — as of writing, BCHUSDT (+$38.09,
  27 trades, $1.66 gross/trade) — is flagged **admitted-after-looking**:
  its deep null is still valid evidence, but it does not get to claim it
  survived a pre-registered gate. Candidates that passed the original
  ≥ 30 gate are unaffected.

- **A2 (2026-07-26) — AVAX ±5% deep null declared as the H1 confirmation
  look; joint book rule.** Timing disclosure: written AFTER UNI's ±5% deep
  null was read (2.6%) and BEFORE AVAX's deep null was started or read.
  AVAX earned its deep null under H1's own rule by passing the ±5% gate
  (+$76.55 net, 79/157 trades, lane a); this amendment fixes how that one
  look will be read, and what it buys, before the number exists.

  Protocol: one consensus screen, AVAXUSDT only, exact param mirror of
  consensus-20260726-0038 (±5% band, daily-3d, directional hunter, 1000
  null shifts, $0.25 round trip, full history). One look, no re-runs.

  Reading rule, fixed now:
  - **AVAX vote P&L exceed ≤ 2%**: BOTH UNIUSDT and AVAXUSDT earn paper-book
    forward tickets (fresh declarations, 180+ day horizon, min-activity
    floor). The UNI ticket rides on joint replication — the same machinery
    showing sub-2-3% noise floors on two pairs — not on its own 2.6%.
  - **2–5%**: no automatic ticket; owner's call, default no books.
  - **> 5%**: no books; both configurations return to hunt-only status.

  Caveats recorded with the rule: (1) UNI and AVAX share calendar and
  market beta, so a joint pass is replication across correlated pairs, not
  two independent draws — the joint evidence is weaker than the product of
  the two exceed rates; (2) the joint rule was written knowing UNI's
  number, so the binding randomness is entirely in the AVAX look. The AVAX
  bar stays at the original strict 2% for exactly that reason.

  Interruption disclosure (2026-07-26, before any result was read): the
  first A2 run (consensus-20260726-1448) was killed at 6,667/8,008 runs by
  a service deploy unrelated to the sweep — an infrastructure accident,
  not a look. No summary or exceedance number from the partial doc was
  ever computed or read, and it will not be. The run was relaunched
  verbatim as consensus-20260726-2347; that doc is the A2 look.
