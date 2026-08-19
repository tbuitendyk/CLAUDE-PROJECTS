# PILOT-F1 — live execution-fidelity pilot (pre-registration)

Committed BEFORE any API key exists and before any real order. Git history is
the timestamp. Owner's authorization, verbatim from chat 2026-08-11: *"we're
going to go live, small trades long and short"*, on the new Mexico box
(`admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com`), plus two
standing requirements given the same night: *"we are going to want a live
trade screen that tracks all details of what's going on in real-time"* and
*"we want all trading logic to be independent of your AI oversight"*.

## 1. Purpose — and the one thing this is NOT

The pilot measures **execution reality** against the paper assumptions every
book leans on: realized fee per leg vs the $0.125 model, fill price vs the
hourly-open the simulator uses, margin borrow cost for short legs, order
latency, reject/partial-fill behaviour, and operational failure modes.

**Pilot P&L is void as edge evidence, in either direction, permanently.** It
is never pooled with, compared against, or reported beside forward-book money
as if commensurate (FORWARD-BOOKS.md R1 protection extends here). The F1
forward paper book remains the only judge of the edge, its 30-trade floor
stands, and live SIZING remains a separate future decision that pilot results
cannot authorize. If the pilot makes money it proves the plumbing works; if
it loses small money it proves the same thing.

## 2. Instrument mirrored

The pilot mirrors the **F1 forward book recipe exactly as it accrues**
(lib/forwardbook.js: LTCUSDT traded, XRPUSDT+BCHUSDT context, daily-4d
argmax, slim 4-member committee trained once through 2026-06-30, 1-of-4
quorum, market entry, directional gate, 137h hold, band 1.69%) so every live
fill has a 1:1 paper twin. **Only LTCUSDT is ever traded.**

- Entry: ~01:00 UTC daily when the committee calls a side (chunk start +97h).
- Exit: entry +137h → ~18:00 UTC, 5.7 days later.
- Up to **6 concurrent positions** (137h hold ÷ 24h step, DERIVED).

## 3. Venue and mechanics

- Binance from the Mexico box (probe 2026-08-11: api.binance.com HTTP 200,
  egress Querétaro MX / AS16509; LTCUSDT status TRADING, margin allowed,
  minNotional $5.00, LOT_SIZE step 0.001, tick 0.01).
- **LTCUSDT isolated margin for both directions** — long = buy, short =
  borrow-and-sell — so the two legs run through identical machinery and the
  short side's borrow interest becomes a measured quantity instead of an
  assumption. Market orders only, mirroring the book's market cell.
- Clip: **$10 notional per position** (GUESSED: 2× the exchange minimum —
  large enough to fill and be fee-accounted, small enough that total pilot
  P&L is pocket noise). Peak exposure ≈ $60 + short-side collateral.
- Working capital: owner funds a **dedicated sub-account** with ~$150–200.
  Only that capital is ever at risk. Key: spot+margin trade ONLY, no
  withdrawal, IP-restricted to 78.13.103.81, stored ONLY on the Mexico box
  (never on the VPS — the deploy endpoint must not share a machine with a
  trading credential).

## 4. Independence rule (owner, 2026-08-11)

All trading logic is deterministic code on systemd timers. **No AI/LLM sits
anywhere in the signal, decision, or execution path** — extending the
project's standing no-AI-in-classification constraint to execution:

- VPS timer computes the committee signal from Binance public data with the
  frozen engine code and writes a signed order-intent record.
- Mexico-box timer validates the intent mechanically (schema, freshness,
  clip cap, kill-state) and places/settles orders. It never improvises.
- Claude sessions are **read-only observers and maintainers**: they read the
  journal, report, and propose code changes through the normal email+deploy
  discipline. No trade ever waits on, or is altered by, a session's opinion.
