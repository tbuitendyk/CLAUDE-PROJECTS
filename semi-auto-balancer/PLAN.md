# Semi-Auto Balancer — Build Plan

Goal: maximize robust expected currency-basket growth while minimizing
controllable risk. Principles: **advisory-with-apply everywhere** (nothing
trades or changes settings itself); past/present data only — no prediction;
plateau over peak; definite moves, no hybrid pieces.

This branch was forked from `balancer` @ f90ce6f. The old system stays live and
frozen (maintenance only) on port 8091 while this one is built and proven on
port 8092. This file is the roadmap and the status ledger — update the phase
status lines as work lands.

## Fork & cutover model

- Both services run in parallel against the same accounts (read-only exchange
  keys make that safe). Distinct sender names/subjects so their emails are
  distinguishable.
- CoinGecko quota is shared: this system prices held assets from exchange APIs
  once Phase 1.5 lands, reserving CoinGecko for the scanner + fallback.
- **Cutover gate:** (a) N weeks of error-free parallel polling; (b) alerts
  reconcile with the old system where logic overlaps; (c) dry-run data
  migration passes (profiles, targets, quantities, basket state + anchors —
  the chained track record must survive the move). Then the website proxy
  flips, the old unit stops, and `balancer` becomes the archive.

## Phase 0 — Foundations: history cache, cost model, job runner, tests
**Status: SHIPPED @ 263dd56, deployed 2026-07-17 (unit live on 8092).**
Remaining from the deploy gate: set SMTP creds + optional COINGECKO_API_KEY in
/etc/semi-auto-balancer/env; set Bitso profiles' fee to 0.36 once profiles
exist; VPS history-fetch check happens with the first analysis job.

