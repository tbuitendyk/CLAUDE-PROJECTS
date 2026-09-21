# Long loop, 2026-09-21 — the decision field

Granted with `GO NOW!  LOOP NOW!   keep going until done including deploy`,
after the four decisions recorded in FIELD-DESIGN.md sections D, E and M.

**What the loop covers:** FIELD-DESIGN.md section I, steps 1 to 4 and 6 —
the engine, the build, the Coins section, the stage 3 gate, and the field on
Trade — built, tested and deployed. Step 5 (the comparison) is the owner's to
run; the steps to run it are in the final report. Step 7 (the retirements)
waits for the owner, as section I says.

**What stops everything, unchanged:** nothing armed with real money; nothing
that cannot be undone; nothing outside the established channels; any
conflict with something the owner has written down is parked, not argued.

**The rule and the expected result were written before any number existed**
— FIELD-DESIGN.md section F. They are not restated here so they cannot drift.

## Order of work

1. `lib/field.js` — the engine, pure, with tests on a fabricated coin.
2. The build: worker task, the set on disk, list/open/rename/delete, routes.
3. The Coins section: dials, launcher, progress, state, range, grid.
4. Stage 3: the gate dials on Sweep, the worker pricing, record fields,
   tally, Boards sorts and floors.
5. (owner) the comparison.
6. Trade: the field beside the members, both books alike.

Each of 1–4 and 6 ships when its narrow checks are green (RULE TWELVE), with
its release bump (RULE ONE-C), then the suite, guards, fingerprint and word
list follow.

## Decisions (one line each, as they are made)

- **Outcome is the chunk's own `diffPct`**, in percent, from `windowMoves`
  (`lib/windowmove.js`): open of the trade to its close — exactly "market
  entry, chunk's own hold, entry to exit as a share of price".
- **Look-backs are typed in days and read in hours (×24)** through the same
  `windowMoves` look-back mechanism the walk uses, so a look-back's move is
  measured from the candle open that many hours before the decision instant.
- **A decision enters the points only once its chunk has closed**: the
  decision instant of the day being read must be at or after
  `startTs + exitOffsetH`. On the 41-hour shapes that is two days later. This
  is the no-leak guarantee and it is tested.
- **Weights are kept in epoch form**, Σ v·2^((ts_i−epoch)/H), read as
  ×2^(−(ts_d−epoch)/H), re-based when the exponent passes 500, so there is no
  daily multiply and no drift. The floor is a second accumulator a decision
  moves into when its age passes H·log2(1/floor); a decision leaves the
  window from whichever it is in.
- **The yardstick per look-back is the weighted median of |move| over the
  window's decisions before the day being read**, weights being the same
  half-life weights. Readings taken on a day are fixed on that day and stored
  (sign and the count of bands cleared), so adding and dropping a decision
  later use what was read then.
- **Slid copies wrap over all decisions known at build** (as the walk's do);
  on Trade the field is rebuilt from closed history at every decision with
  the same builder, so the lab and the live path can never compute a
  different number for the same day. No incremental state is persisted for
  the live path.
- **A point weighs in with its average outcome, not only its sign** (hunt
  your own instrument, first fabricated coin). The first cut summed
  sign(avg)·w and could not tell a coin whose outcome followed its one-day
  move perfectly from noise: the bands at one look-back nest, so their points
  agree with each other whether or not they know anything, and a copy with no
  signal is exactly as unanimous as the real coin (certainty median 30 on the
  signal coin against 60 on noise). Now: **field** = Σ avg·w, w =
  min(evidence, cap), evidence ≥ least evidence; **size** = |field|;
  **agreement** = |field| / Σ |avg|·w, 0 to 100; **certainty** = share of
  slid copies whose size is strictly below the real one. This changes a
  PROPOSED line of FIELD-DESIGN.md section D, not one of the owner's; it is
  written there too and it is theirs to reverse.
- **Scrambles are taken once at fill** and stored beside the slides count;
  the gate never reads them (owner, section D).
- **Stored per pair:** the per-day series (ts, sign, agreement, certainty,
  speaking, evidence) for every decision, the final grid, the final
  yardsticks, the window used, the fill day, the two counts at fill.

- **The field takes confirm's place on a run, never beside it**: a launch that
  names a field with confirm past off is refused in words. Two overlays on one
  trade could not be told apart on Boards, and the design says the field
  replaces confirm.
- **What a stage 3 run read is frozen beside the set** (`<id>-field.json.gz`,
  the pairs' series it priced with), the way the walk's leans are frozen in
  the set's params; deleting or rebuilding the field on Coins afterwards
  changes nothing about what was priced, and deleting the set removes it.
- **A unit the field has no pair for prices plain and folds every gate value
  to one**, exactly as confirm folds on a unit with no lean; the count line
  says how many units the field covers.
- **Table 3.B's floors on avg test trades and beat the kept null money were
  drawn and never sent** (found in passing while adding the field's floors,
  which would have been dead the same way): the page enumerated the query's
  keys and left those two out. Fixed in the same change, because the new
  floors needed the same fix. Reported here as a defect fixed inside the loop's
  work, not as its own task.
- **TALLY_V moves to 10**: every stage 3 set on the box re-totals in the
  background on its next open, as the mechanism has always worked; old sets
  gain empty field columns and nothing else changes on them.
- **The greenlight refuses a survivor priced under the field's gate** until
  Trade carries the field (step 6), the same refusal confirm has.

## Parked (for the owner, not done)

- none yet

## What reached the box

- **3.211.0 (dc8b184), deployed 2026-09-21 about 05:26 UTC**: the engine, the
  build, fields on disk, the section on Coins. Narrow checks green before the
  deploy; the suite, the guards and the word list after it.