- **The owner's MASTER SWITCH (ARM) is the primary control.** The executor
  opens NO position unless the ARM flag is set, and the flag is set only by the
  owner pressing START on the live screen (a session must never arm it). It is
  absent by default, so a fresh box, a redeploy, or a wiped disk all come up
  STOPPED. The button writes an arm-request on the VPS; the produce timer
  carries it to the box and the executor journals the flip, so the screen shows
  "pending" until the box confirms and then RUNNING/STOPPED.
- A separate **halt flag** is the emergency stop: owner-operable, and a session
  may also set it if something looks wrong. Every use of either flag is
  journaled with who set it and reported by email the same day.
- Neither ARM-off nor HALT ever blocks a scheduled EXIT. Stopping the engine
  means "open nothing new", never "abandon an open position" — freezing an exit
  would convert a software doubt into unmanaged market exposure.

## 5. Journal, live screen, and the mirror-break detector

- The executor keeps an **append-only journal** on the Mexico box: intents,
  orders, acks, fills, fees, borrow events, balance snapshots, reconcile
  results, halts. The journal is the primary record; the exchange account is
  reconciled against it at every executor start.
- Every decision logs a **hash of the exact candles used**. Later, when the
  monthly zips publish, the same decision is recomputed from the archive; a
  mismatch (live data ≠ archival data) is a logged MIRROR-BREAK event and an
  email — this is the detector for "the live pilot quietly traded a signal
  the paper book never emitted".
