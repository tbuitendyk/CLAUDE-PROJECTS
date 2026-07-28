# GO-LIVE plan — live execution with real (small) capital

Status: **PLANNING ONLY.** Nothing on this page is authorized. Every step
below executes only on the owner's explicit go, step by step — "catalog it"
is not "build it," and "build it" is not "run it." This file is the living
backlog for the live-trading capability and the features feeding it.

Purpose (owner's framing): buy higher-quality testing with small real
amounts — real fills price the two assumptions every paper book leans on
(entry-time execution and the fee/spread model). Ultimately the system
pulls the trigger itself, with optimized execution and tuned trailing
stops, managed either by our loop or by the exchange API.

## Ground rules (standing)

- **Owner's go-gate on every step.** No probes, no code, no keys, no orders
  without an explicit instruction for that step.
- **Never deploy while any screen, sweep or null is in flight.**
- The frozen books and their records are untouchable; live trading is a new,
  separately pre-registered record.
- Clean-record framing: the first live pilot is declared in VERDICTS.md as
  an **execution-fidelity pilot** (purpose: measure fill quality, slippage,
  true friction vs the paper assumptions) — not an edge verification — so
  its P&L can never contaminate a book's verdict. Per "What any success
  buys", edge-based live sizing is still earned only by completed books.

## Phase 0 — venue reality (first go)

1. Read-only reachability probes from the VPS: KuCoin, Kraken, Bitso
   (public endpoints only; no keys). Binance known-blocked (HTTP 451;
   TRACKER.md amendment log).
2. Fee table at pilot size, per venue: maker/taker tier, min order size /
   min notional per pair (DOT, AVAX, UNI, DOGE), native order types
   (stop-market / stop-limit / OCO / trailing).
   Known so far: KuCoin spot ~0.1%/0.1% base, NO native trailing on spot;
   Kraken ~0.25/0.40% low tier, HAS native trailing stops; Bitso thin book.
3. Owner confirms account standing/jurisdiction per candidate venue
   (Binance 451 and KuCoin regional limits may not be accidents; Kraken +
   Bitso are the venues the balancer already uses with real accounts).
4. **Decision: the live venue.** KuCoin if reachable + rates hold + account
   is clean; else Kraken; else the Binance relay (below, with its ToS risk
   accepted explicitly).

## Phase 1 — strategy + sizing (second go)

5. **Decision: what drives orders.** Cleanest fidelity test = mirror an
   existing live paper book's calls (DOGE daily-3d or a hunter book) with
   real clips. A bracket-lab survivor requires its null first, per the
   lab's own workflow.
6. Sizing from the chosen strategy's simulated drawdown:
   `capital ≥ (min clip × max concurrent positions) + worst-streak buffer`.
   Sketch at Kraken minimums (~$5–10 clips, t65h daily → ≤3 concurrent,
   15–25-loser streaks at ~2d-wide stops): roughly $100–150. Compute
   properly from the pinned strategy; the answer is the smallest amount
   that survives the anticipated drawdown, per the owner.
7. VERDICTS.md pre-registration page: purpose, venue, strategy mirrored,
   clip size, capital, horizon, the fidelity metrics (fill rate vs paper
   fills, realized slippage per leg, realized fee per leg, latency), and
   what the pilot does NOT claim (edge).

## Phase 1.5 — minute-resolution validation + trail tuning (gates every candidate)

No candidate enters Phase 2 without passing through this layer.

7a. **Minute-data pull, candidate-scoped.** For the proposed candidate's
    pair(s) only, fetch 1-minute klines from the same keyless bulk portal
    (monthly zips — no new data source, ~60× the hourly volume, so scoped
    to candidates rather than the whole universe; cached like everything
    else).
7b. **Minute-resolution re-simulation of the candidate's bracket book.**
    Purpose one: dissolve the hourly ambiguity — bars that spanned both
    rails (resolved pessimistically at 1h) become 60 minute-bars where the
    actual fill order is mostly determinable. Report the candidate's
    numbers at both resolutions plus how many ambiguous fills flipped;
    a candidate whose edge lived inside the hourly pessimism gap is
    upgraded, one whose edge dies at minute resolution is caught BEFORE
    money touches it.
7c. **Trailing-stop protocol tuning at minute resolution.** Trail distance
    × activation threshold × step size as a DECLARED menu (never a
    continuous scan), swept mechanically over the candidate's trades at 1m
    granularity — hourly bars are too coarse to walk a trail honestly.
    Selection by the same best-net-dollars-with-floor rule, stamped.
7d. **Honesty treatment for the trail layer.** Trail tuning is one more
    selection on the same test window, so it gets the same medicine: the
    candidate's null replay is extended to price the trail menu's freedom
    (member calls from the rotated worlds re-priced through the trail
    sweep at minute resolution — pricing is cheap even when training
    isn't). The chosen trail protocol then freezes into the Phase 2+
    declaration alongside gate/d/t/quorum.

## Phase 2 — plumbing, advisory first (third go)

8. Exchange adapter (trade-capable) for the chosen venue, in the classifier
   service or a sibling module. Key security: separate exchange subaccount
   funded with pilot capital only; withdraw permissions OFF; IP-pinned;
   whitelist enforced in code (pair, side, max notional per order and per
   day); kill switch that flattens and halts.
9. **Advisory-with-apply mode first** (balancer pattern): the system
   computes the order, shows it, owner confirms, it places. Runs this way
   until the owner has watched enough correct proposals to flip the switch.
10. Fill journal: every order, fill, fee, and the paper-twin's assumed
    price recorded side by side — the pilot's actual product.

## Phase 3 — full auto + optimized execution (fourth go)

11. Auto mode: the service places orders unattended within the whitelist.
12. Execution optimization backlog: maker-first entries where the venue's
    fee spread rewards it; slippage-aware entry windows; partial-fill
    handling; min-notional rounding rules; venue-outage behavior (park a
    hard stop, halt entries).
13. Trailing stops: belt-and-suspenders pattern — a resting hard stop
    always parked at the exchange as backstop, our loop walking it up as
    the trail (portable across venues; only option on KuCoin spot).
    Exchange-native trailing (Kraken) as an alternative arm.
14. **Trailing-stop tuning enters the Bracket lab as a swept execution
    dimension** (trail distance × activation × step), so trail parameters
    are chosen mechanically and null-tested like every other knob — never
    hand-tuned on live money.

## Phase 4 — Binance access path (only if the venue decision lands on Binance)

Owner's adjudication on record (2026-07-28): the account is non-US and
entitled to trade; the 451 reflects the VPS's US location, not the
account. Residual risk noted once — Binance enforces by IP and tunneled
access can be flagged — and accepted as the owner's call.

15. **Preferred: split-tunnel WireGuard exit (CA/MX).** A WireGuard
    interface whose exit is a dedicated static IP in Canada/Mexico —
    ideally our own endpoint on a small Toronto/Montreal VPS (never a
    shared commercial VPN IP; Windscribe-style static-IP plans are the
    fallback). Split at the APPLICATION layer: only the execution adapter
    rides the tunnel (bound to the wg interface / local proxy); data
    pulls and deploys stay direct. API key IP-PINNED to the exit address
    — useless from anywhere else, including the VPS's direct line.
    Tunnel watchdog: link down → halt new entries, alert, leave the
    exchange-resident stops parked (the belt-and-suspenders trail design
    is what makes an outage survivable).
16. **Fallback: relay device.** Classifier box emits signed trade
    INTENTS; a relay on an unblocked device holds the keys and executes
    behind its own whitelist; either side kills the loop. Better key
    hygiene (keys never touch the VPS), more moving parts.

## Feature backlog (research side, feeding the above)

- Bracket lab: dedupe the board's structural duplicates (always-gate rows
  identical across decision branches and slim/promoted stages).
- Bracket lab: doubles/triples sweep on a 6–8 asset universe (contexts are
  where the ADA analysis says the information lives) — not yet run.
- Bracket-lab survivor nulls before any survivor is considered for live.
- vs-control column: DONE (2026-07-27). Live null tables: DONE.
  Control-delta rerun of DOT singles: in progress as of this writing.
- Minute-kline loader (bulk portal 1m monthly zips, candidate-scoped cache)
  — prerequisite for Phase 1.5.
- Minute-resolution bracket re-simulator + hourly-vs-minute ambiguity report
  (Phase 1.5 step 7b).
- Trailing-stop simulator (declared trail menu, minute resolution) + trail
  freedom priced into the survivor null (Phase 1.5 steps 7c-7d; also feeds
  #14's live trail management).
- Real-friction feedback loop: once the pilot produces measured fee/spread
  per leg, add it as a priceable friction preset next to the research and
  stress rates.

## Decisions currently open

| # | Decision | Options | Status |
|---|----------|---------|--------|
| 1 | Live venue | KuCoin / Kraken / Bitso / Binance-relay | awaiting Phase 0 probes + owner |
| 2 | Order driver | mirror a live paper book / nulled bracket survivor | open |
| 3 | Autonomy path | advisory-with-apply → full auto (proposed) | open |
| 4 | Trail management | our loop w/ parked backstop / exchange-native | open (venue-dependent) |
| 5 | Pilot capital | formula in Phase 1 step 6 | needs strategy pinned |
| 6 | Trail menu (distance × activation × step) | declared grid, TBD | open — set before Phase 1.5 first run |
