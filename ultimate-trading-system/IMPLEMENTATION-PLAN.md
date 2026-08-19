# Implementation plan — Live Trading release (from NEXT-RELEASE.md)

Scope: the CURRENT release, built inside general-classifier (NEXT-RELEASE
point 6). UTS-only items (subscriber DB/login, zero-knowledge custody UI,
alternate exchanges, help system, guided VPS, pricing) are NOT in this plan
except where a cheap seam now keeps them possible later.

Status legend: [ ] todo · [~] in progress · [x] done · [P] PARKED (blocked,
written up, moved on). Complexity: S(mall) / M(edium) / L(arge).

---

## THE AUTONOMY PROTOCOL — SUPERSEDED (2026-08-19)

Replaced by `CLAUDE.md`, RULE SIX — the long loop. The standing parts of this
protocol (work an approved body of steps through without asking, park what is
blocked, the escalation triggers, the decision log) now live there and apply
only while the owner has switched the loop on with `LOOP NOW!`. The
project-specific authorizations that were recorded here belonged to the F1
pilot and are closed.

---

## NON-REGRESSION RULES (owner directive: take nothing down)

- **The running F1 pilot is untouchable.** lib/pilotsignal.js,
  lib/pilotmirror.js, pilot-produce.js, pilot.html and the installed
  timers/scripts keep serving the live F1 book unmodified while the
  generalized machinery is built ALONGSIDE them (new modules, new files). The
  same rule that already protects lib/tracker.js (byte-identical) applies in
  spirit to the whole live path.
- **Full test suite green at every commit.** A red suite never ships; a
  failing step is fixed or reverted the same night.
- **Every new HTTP endpoint gets a real over-the-wire test** in the spawn-
  server harness (tests/test-armendpoint.js pattern) — the QC-114/115 lesson
  is now structural.
- **Money-path guards get watched-failing tests** (QC register discipline).
- **F1 cutover to the generalized engine is a SEPARATE, owner-gated event**
  (Phase 10), preceded by a byte-identical parallel paper run. Until then the
  old and new stacks coexist.

---

## PHASE 0 — Scaffolding & ground rules (S)

- [x] 0.1 Create module boundary: `lib/live/` for all new Live-Trading
      backend code; `public/livetrading.html` (+ its JS) for the tab. No new
      code added to the research-side files. Document the shared-core list
      (lib/binance.js, lib/dataset.js, lib/logreg.js, lib/paper.js,
      lib/bracket.js) — read-only imports from live code; never modified for
      live-side convenience without a parity test.
- [x] 0.2 Add `tests/test-live-*.js` scaffolding to the runner.
- [~] 0.3 Nav: add the Live Trading tab entry point (served like pilot.html;
      the website-branch portal tile is a separate later deploy and NOT
      required for development — the tab is reachable directly).

## PHASE 1 — TradingSetup entity + registry (M) [NEXT-RELEASE 3, 10-prep, 20]

- [x] 1.1 Define the TradingSetup record (JSON schema v1, stored one file per
      setup under `data/live/setups/`): id, ownerId (single owner for now —
      point-10 prep), name, state (draft|paper|live|stopped|retired),
      configSnapshot (IMMUTABLE — the shuttled lab config, point 4),
      engineVersion (point 18), provenanceRef (point 13), tradedPair,
      clipUsd (point 20), stopPct, executionTargetRef, keyRef,
      createdUtc/stateHistory.
- [x] 1.2 `lib/live/setups.js`: CRUD with atomic writes, schema validation,
      state-machine transitions (draft->paper->live etc., each logged), list/
      page API. No deletion of non-draft setups (retire instead — audit trail).
- [x] 1.3 HTTP endpoints `/api/live/setups*` (GET list/detail; POST create-
      from-shuttle only — no hand-built live configs, point 4; POST state
      transitions). CSRF-guarded like arm/disarm. Over-the-wire tests.
- [x] 1.4 Unit tests: schema validation, immutability of configSnapshot,
      state machine, atomic write crash-safety.

## PHASE 2 — One parameter vocabulary + generalized signal producer (L)
[NEXT-RELEASE 5 — the core engineering item]

- [x] 2.1 Audit lib/bracket.js + lib/forwardbook.js + lib/dataset.js and
      extract the COMPLETE parameter vocabulary a lab config expresses
      (combo/pairs, geometry, anchor, offsets, hold, committee members,
      quorum, band, entry style, gate, stop, fees). Write it down as a
      versioned schema (`lib/live/configschema.js`) consumed by BOTH sides.
- [x] 2.2 `lib/live/signal.js`: generalized producer — given a TradingSetup,
      trains/loads the frozen committee from configSnapshot, computes the due
      chunk from the setup's own geometry, fetches the live entry open (the
      QC-109 mechanism, generalized), returns an intent tagged with setupId.