- The journal syncs to the VPS on a timer and renders as a **live trade
  screen** in the classifier UI (behind the site's Basic Auth): open
  positions with age and unrealized P&L, every order/fill/fee, realized
  cost per leg vs the $0.125 model, signal history with input hashes,
  executor heartbeat, kill/halt state, reconcile status. Auto-refreshing;
  honest about its cadence (journal sync interval, not tick data).

## 6. Kill rules — all thresholds GUESSED, declared before any order

| Trigger | Action |
|---|---|
| 3 consecutive order rejects | halt new entries, email |
| Any fill deviating >1.0% from decision price | halt new entries, email |
| Reconcile mismatch (exchange ≠ journal) | halt new entries, attempt scheduled exits, email |
| Executor missed an exit hour (downtime) | flatten overdue positions immediately on next run, log the gap |
| Cumulative pilot loss > $50 (half the working capital) | halt everything, email, owner decision |

A kill firing is an **execution event**: it says the plumbing or its
assumptions failed, and it carries zero implication for F1's standing in the
forward book (gates judge the instrument; only replication judges the
candidate).

## 7. Build discipline

- Executor is a **separate, new module** (pure-stdlib Python on the box; no
  packages to install). Zero edits to engine files: lib/paper.js,
  lib/bracketwork.js, lib/forwardbook.js, lib/tracker.js, lib/dogebook.js
  stay byte-identical, verified by diff in the deploy email.
- Signal computation reuses the frozen engine exactly as the forward book
  does; if `assertFrozenMembersMatchEngine` ever throws, the pilot halts new
  entries too.
- Data for live decisions comes from Binance public endpoints (the same
  public channel the project is restricted to), fetched where reachable;
  the archival recomputation stays on the bulk zips as always.

## 8. Remaining gates, in order

1. This file committed (done — you are reading the timestamp).
2. Executor + screen built, tested dry (no keys), standard email sent.
3. Owner creates the sub-account + key (spot+margin trade, no withdrawal,
   IP-locked) and places it on the Mexico box; tells the session the path.
4. **Dust trade**: one $10 buy→sell round trip, declared plumbing-only, its
   full journal read back in an email. No model involvement.
5. Owner reads the dust-trade email and says go.
6. Timers armed; the pilot runs unattended.

Any change to this protocol after the first MODEL-driven order restarts the
pilot record with the reason written here (TRACKER.md rule). The pilot runs
until F1's forward book reaches its 30-trade reading, then its execution
report is written: realized cost-per-leg distribution vs $0.125, fill
deviation distribution, borrow costs, and every operational incident. That
report — not the pilot's P&L — is its deliverable.

## 9. Pre-arm safety verification (end-to-end adversarial review, 2026-08-11)

Before arming, the live environment was put through an end-to-end adversarial
review. Verdict: GO_WITH_FIXES — do not arm until the blockers below are closed.
This section is the standing record of their resolution; the rig stays STOPPED
(ARM absent, dead-man self-disarming) until every row is GREEN and the review
is re-run clean.

**The true loss ceiling is the API key's scoping, not the executor's $10/$50
limits** (finding 20, FATAL — a stolen key ignores in-code limits). Owner
confirmed IN WRITING (2026-08-11): the key belongs to a **dedicated sub-account**
funded only with pilot capital, **withdrawals DISABLED**, **spot+margin trade
only**, and it lives ONLY on the Mexico box (never the VPS). **The declared
maximum loss is the funded sub-account balance (~$150–200)** — CLIP_USD and
LOSS_LIMIT_USD are NOT the cap and must not be described as such.

Blockers and status:

| # | Blocker | Status |
|---|---|---|
| 6 | Partial in-progress candles cached & never finalized (train/serve mismatch) | FIXED — closed-hours-only cache, boundary re-fetch, finalized-candle guard |
| 20 | Blast radius = key scoping, unproven | CLOSED — owner confirmation above (sub-account / no-withdrawal / spot+margin) |
| 26+7 | Mirror check advertised but never computed | FIXED — computeSignalForChunk recompute vs recorded decision; MIRROR_BREAK halts the box |
| 1+2 | Order lifecycle not atomic/idempotent/recoverable | FIXED — deterministic client ids + resolve_dangling recovery |
| 16 | Loss kill blind to open positions | FIXED — mark-to-market kill each run |
| 17 | Realized P&L excludes short entry fee + interest | FIXED — both folded into the short exit P&L |
| 18 | Short-close under-repayment (interest-blind buffer) | FIXED — final close sized from live debt + residual-borrow HALT |
| 13+14 | STOP not fail-safe; no box dead-man | FIXED — dead-man self-disarm on control-plane loss; missing request = DISARM |
| 24+25+27 | No liveness signal / suppressed staleness / no alerting | FIXED — banner off executor heartbeat in all states; VPS alert timer emails on halt/dead-heartbeat/stale-sync/incident |
| 3 | Intent age on un-synced OS clock, no NTP | FIXED — exchange-synced age check, loud INTENT_STALE/CLOCK_DRIFT, chrony on both hosts |
| 8 | Actionable intent can ship decision_price=null | FIXED — null-price guard in the producer |
| 12+15 | Arm has no owner auth; flat-book wipe silently re-arms | FIXED — nonce+freshness+monotonic-watermark edge; arm now REQUIRES a shared secret + valid HMAC (fail-safe), STOP is unconditional. Owner provisions the secret to arm (§10) |
| 21 | Public deploy endpoint transitively controls the trading box | OWNER — infra, deferred by owner 2026-08-11 (blast radius key-capped) |

## 10. Pre-arm status (post re-review, 2026-08-11)

The end-to-end adversarial review was re-run after the fixes: verdict
GO_WITH_FIXES, five of six dimensions clean, every trading/money/mirror/liveness
blocker adversarially confirmed closed. Its two arm-blockers (B1, B2) — both in
the arm/disarm control plane — are now fixed in code and re-verified by test:

- **Arm authentication (findings 12/15, re-review B1/B2).** DONE in code. STOP is
  now UNCONDITIONAL (a kill switch is never gated behind auth). Arming now
  REQUIRES a shared secret (`PILOT_ARM_SECRET`) and a valid HMAC — with no secret
  the box REFUSES to arm (fail-safe), so nothing can open a live position without
  owner crypto. A monotonic watermark stops a captured request replaying past a
  STOP; the dead-man still self-disarms on control-plane loss. **The one owner
  step to arm: set the same `PILOT_ARM_SECRET` in the box `~/.executor-env` and
  the VPS UI env; until then the rig cannot arm.**
- **Deploy endpoint hardening (finding 21).** Owner deferred (2026-08-11):
  accepted risk, backstopped by the key scoping (sub-account / no-withdrawal /
  IP-whitelisted / ~$150–200 cap). IP allowlist + token rotation remain available
  if desired.
- **Non-blocking should-fix-soon** (all fail safe today) tracked from the
  re-review: mirror fails-open on an internal error (page/halt on stale
  mirror.json), decision-record write is best-effort (gate the ship on it),
  found:false can mask vanished data as pending, and the hash tripwire is
  informational-only. None blocks arming; scheduled as follow-ups.

## 11. Round-2 re-review + fixes (2026-08-11)

A second, three-lens adversarial review (arm/liveness, money-math, alerting) was
run against the round-1 fixes. Money verdict: **MONEY_SOUND** — the long entry-fee
correction was confirmed correct to the cent, and the reconcile/residual changes
only ever tighten safety. The arm-auth core (HMAC, monotonic watermark, future-utc
clamp) was confirmed sound. The liveness/observability lenses found a cluster of
**silent-failure** gaps; all are now fixed in code and covered by watched-failing
tests:

- **Heartbeat proved too early.** `RECONCILE_OK` fires before the due-exit step, so
  a box that reconciled then died in the exit loop read "green" while exits never
  fired. Heartbeat is now `RUN_STATUS`/`BALANCE` (both emitted AFTER exits), in the
  alert and the screen identically.
- **Alert was blind to arm/halt edges.** It derived `armed`/`halted` only from
  `RUN_STATUS`; a box armed via the CLI but hung before its first run cycle read
  `at_risk=false` and suppressed every liveness page — a silent dead-armed box. The
  alert now honors `ARM_SET`/`ARM_CLEAR`/`HALT_CLEAR` like the screen.
- **Silently-refused arm.** A START the box refuses (stale/future request, replay,
  no secret, bad HMAC) left the screen "arm pending" forever with no reason. Those
  four `ARM_*` events now surface as screen incidents.
- **Arm freshness judged on the box OS clock.** A skewed box clock could silently
  refuse a legitimate START. The arm path now judges freshness against
  EXCHANGE-synced time (falling back to the OS clock only if the sync fails).
- **Mirror could fail silent.** A deleted/corrupt `mirror.json`, or one that
  verified nothing, read as healthy. The alert now pages on an absent verdict while
  a position is open, on a corrupt verdict, and on `checked:0` with a position open.
- **Alert fatigue.** A per-kind incident cooldown caps a re-stamped condition to one
  page per hour instead of one per alert run.
- **Recovered-short P&L.** The crash-recovery exit now books a conservative borrow-
  interest estimate for a short, so a recovered P&L cannot be overstated.

**Accepted residual risks (fail-safe, documented rather than fixed):**

- **Trust model.** The dead-man protects against carrier DEATH, not a carrier that
  LIES: anyone able to replay a captured keepalive keeps an already-armed box armed
  (it cannot arm a stopped box). Within the "VPS + SSH is trusted" model this is the
  real boundary; a STOP takes effect only if the carrier is honest.
- **Corrupt arm-baseline.** An unreadable `arm-baseline.json` drops the replay
  watermark, so a captured <15-min arm could re-arm a stopped box. Narrow: writes
  are atomic (`tmp`+`os.replace`), so torn files are near-impossible.
- **Reconcile interest cap on a backward clock step.** An hours-scale backward jump
  can false-halt a multi-short book (deadlock, not loss). Both hosts are
  NTP-disciplined.

**Go-live checklist (owner):**
1. The same `PILOT_ARM_SECRET` is set on the box and the VPS (the provisioner
   fingerprint-matches both; a mismatch now shows on the screen as `ARM_NO_SECRET`
   / `ARM_HMAC_INVALID` instead of a silent refusal).
2. Box and VPS clocks agree (NTP up on both — the installer verifies this).
3. The box shows STOPPED (ARM absent) until you press START.
