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

## Parked (for the owner, not done)

- none yet

## What reached the box

- nothing yet