- [x] 2.3 **Golden parity gate — PASSED 12/12 byte-for-byte on the VPS cache**
      ~~(blocks all later phases)~~ CLEARED. Original text: (blocks all later phases):** F1 expressed as a
      TradingSetup must reproduce the existing pilotsignal decisions
      BYTE-IDENTICALLY over the full replayable history (sides, votes,
      hashes, prices), and match lib/bracket.js simulated calls for the same
      config. Any divergence is an instrument defect — fixed before
      proceeding (QC lesson: broken instruments return plausible numbers).
- [ ] 2.4 Multi-setup produce loop: iterate all paper/live setups, emit one
      intent per due setup. Per-setup decision records (mirror twin, QC-110
      pattern) keyed by setupId.
- [x] 2.5 Tests incl. parity harness kept permanently in the suite.

## PHASE 3 — Generalized executor (L) [NEXT-RELEASE 5, 20, 16-partial]

All built and unit-tested WITHOUT deploying to the box (Phase-10 gate).

- [x] 3.1 mx_executor generalization (vps-access branch): intent schema v2
      carries setupId + full execution params (symbol, clipUsd, holdHours,
      stopPct); executor validates against its per-box setup allowlist;
      dedup key becomes (setupId, chunk_start); journal events tagged with
      setupId; per-setup halt vs box-wide halt distinguished.
- [x] 3.2 Paper mode in the executor (point 15): a setup in paper state runs
      the identical path with a simulated fill at the live price, journaled
      as PAPER_* events — same journal, no orders. Bypassable: live setups
      skip paper entirely.
- [x] 3.3 Backward compatibility: schema-1 intents (running F1) keep working
      untouched — the executor serves old and new concurrently.
- [x] 3.4 Test suite extension: multi-setup replay, paper fills, allowlist
      rejection, per-setup halts, schema-1 regression tests.

## PHASE 4 — Campaign provenance + greenlight + shuttle (M) [NEXT-RELEASE 4, 13, 18]

- [~] 4.1 Campaign parent-job entity: the existing campaign prefix becomes a
      real record (`data/campaigns/`); lab runs (sweeps, nulls, tuning)
      attach as children; tree queryable.
- [x] 4.2 Greenlight state on a lab config: owner-triggered, stores WHO/WHEN/
      WHY + the full provenance chain + engineVersion at greenlight time.
- [x] 4.3 Shuttle: button on a greenlighted config -> POST create setup
      (draft) with immutable snapshot + provenance + engine version. UI jump
      to the new setup.
- [x] 4.4 Tests: provenance chain integrity, snapshot immutability, no
      shuttle without greenlight, greenlight requires a campaign.

## PHASE 5 — Live Trading tab UI (M) [NEXT-RELEASE 1, 12, 15, 20]

- [x] 5.1 `public/livetrading.html` born with sub-tabs (point 12): Setups
      (pager) | Setup detail | Journal & reporting | Data & health.
      Paper setups appear IN THE SAME pager/views with identical display and
      formatting — distinguished only by an unmissable PAPER badge (owner
      amendment to point 15: no separate paper view; must always be clear it
      is not real money).
      Styling via shared theme tokens from day one (point 24): dark mode in
      the pilot.html technical/compressed style (the baseline), light mode in
      the Bracket Lab style — so the tab carries into UTS unchanged.
- [x] 5.2 Setup detail: config (read-only snapshot + provenance link), state
      controls (paper/live/stop — live-arm is owner-gated, see protocol 3a),
      clip size editor (point 20, exchange-minimum bounded), stop config,
      execution target, key status (present/absent only).
- [x] 5.3 Per-setup dashboard: the pilot.html views generalized — status,
      balances, open/closed positions, unrealized P&L at mark, incidents,
      preview, fidelity tiles — driven by setupId.
- [~] 5.4 Per-setup arm/disarm endpoints, CSRF-guarded, with the point-115
      client error-surfacing pattern from day one.
- [x] 5.5 pilot.html STAYS as-is serving F1 until cutover.
- [x] 5.6 Over-the-wire endpoint tests + client JS syntax gate in the suite.

## PHASE 6 — Safety rails + fidelity per setup (M) [NEXT-RELEASE 16, 17]

- [x] 6.1 Mirror generalized: per-setup decision records recomputed against
      fresh data; a break disarms THAT setup (box-wide only on systemic
      faults). QC-110 price_pending semantics carried over.
- [ ] 6.2 Alerting generalized: per-setup halt/heartbeat/stale/incident
      pages, setup name in every subject line.
- [x] 6.3 Fidelity report per setup: fill deviation, realized fee/leg vs
      model, live-vs-lab expectation tracking — the pilot's metrics as a
      standard per-setup view (point 17).
- [ ] 6.4 Watched-failing tests for every rail.

## PHASE 7 — Data catalog + repair (M) [NEXT-RELEASE 19]

- [x] 7.1 Catalog: manifest of required data derived from active setups
      (pairs x date ranges), stored server-side (`data/catalog.json`),
      checksums per file.