Data layer (`lib/history.js` + `daily_prices` table):
- `getDailyHistory(coingeckoId, days≤365)`; timestamps normalized to the 00:00
  UTC day bucket before insert; INSERT OR REPLACE so the partial trailing point
  (CoinGecko's last point = live price at request time) is overwritten on the
  next top-up.
- One shared CoinGecko client (`lib/cg.js`): the existing demo-key header
  plumbing, a token bucket (25 req/min with a key, 10 without), exponential
  backoff on 429 that pauses the bucket (errored calls still consume quota),
  and a persistent **monthly call ledger** (demo tier = 100 calls/min but the
  binding cap is **10,000 calls/month**; warn at 80%). History refresh is lazy
  (when an analysis job runs) — only actively-held assets get routine top-ups.
- Fiat history: btc/usd and btc/fiat market_chart series joined on the
  normalized UTC day bucket (skip buckets present in only one series),
  usd-per-fiat = btc_usd/btc_fiat.
- Daily granularity ONLY in v1 (no mixed-granularity backtests). Clamp every
  request to days≤365 (demo-tier hard limit). Multi-year exchange history
  arrives in Phase 1.5 and layers over this cache.

Cost model:
- `profiles.fee_pct` (taker % per leg, default 0.38) and `profiles.spread_pct`
  (default 0.10), editable in the settings row; validation allows 0 (`>= 0`).
  Post-deploy checklist: set Bitso profiles to fee 0.36.
- Cost per corrective trade = (fee_pct + spread_pct) × 1 leg (direct pair vs
  the tether; leg count surfaced in sweep results).

Job runner (`lib/jobs.js`):
- In-memory job map + `GET /api/jobs/:id`; finished results ALSO persisted to
  `analysis_results` (deploys must not eat a completed sweep/scan). UI shows
  unknown job id as "result expired — re-run".

Test harness: `tests/` + `npm test` (permanent, no scratchpad tests).

Deploy gate: history fetch works for all live assets incl. fiat:mxn on the
VPS; no 429s; ledger counting; fee/spread editable and persisted.

## Phase 1 — Weight-normalized per-asset thresholds (calibration fix)
**Status: SHIPPED @ 263dd56, deployed 2026-07-17.** Tests green (npm test).

- Semantics: `threshold_pct` = **price-move sensitivity X%** ("react when an
  asset effectively moves ~X% against the rest of the account").
- ONE shared `effectiveThreshold(X, w) = X(1−w)/(1+wX)` (w = target weight
  fraction) used by BOTH the engine breach check AND buildProfileView (which
  previously re-implemented breach with the flat threshold and feeds the UI
  highlight, ⚠ marker, and status-email OVER tags — all must agree).
- Guards: w ≥ 1 → never alerts (degenerate); UI warning when an asset's
  effective threshold is so tight it sits in daily-noise territory.
  target_pct=0 assets stay excluded from evaluation.
- Documented asymmetry (accepted): downside triggers slightly tighter than X
  on heavy assets (|move| = X/(1+2wX)) — mildly faster crash response;
  calibration tests assert on up-moves.
- Migration: stored values (10, 12.5) carry over as X — intentionally tightens
  heavy assets. REARM stays 0.5 × effective threshold. Tether stays note-only.
- UI: "Trigger @" column (per-asset effective drift threshold); settings and
  email copy speak in price-move terms.

## Phase 1.5 — Read-only exchange integration (Kraken, Bitso)
**Status: BUILT — tests green (npm test). Awaiting the user's read-only API
keys to go live** (Kraken MAIN, Bitso MAIN confirmed; Bitso ANNA TBD — stays
on screenshot import). Keys are entered per profile in the UI (stored
server-side in the DB, masked to last-4 everywhere; creation checklist with
scopes + IP pinning in EXCHANGES.md). Deploy gate: link both accounts, watch
the first syncs reconcile cleanly (balances explained, no spurious pending
flows), confirm one real deposit end-to-end, THEN consider auto_flows.

- ~~FIRST TASK~~ DONE: endpoint capabilities verified live 2026-07-17 —
  findings in **EXCHANGES.md**. Highlights: Kraken OHLC = 721 candles/interval
  (~2y daily), altname/pair metadata public, Ledgers filterable to
  deposit/withdrawal; Bitso's documented v3/ohlc 404s but
  bitso.com/api/v3/ohlc serves MULTI-YEAR daily history (3y confirmed) incl.
  usd_mxn (direct MXN rate, no CG cross-call).
- Shipped in this phase: lib/exchanges/{kraken,bitso}.js (read-only signed
  clients + public market data), lib/sync.js (reconciliation engine),
  lib/exsource.js (exchange-first pricing/history), pending-flow confirm UI,
  fee calibration from real fills (observed %/leg + one-click apply),
  scheduler auto-sync per account (sync_minutes, default 60), diagnostics
  endpoint (/api/diagnostics), scripts/import-ohlcvt.js (bulk seed),
  EXCHANGE_MARKET_DATA env kill-switch. Alert emails now say the sync closes
  the loop when an account is linked. Tests: test-sync-reconcile,
  test-exchange-normalize, test-exsource.
- Read-only API keys per profile (balance/trade/ledger scopes only, no trade/
  withdraw permissions; IP-pinned to the VPS where the venue supports it).
  Stored server-side (env or DB), never in the repo, masked in diagnostics.
  Bitso ANNA may stay on screenshot import (third-party account) — sync is
  per-profile; screenshot import remains as fallback input.
- **Reconciliation engine** (the point of the phase): each sync, explain the
  quantity diff — trades (from trade history) update quantities with NO splice
  (trading is the harvest registering); deposits/withdrawals (from the ledger)
  apply the flow splice with exact amounts and real timestamps. Balance/trade
  sync applies automatically (ground truth); detected flows surface as a
  pending confirmation initially (a wrong flow splice silently corrupts the
  basket) — full-auto once trusted.
- Alert loop closes: alert → user trades on the exchange → next sync sees the
  fill → quantities update → notifications re-arm automatically (the
  awaiting_upload state and 12h timeout stop being the user's problem).
- Cost model gets real: actual fills and fees from trade history calibrate
  fee_pct/spread_pct and validate the sweep against genuinely executed trades.
- **Multi-year history layer:** Kraken live OHLC ≈ last 720 candles per
  interval (~2y daily) and full-history OHLCVT bulk files (1m→1d, quarterly);
  Bitso depth TBD (books are the actual traded MXN/USDC markets — truer
  prices even if shallow). Cache architecture: bulk seed → exchange API
  top-ups → CoinGecko fallback (sole source for scanner candidates — the
  scored universe needs one uniform source). Held assets get priced from
  exchange data, cutting CoinGecko quota use.
- This phase upgrades Phase 2's statistical power (multi-regime windows) and
  Phase 3's envelope honesty (real multi-cycle drawdown history).

## Phase 2 — Threshold sweep (advisory backtest tuner)
**Status: SHIPPED — tests green (test-backtest.js: sinusoid interior
optimum, downtrend warning path, cost→looser, sim==production parity,
staleness hash).** lib/backtest.js simulate()+sweep(), job endpoint
POST /profiles/:id/tune-threshold, apply with staleness refusal, UI table
under "Sensitivity tuner". Design addition beyond the original spec: the
HOLD baseline joins the value plateau as its floor — in a pure trend every
X "wins" against the other Xs while all of them lose to doing nothing, and
without the floor the sweep recommended the least bad way to bleed
(caught by the downtrend validation case). Second addition (user challenge
2026-07-18): the plateau band is noise-scaled — max(0.5pp, median absolute
adjacent-X difference) per metric — because single-path backtests are lumpy
(live Kraken sweep showed ±2–5pp basket wobble between adjacent X from
trade-timing alone) and differences below the wobble are seed noise.

## Phase 2.5 — Hourly-granularity backtests
**Status: SHIPPED (tests green: test-hourly.js).** Fully automatic
acquisition, NO manual downloads and no accrual wait — hourly_prices fills
years deep on first use via a per-asset source ladder (persisted per asset
so a series never mixes venues): (1) Bitso *_usd / usd_<fiat> books —
multi-year hourly in ONE call; (2) Binance public data portal — monthly 1h
kline zips (minimal in-repo zip reader, ms AND 2025+ microsecond
timestamps handled) + REST mirrors (api.binance.vision → api.binance.com
fallback; symbol existence provable from the portal alone when REST is
blocked) — verified live: FILUSDT/QTUMUSDT/SCUSDT all covered; (3) Kraken
raw-trades candle rebuild (resumable background job, keyless, back to
inception) for anything neither lists; (4) CoinGecko 90d hourly stopgap.
Daily top-ups in the scheduler keep series current. The threshold sweep
gained bars=daily|hourly and an exec-lag knob (6h/1h); uniform granularity
only, thin coverage fails with names while backfills run. Kraken bulk
OHLCVT CSVs: demoted to never-needed (import script remains as a
power-tool). Composition search still scores on daily bars (candidates are
CG-uniform); hourly is for refining a chosen mix's X.

## Phase 2.9 — Deep daily history + market-regime stratification
**Status: SHIPPED (tests green: test-deepdata.js, test-regime.js,
test-compose.js regime path).** Two coupled upgrades so the composition
search can answer "does this mix work across market types, not just on
average over one window."
- **~4-year daily depth from data-only venues.** CoinGecko caps at 365d and
  Kraken live OHLC at ~720 candles; neither reaches the multi-cycle depth a
  regime study needs. Binance and KuCoin are added as DATA SOURCES ONLY
  (never trading venues — we still trade on Kraken/Bitso): `lib/exchanges/
  binance.js` gained `dailyClosesDeep` (monthly 1d kline zips from the public
  data portal, back to listing), `lib/exchanges/kucoin.js` (NEW) pages daily
  candles backward and reaches today, and `lib/exsource.js` `deepDailyByDay`
  tries Binance first then merges KuCoin to heal a stale head (api.binance.
  vision REST is geo-blocked 451; KuCoin covers the recent tail). `lib/
  history.js` routes requests deeper than the exchange cap through the deep
  path (default 1460d) and always tops up the recent head. Live-verified:
  ~1460 daily closes for SOL/BTC. Survivor universe measured empirically —
  at 4y, 29 coins carry full history; Kraken already lists 58/75, so the
  bottleneck is data depth, not tradability (Binance/KuCoin as trading
  venues would add only ~4 coins — not worth the split; ONE multi-venue
  tool, no fork).
- **Regime classifier (`lib/regime.js`).** Labels each day of a BTC benchmark
  bull / bear / range from trend (price vs a 50d MA + its 20d slope) and
  drawdown from a ROLLING 90-day high (not all-time — a sideways bottom
  after a crash must read RANGE/mean-reverting, not perpetual bear), then
  segments into contiguous swaths with a 20-day minimum-length merge.
  `classify()` returns swaths + per-type day counts + `enough` (≥2 types
  with ≥20d each). Real-BTC-validated.
- **Regime-stratified scoring (`lib/compose.js`).** The search now has two
  validation MODES chosen automatically by benchmark diversity: FOLDS
  (shallow venues, e.g. Bitso — the Phase 2.75 walk-forward across 4
  sequential folds + holdout) and REGIME (deep venues, e.g. Kraken 4y —
  a mix's harvest edge measured PER market-type by simulating each swath
  independently, then aggregated). Two honest metric families surface
  side by side: **consistency** = worst-type edge (harvests even in its
  weakest regime) and **average** = equal-weighted mean across types (so a
  mix that only shines in bull markets can't hide behind its average). A
  mix is recommended (★) only if it harvests in EVERY present type (≥2)
  with a positive holdout edge. The current mix is still reference-only,
  never a bar to beat. `runComposeSearch` builds a BTC benchmark aligned to
  the bars; the UI (`public/app.js`) branches on `r.mode` and renders
  Types✓/Bull/Bear/Range/Worst/Avg/Holdout for regime mode, folds columns
  otherwise, with the byType breakdown in the stamp. Live E2E (Kraken
  replica, 1460 bars → 1168 in-sample / 292 holdout): top mixes flag ★ with
  types 3/3, positive per-type and holdout edges.

## Phase 2.98 — Honest bull/bear/range taxonomy (centered trend)
**Status: SHIPPED (tests green: test-regime.js, incl. anti-lag).** The first
regime classifier (trailing 50d-MA slope + rolling-90d-high drawdown) was
dishonest on real BTC: over 2022-07→2026-07 it labelled only ~1% of days bear
(21 of 1460), because a trailing MA lags every turn and a rolling-90d high
tracks a slow grind down so its drawdown never fires. Rewritten to a CENTERED,
smoothed trend: smooth daily closes, measure the price change across a ±45-day
window (looking symmetrically forward and back), and call >+12% bull, <−12%
bear, else range; ends fall back to a shorter one-sided window with a
span-scaled threshold; 25-day minimum swath. This is legitimate because the
labels ONLY characterize the historical record for performance attribution —
they never drive a live trade — so look-ahead is free, and it removes the
turning-point lag that made a +37% rally read "bear." Validated against real
BTC/USD: **43% bull / 27% bear / 30% range**, with swaths on the actual cycle
(2022-H2 bear to ~$16k, 2023 recovery, 2023-10→2024 bull, 2024 mid-year range,
2025-09→2026-04 drawdown). Anti-lag test locks in that a V-recovery's rising
leg reads bull, not lagged bear. `lib/regime.js` — same `classify()` shape, so
the composition search picks it up unchanged.

## Phase 2.97 — Deep fiat crosses (no cross ever limits the window)
**Status: SHIPPED (tests green: test-deepdata.js fiat path).** The deep-daily
upgrade let crypto reach ~4y while a fiat index (Bitso MXN) stayed capped at
~2y (fiat was excluded from the deep path; the regular exchange path caps at
MAX_EXCHANGE_DAYS=730), so the tether — which every mix is denominated in —
became the thing that limited the backtest window. Fix, no new external
dependency: **route fiat deep through Bitso's OWN `usd_<code>` book** (its
undocumented OHLC serves ~4.8y for usd_mxn, verified back to 2021-09 —
`bitso.dailyCloses(..., {invert:true})`, already wired), so MXN gets ~4.8y of
the genuinely-traded rate (better than an ECB reference rate for a Bitso
trader; the recent window and the deep tail come from ONE source, no seam).
For any fiat short of the requested window (a fiat Bitso trades shallow, or
none at all), a **synthetic flat backfill** holds the earliest known
cross-rate constant back to the window start — real data where we have it, a
constant extrapolation before it, not persisted (cache stays real-only) — so a
short cross never gates the study ("synthetic if necessary"). Applies to both
Kraken (usd index already synthesized 1:1) and Bitso fiat crosses. Checked:
neither Binance nor KuCoin can substitute — KuCoin lists no MXN; Binance lists
USDTMXN/BTCMXN but only since 2024-04 (~2.3y). The window-start clamp (window
can't predate the tether) stays as a safety and is now a no-op once the fiat
covers the full span.

## Phase 2.95 — Current-set allocation × sensitivity
**Status: SHIPPED (tests green: test-compose.js current-set path).** A focused
mode of the composition lab (toggle "Current holdings only"): instead of
searching the whole tradable universe, it keeps the profile's EXACT asset set
— index + every position, frozen included, nothing added or dropped (no
subsets) — and searches only the SPLIT. Each asset roams **4–80% on a 1%
grid**, summing to 100; the space is sampled densely (same broad → full →
greedy-refine funnel, minus the solo screen and asset-swaps). Every candidate
split is scored **jointly across the full sensitivity grid** (the folds/regime
scorer already sweeps MINI_X per window), so allocation and sensitivity
permute together; each finalist carries its whole X sweep (value + edge over
holding per X, best X starred) rendered inline under the mix, so the split ×
sensitivity interaction is visible the way the tuner shows its X grid. Ranking
and the honest no-harvest verdict are identical to the lab (robust harvest
edge, walk-forward on shallow venues / per-regime on deep ones); the current
mix is scored for reference only. Runs on Bitso (folds mode) as the acceptance
gate. `lib/compose.js` `searchCurrentSet` + `runCurrentSetSearch`; server
passes `currentSet` through the existing compose endpoint; UI adds the toggle,
the per-row × sweep, and mode-aware stamp/notes. Bounds note: 4% floor + 80%
cap means the ceiling only binds for small sets (Bitso's 4 assets can
concentrate to ~80%; an 8-asset set tops out near 72% since 7×4% is committed).

## Phase 2.75 — Composition sweep (empirical mix search)
**Status: SHIPPED (tests green: test-compose.js — synthetic universe with a
known answer: oscillators surface, terminal decliners exiled, constraints
hold, OOS real, seed-deterministic).** lib/candidates.js + lib/compose.js +
the Composition lab UI (intensity knob quick/standard/intensive, OOS-first
table, current mix as highlighted baseline). Hardened 2026-07-18 after the
first live run failed: candidates are RESTRICTED to the linked venue's
tradable assets (a mix the account can't execute is a fantasy; dropped
symbols listed in the stamp), candidate history now flows through the
exchange layer via symbol hints (CoinGecko's 365d cap had starved every
non-held candidate against 720d-deep held assets), fresh-but-shallow cached
series deepen instead of sitting at the cap, and the evaluation window
auto-shrinks (floor 240d) to what ≥70% of the universe can cover instead
of failing. Search: solo screen (weed candidates one at a time) → broad
seeded sampling (quick 20k / standard 100k / intensive 1M combos, cheaply
scored into a bounded contender board) → full two-half fidelity on ~500 →
greedy refinement (2.5%-unit weight jiggles, tether-band moves, asset
swaps) → held-out out-of-sample confirmation; runs yield the event loop
and report % progress (real bar in the UI). Two corrections 2026-07-18
(from the Bitso MAIN divergence with the tuner): (a) the mini X-grid now
spans the tuner's full range {3,5,8,12,20,25,30} — a mix whose optimum is
high (the MXN Bitso mix peaks near 25) is no longer under-scored by a grid
that stopped at 20; (b) the SELECTION metric is now harvest EDGE (value
above holding), not absolute value — a mix that merely appreciated in the
train window scores ~0 and can't crowd out genuine harvesters (verified: a
+1000% pure trender = 0.00 edge vs a real oscillator's 7.05). Train column
shows edge; display columns keep absolute value/hold/x.
Third correction 2026-07-18 (Bitso results were misleading): (1) WALK-FORWARD
validation — the single regime-boundary train/OOS split replaced by
N_FOLDS=4 sequential in-sample folds + an untouched holdout tail; selection
ranks by robustness (how many folds harvested, then median fold edge, then
holdout edge), so one crash window can't crown or doom a mix; (2) HONEST
no-harvest verdict — a mix is recommended (★) only if it harvested in a
majority of folds AND kept a positive holdout edge; when none qualify the
result carries noHarvest=true + a warning instead of a leaderboard of
capital-preservation mixes; (3) the current mix is scored for REFERENCE
only, never a bar to beat (one window's number is noise). Verified live
(Kraken): top mixes harvest 4/4 folds with positive holdout edge → ★.
Motivating evidence (live Kraken
MAIN sweep): over 2024-07→2026-07, FIL −83%, POL −84%, QTUM −75%, SC −89%,
DOGE −44% — a ~30% target sleeve of terminal decliners that rebalancing
bought all the way down, funded by selling the assets that worked (XRP
+81%, BTC round-tripping). No X beats holding on that mix; the mix is the
problem, not the threshold. Bitso MAIN (BTC/XRP/DOGE vs a fat MXN sleeve,
boom-bust round trips, no terminal decliners at weight) beats holding at
every X.
- Search: current assets ± scanner candidates (≤8 per mix); targets on a
  constrained simplex (tether 10–25%, per-asset cap 25%, 2.5–5% steps,
  sum 100). Random/Latin-hypercube sample + local refinement; each mix
  scored by a mini-sweep (few X) on value growth, subject to basket
  agreement and a drawdown cap.
- Overfitting rails (non-negotiable): sub-window stability, out-of-sample
  confirmation (fit early window, confirm late), costs always on, and the
  hindsight caveat rendered WITH results — picking past winners is
  selection bias; output is a candidate mix to consider, never a promise.
- Advisory-with-apply: winning mixes load into the existing targets editor
  (which splices the basket); nothing auto-applies.

- `lib/backtest.js` `simulate(assets, targets, X, {feePct, spreadPct,
  lagHours, history})`: start at target weights; uniform granularity (no
  hourly/daily splicing — breach density jumps 24× at the boundary); same-bar
  multi-asset breaches computed from ONE pre-trade snapshot and applied
  jointly (exactly what production emails; test asserts simulator trades ==
  production trades); execution at first data point ≥ breach_ts + lagHours
  (default 6h); cost = (fee+spread)/leg; basket chain-linked as production.
- Returns {netBasketGrowth, terminalValue, maxValueDrawdown, tradeCount,
  feesPaid}.
- **CRITICAL:** the basket alone is a price-blind objective — any
  buy-below-snapshot raises it, including feeding a terminal downtrend
  (simulated: basket +16.6% while value did 41pp worse than holding). The
  sweep reports basket AND value curves and recommends X only where both sit
  on a plateau; divergence renders a warning instead of a recommendation.
- Plateau: absolute (within 0.5pp of best net basket growth), take the looser
  end; show tradeCount per X; warn when the winning region has <10 trades;
  stability across 2–4 sub-windows (multi-year once 1.5 lands).
- Staleness: results stamped with {targets hash, fee, spread, data range};
  Apply warns/refuses if inputs changed. Quantity changes do NOT invalidate
  (sim starts at target weights).
- Validation: sinusoid → interior optimum (basket & value agree); pure trend
  → basket-positive but value-negative → warning path; higher cost → looser
  optimum.

## Phase 3 — Safety rails
**Status: SHIPPED (tests green: test-safety.js).** lib/safety.js exactly to
the spec below: engine-level BUY suppression, latched notices bypassing the
armed machine, auto-unfreeze at 0.75×, 🧊 badge + manual unfreeze in the
UI, depeg watch with hysteresis ($0.98–1.02 enter, $0.99–1.01 exit) priced
from raw exchange quotes (the engine pins tether valuation, so the market
quote is fetched here). Scheduler runs safety after every poll; the daily
cache refreshes once a day for the envelope. The composition search
excludes buy-frozen assets from its universe.

Structural-break buy-freeze (`assets.buy_frozen`):
- Rules: (a) envelope = 1.25 × deepest RECOVERED drawdown in available
  history, clamped to [40%, 85%], same peak convention (trailing high) both
  sides; SKIPPED when history <180d or no recovered ≥20% drawdown exists;
  (b) fast-crash: ≥40% drop within 7 days.
- Known false positives, accepted knowingly: Mar-2020 BTC, May-2021 ETH would
  freeze buys mid-capitulation. Bounded: SELLS unaffected, manual unfreeze,
  advisory-only. Auto-unfreeze at 0.75× trigger sends its own notice.
- Suppression point is the ENGINE (evaluateProfile), not the mailer:
  frozen-asset BUY breaches are filtered before decideNotification — they
  neither email, nor mark alloc_alerts, nor consume the armed state. SELL
  breaches pass through.
- Freeze/depeg alerts: latched (once on entry, once on recovery), routed like
  sendStatusReport — honor recipients + alerts_enabled but BYPASS the
  armed→notified machine. UI badge + manual unfreeze.
- Depeg watch: pegged COINS with a real market quote only (tether, usd-coin,
  dai…; 'usd'/'fiat:usd' have no market price — guarded). Raw fetched price
  vs $0.98–1.02; valuation stays pinned 1:1 — user decides.

### Phase 3.5 — Market-relative freeze (SHIPPED 2026-07-18, blend benchmark)
Tests green (test-safety.js). `marketDrawdown()` blends BTC's drawdown with
the MEDIAN drawdown across the cached universe (stablecoins/fiat excluded;
BTC-only or absolute fallback when the cache is thin). The freeze now fires
only on IDIOSYNCRATIC breakdown — `excess = asset_dd − market_dd ≥ 20pp`
AND past the asset's own envelope (or a fast idiosyncratic crash) — with an
absolute-catastrophe backstop (≥90% dd freezes regardless of the market).
Auto-unfreeze when the drawdown eases (0.75× trigger) OR the asset catches
back up to the market (excess < 0.6× the margin), so a name frozen for
idiosyncratic weakness rejoins harvesting once the whole market falls to its
level. A broad tandem drawdown now freezes NOTHING — the pool keeps
trading — which was the whole point. Verified: idiosyncratic→frozen,
market-catches-up→unfreeze, tandem→never frozen, catastrophe→always,
blend math + stablecoin exclusion.

## Phase 4 — Target suggestions (composition advisor)
**Status: not started**

- Algorithm (ordered): (1) tether allocated from its band 15–25%; (2) rest
  weighted ∝ 1/vol (90d realized), EXCLUDING the tether; (3) iterative
  water-filling for the 25% per-asset cap; (4) drop <3% positions (suggest
  removal) and re-run; (5) round to 0.5% with largest-remainder to exactly
  100. Fiats will pin at the cap (documented; the cap is what stops low-vol
  domination strangling the harvest).
- Buy-frozen assets: suggestion capped at current weight, with a note.
- UI: current vs suggested side-by-side with per-asset swing contribution;
  "Load into targets editor" prefills the existing editor; saving uses the
  existing setTargets splice (basket continuity automatic).

## Phase 5 — Top-N candidate scanner
**Status: not started**

- Universe: /coins/markets top 100 by cap (1 call). Stablecoin/wrapped
  exclusion via category-filtered calls (?category=stablecoins,
  ?category=wrapped-tokens — the markets payload has no per-coin category
  field), plus name heuristics and already-held filter. History per survivor
  from the cache. genesis_date dropped (≈100 extra /coins/{id} calls); age =
  earliest available history + cap rank.
- Scores labeled by their data window (1y on CoinGecko; longer where exchange
  history exists):
  - Survivorship: cap rank + age-within-window.
  - Choppiness: annualized vol × mean-crossing rate of 30d-detrended series,
    normalized 0–100 by rank percentile across the scanned universe.
  - Recovery: episodes = peak → first return to peak; fraction of ≥15%
    drawdowns recovered, EXCLUDING right-censored episodes (<180d post-trough
    data); suppressed as "insufficient history" below 2 episodes.
  - Diversification vs the CURRENT pool: signed — (1 − max_j corr_ij)/2, so a
    negative-corr diversifier scores near 1 instead of like a clone.
  - Composite 25/30/25/20; all sub-scores displayed and sortable.
- "Add to profile" uses the existing add-asset flow at target 0%.
- Bundled fix: evaluateProfile's completeness gate (breach checks skip when
  ANY asset is unpriced) must ignore zero-target assets — one flaky fringe
  candidate must never silently disable a profile's alerting.

## Cross-cutting

- Idempotent migrations (ensureColumn pattern) throughout.
- Diagnostics extended each phase (cache freshness, ledger, jobs, fee/spread,
  frozen/depeg state) so the deploy gate means something.
- Ship order: 0+1 (one deploy), 1.5, 2, 2.75, 3, 2.5 — all shipped.
  Remaining: 4 (composition advisor UI/loader — much of its analytical core
  now lives in 2.75), 5 (top-N scanner — candidates.js already does its
  universe work), and the cutover gate. Nothing auto-applies, ever.
