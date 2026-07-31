# H1 — Durable members, transient assembly (owner's hypothesis, 2026-07-31)

## The claim
Individual members learn signals about their coin that persist across the
coin's history. The ASSEMBLY — which members to trust, at what agreement
level, wrapped in which trade settings — is where era-transience and
selection luck enter. If true, the product is not "find a setup and freeze
it" but "keep the members, re-vote the assembly on recent data at a
declared cadence."

## Evidence so far (all from stored L14 data, read 2026-07-31)
- Member skill transfer test->holdout: +0.56 (recent windows), +0.34
  (era-mixed) — clearly positive.
- Within-committee ranking persists: +0.43 / +0.54 median; test-best
  member stays top-3 on holdout 56% / 65% (chance 50%).
- Setup-level money transfer: +0.05 (recent), **-0.45 era-mixed** — the
  best-shopped result anti-predicts its own holdout. Winner's curse at
  the assembly level.
Status: SUPPORTIVE, NOT YET SURVIVING — no noise comparison has run on the
member-level correlations, and "durable" has only been measured across two
windows.

## Declared test program (each step gates the next; instrument rules apply)
- **H1a — DECAY CURVES, lag-resolved (free, pure read).** The owner's
  sharpening (2026-07-31): establish the TEMPORAL character of each layer,
  not a yes/no. Score each member AND each agreement level within every
  63-day block; then correlate skill between block pairs AS A FUNCTION OF
  THE TIME GAP between them. Two curves out: member-skill persistence vs
  lag, and best-assembly identity vs lag. Flat = coin knowledge; falling =
  era knowledge, and the crossing into noise is that layer's half-life.
  THE RE-VOTE CADENCE N IN H1d IS THEN DERIVED (well inside the assembly
  half-life), not guessed — per the DERIVED/GUESSED threshold rule.
- **H1b — the noise floor for durability (compute).** Scrambled-label
  draws with member dumps; recompute the member-transfer correlations per
  draw. Real members must beat all draws (rank test, p-floor 1/(N+1)).
- **H1c — shopping vs drift inside the assembly.** Fixed declared cell
  scored everywhere (replication mode) vs the shopped cell: separates
  "selection luck" from "the optimal assembly genuinely moves."
- **H1d — walk-forward re-vote harness (the design change).** Every N days
  re-pick assembly on the trailing window only, trade forward, stitch a
  record spanning all eras. BUILT AND CALIBRATED ON PLANTED DATA FIRST
  (QC 56): plant durable member-level signal whose best view ROTATES;
  re-vote must harvest it, frozen assembly must not.
- **H1e — nulls for the adaptive recipe.** The scramble replays the ENTIRE
  re-voting procedure, not the final picks — the recipe's freedom priced
  into its noise floor.
- Ongoing: the frozen DOT/AVAX and DOGE paper books are live decay
  measurements of the frozen-assembly half; their record accumulates free.

## Design implications if H1 survives (not to be built before it does)
Member skill ledgers as first-class stored objects; assembly re-voted on a
declared cadence (N is a knob, tested one value at a time); reduced
execution shopping; the L15 freeze protocol reconsidered — freezing a
setup freezes the perishable layer with the durable one.

## Where it sits in the loop
Seed check (running) -> combined read -> L15 consult (owner hard stop,
with H1 on the table) -> H1a/H1b as the next cycles.