- [x] 7.2 Verify-and-repair operation: compare local store to catalog, flag
      MISSING/CORRUPT, re-fetch from the exchange public channel. Runs on
      tick start, on schedule, and on any read miss.
- [~] 7.3 Data & health sub-tab surface: catalog status, missing flags,
      repair button + last-repair log.
- [x] 7.4 Tests incl. deliberate deletion -> flag -> rebuild round-trip.

## PHASE 8 — Configurable execution target + adapter seams (M)
[NEXT-RELEASE 3, 7-prep, 9-compat]

- [ ] 8.1 ExecutionTarget record (host, transport descriptor); per-setup
      binding; this release ships ONE implementation (current VPS->box ssh
      carry) behind a transport interface, with all messages (intent, journal,
      arm) as transport-neutral schemas — the point-9 dial-out worker becomes
      a second transport later without touching the engine.
- [ ] 8.2 Exchange adapter seam: lib/live code calls the exchange through an
      adapter interface (data fetch, order, account) — Binance is adapter #1
      (point 7 prep; no second adapter this release).
- [ ] 8.3 Key reference plumbing (current-release scope of point 3/11): setup
      carries keyRef; the box env maps keyRef->credentials; UI shows presence
      only. (Zero-knowledge custody UI is UTS.)

## PHASE 9 — Migration & polish (S)

- [ ] 9.1 F1 registered (read-only) as setup #1 so the Live Trading tab shows
      it — still executing on the OLD rails.
- [ ] 9.2 NEXT-RELEASE.md cross-referenced: each point marked with its
      delivering phase; gaps listed honestly.
- [ ] 9.3 README/docs updated (architecture, setup lifecycle, protocols).

## PHASE 10 — Hardening + cutover gate (M) [OWNER-GATED at two marked points]

- [ ] 10.1 Full e2e adversarial review of the generalized money path (the
      standard four-lens pass; every finding fixed + watched-failing test).
- [ ] 10.2 HTTP-surface adversarial pass over every new endpoint (QC-115
      pattern: valid + malformed + cross-site).
- [ ] 10.3 Deploy generalized executor to the box **<- OWNER GO REQUIRED**
      (protocol rule 3a/4) — schema-1 F1 keeps running through it untouched.
- [ ] 10.4 F1 parallel paper run: F1-as-generalized-setup in PAPER mode
      alongside the live F1 pilot; N days of byte-identical decisions
      (N owner-set; suggest 7).
- [ ] 10.5 Cutover decision **<- OWNER GO REQUIRED**: retire old F1 rails or
      keep both. Never both writing orders for the same setup.

---

## Sequencing rationale

Foundation (1) before engine (2) because everything keys off the setup
record. Engine parity (2.3) gates everything downstream — a generalized
engine that doesn't reproduce F1 exactly is a broken instrument and nothing
built on it can be trusted. Executor (3) before UI (5) so the tab renders
real journals, not mocks. Rails (6) before any generalized setup could go
live. Phases 4, 7 are parallel-safe with 3/5 and are natural night work when
a main-line step parks.

## Decision log

(one line per non-obvious decision made under protocol rule 1; newest first)

- P6: per-setup view derives real+paper as SEPARATE ledgers from the synced journal; fidelity (fill dev, fee/leg) per setup. Mirror(6.1)+alerting(6.2) remain.
- P5: arm/disarm per-setup endpoints deferred with the box control-plane wiring (Phase 8/10) — state controls (paper/live/stop) are in; live-arm stays the box's ARM.
- P7: catalog is single-node now (catalog+cache co-located); subscriber-worker remote-store form is the same required-vs-present interface (point 19 future).
- P3: paper fills use the model's own fee rate (0.125%/leg) so paper == the lab's promise; fidelity then isolates execution.
- P3: one box serves ONE symbol (allowlist symbol affinity enforced); multi-symbol = a second executor instance/box, which the execution-target model already supports.
- P4: trainThrough = the selecting run's fire time (cache holds only closed candles, so fire time IS the data horizon) — the forwardbook freeze rule, always derivable.
- P4: 4.1 campaign tree BROWSER deferred to the UI phase; the greenlight record already carries campaign + manifest + run linkage (the provenance chain itself).
- P2: golden parity (2.3) runs ON THE VPS (live-parity-check/-result) — local tests must never write real-symbol cache files; fabricated ZZZQ* symbols only.
- P1: live->retired forbidden (stop first) so retiring a trading job is always two-step.
- P1: keyRef serialized as presence-only ('set'/null) on every HTTP path — key hygiene habit even for a mere reference name.
- P1: no HTTP create endpoint yet, on purpose — setups are minted only by the Phase-4 greenlight shuttle ("no hand-built live configs").
- P1: registry dir overridable via GC_SETUPS_DIR so tests never touch the real data/ tree.
- P0: 0.3 folded into 5.1 — a placeholder tab page adds nothing; the real page is born in Phase 5 with its sub-tab structure.
