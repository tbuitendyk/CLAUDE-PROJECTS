# Keeping General Classifier and UTS identical

UTS was forked from this project at commit `6f295b0` (2026-08-19 18:15 UTC) and
the folder renamed `general-classifier/` → `ultimate-trading-system/`. Apart
from that rename, **the two trees are meant to stay byte-identical.**

Every change made to one is logged here, with a prompt that reproduces it
exactly in the other. The owner is the project lead: divergence that is not
written down here is a defect, not a detail.

**Path mapping.** The only structural difference:

| this project | UTS |
|---|---|
| `general-classifier/…` | `ultimate-trading-system/…` |

---

## Divergence log

### 2026-08-24 — trading decisions move into the product

**Why.** A short entry borrowed nothing and sold a concurrent long's coin,
because the engine handed the venue a bare side and quantity and relied on
`MARGIN_BUY` auto-borrow — which covers only the *shortfall*, spending free
balance first. The book and the wallet then disagreed by that quantity on both
sides at once, a downstream checker false-halted a sound account, and the leg
could not be closed because a short close sizes itself from debt and there was
none. The owner had to open a margin position by hand to repair it.

**Owner's ruling**, five points, all addressed below:

1. Trading decisions — including how to deal with the venue netting everything
   into one balance — are made in the trading components of the product.
2. Make the right trade in the first place. No repair tooling for messes a
   correct decision would not create.
3. No dependencies on non-Classifier / non-UTS code bases.
4. Dust and other real-world factors belong in the part that decides trades and
   borrowing.
5. The trading platform API is plainly exposed, so execution can run anywhere.

**Files added**

| file | what |
|---|---|
| `lib/live/tradeplan.js` | the trading brain: netting-, dust- and borrow-aware. Turns a wanted leg + real wallet state into an explicit ordered list of venue primitives. Pure, no I/O. |
| `lib/live/venue.js` | the trading API contract, declared as enumerable data (`CAPABILITIES`), with `describe()`/`registerVenue()`/`inventory()`. Ships no live-money adapter. |
| `executor/mx_executor.py` | the execution component, moved INTO the product. Was `vps-access` only. |
| `executor/test_mx_executor.py` | its tests, moved with it. |
| `executor/EXECUTOR-SHA256` | hash of the authoritative executor, so the deployment mirror can be proven identical. |
| `executor/README.md` | ownership rule: this copy is source of truth, `vps-access` is a carrier. |
| `tests/test-tradeplan.js` | 10 checks, each watched failing against its own injected fault. |
| `tests/test-selfcontained.js` | 3 checks that the product keeps its own executor and that the fix cannot silently regress. |

**Files changed**

| file | change |
|---|---|
| `tests/run.js` | registered `test-tradeplan.js` and `test-selfcontained.js`. |
| `lib/live/routes.js` | added `const venue = require('./venue');` at module scope and a read-only `GET /api/live/venue` returning `venue.inventory()`. |

**Nothing else changed.** No UI, no other existing lib module, no data. The new
`GET /api/live/venue` is read-only and returns capability names and
documentation only — never credentials. `planEntry`/`planExit` are not yet wired
into the live decision path, and no live-money venue adapter is registered:
both are separate changes needing their own authorisation.

---

## THE PROMPT TO FEED INTO UTS

Paste everything between the lines into a UTS session.

---

> Apply the 2026-08-24 "trading decisions belong in the product" change from the
> General Classifier so this tree stays byte-identical to it.
>
> Context you need: a short entry used to be placed by handing the venue a side
> and a quantity with `sideEffectType=MARGIN_BUY` (auto-borrow). Binance's
> auto-borrow covers only the SHORTFALL — it spends free balance first. So when a
> concurrent long's inventory sat in the same isolated wallet, the "short"
> borrowed nothing and sold the long's coin. The net position was still correct,
> but free base fell below the journal's longs and debt sat below the journal's
> shorts — the same quantity missing from both sides at once. A reconciler that
> checks those two identities separately then halted a sound account, and the
> leg could never be closed because a short close sizes itself from outstanding
> debt and there was none. On the live LTC book this was 0.192 LTC and the owner
> had to borrow it by hand on the exchange to repair it.
>
> The owner's five requirements, which this change implements:
> 1. Trading decisions — including how to deal with the venue netting everything
>    into one balance per asset — are made in the trading components of the
>    product, not in a downstream checker and not in a script on another branch.
> 2. Make the right trade in the first place. Do NOT build tooling to repair a
>    drifted book; that is a bandage over a wrong decision.
> 3. No dependencies on code bases outside this product. Anything critical to
>    trading ships inside the product.
> 4. Dust, minimum notional, step rounding and borrowing belong in the part that
>    decides trades — not as tolerances fudged into a checker that runs later.
> 5. The trading platform API is plainly exposed and enumerable, so compute,
>    decision-making and execution can each be chosen independently.
>
> Do exactly this, adjusting only the folder name (`general-classifier/` here is
> `ultimate-trading-system/` in this tree — no other path differs):
>
> 1. Copy `lib/live/tradeplan.js` verbatim. It exports `BINANCE_ISOLATED`,
>    `planEntry`, `planExit`, `isDust`, `reconcileExpectation`, `netDrift`,
>    `floorStep`, `ceilStep`. Rules it encodes: a SHORT entry emits an explicit
>    `borrow` of the FULL quantity followed by a `sell` with `NO_SIDE_EFFECT`; a
>    LONG entry buys with `NO_SIDE_EFFECT` so it never repays a concurrent
>    short's loan; a LONG exit is capped by base that actually exists so it never
>    sells into the debt; a SHORT exit is sized from LIVE DEBT (not the nominal,
>    because interest makes debt larger) and clears the whole pool only when it
>    is the last short in the wallet; a short with no debt behind it returns
>    `ok:false, unbacked:true` with a reason instead of buying (buying with
>    nothing to repay opens a naked long); dust returns `ok:false, dust:true` as
>    a named normal outcome. `netDrift()` compares the NET, because a wallet
>    carrying both directions cannot satisfy two one-sided identities at once.
> 2. Copy `lib/live/venue.js` verbatim. The trading surface is declared as DATA
>    in `CAPABILITIES` (name, rules, price, balances, placeOrder, borrow, repay),
>    so a screen or endpoint can list it. `describe()` reports missing
>    capabilities honestly, `registerVenue()` refuses an incomplete adapter, and
>    the registry ships with NO live-money adapter — wiring one is a separate
>    change needing its own authorisation.
> 3. Copy `tests/test-tradeplan.js` and `tests/test-selfcontained.js` verbatim
>    and register both in `tests/run.js`. (There is a meta-check,
>    `everyTestFileIsRegisteredWithTheRunner` in `test-forwardbook.js`, that
>    fails if a test file exists but is not registered — so both must go in.)
> 3b. In `lib/live/routes.js`, add `const venue = require('./venue');` to the
>    module-scope requires at the TOP of the file (not inside
>    `installLiveRoutes`), and add a read-only endpoint
>    `GET /api/live/venue` that returns `venue.inventory()` wrapped in the same
>    try/catch + `errStatus(e)` pattern the neighbouring routes use. This is what
>    makes requirement 5 real: the trading surface can be READ, not taken on
>    trust. It returns capability names and docs only — never credentials.
> 4. Bring the execution component into this product: `executor/mx_executor.py`,
>    `executor/test_mx_executor.py`, `executor/EXECUTOR-SHA256` and
>    `executor/README.md`. The authoritative executor content is the one whose
>    SHA-256 is recorded in `EXECUTOR-SHA256`; take it from the General
>    Classifier tree, not from `vps-access`. The rule is that this copy is the
>    source of truth and any `vps-access` copy is a deployment mirror that must
>    be byte-identical.
> 5. Verify before reporting done: `node tests/run.js` passes the new checks, and
>    each new check has been WATCHED FAILING by reintroducing its specific fault
>    (that is this project's house rule — a check nobody has seen fail is not a
>    check). `python3 -m py_compile executor/mx_executor.py` succeeds, and the
>    recorded SHA-256 matches the file.
> 6. Do NOT wire `tradeplan.js` or `venue.js` into the live path, do NOT add a
>    live-money venue adapter, do NOT change any existing module, route, screen
>    or data file, and do NOT deploy anything. Report what you did and stop.
>
> Then append an entry to `UTS-PARITY.md` in this tree recording that this change
> landed, so the two trees' logs match.

---

### 2026-08-25 — today's call is visible before it acts

**Why.** On the live `daily-4d` geometry the feature window closes at 00:00 UTC
and the entry acts at 01:00 UTC, so the committee's call is known a full hour
before anything happens. `live-produce.js` had been writing that call to
`data/live/previews/<id>.json` every tick all along — and nothing ever read it
back. The owner looked at the decision history at 00:58, saw yesterday as the
newest row, and asked where today's vote was. It was on disk.

The "Current status — what happens next" panel had the matching hole: it
computed the next entry moment and never listed it, so it announced the next
*evaluation* a day out while an already-decided entry was two minutes away. It
also emitted rows in the order the code built them, so a 23-hour item sat above
a 17-hour one under a heading that promises what happens **next**.

**Files changed**

| file | change |
|---|---|
| `lib/live/view.js` | added `previewsDir()` + `loadPreview()`, both exported; `setupStatus()` attaches `out.preview`; `nextActivity()` emits a row for an already-decided entry and sorts all rows chronologically, undated last. |
| `public/trading.html` | new "Today's call — decided, not yet acting" panel above the decision history. |
| `tests/test-preview.js` | 9 checks, each watched failing against its own fault. |
| `tests/run.js` | registered `test-preview.js`. |

**The staleness trap.** A preview file stays on disk after its entry acts.
Rendering a leftover call as "today's" is worse than an empty panel — that is
how the retired `data/pilot/preview.json` sat six days stale. `loadPreview()`
surfaces a call **only while its own `entry_utc` is still in the future**; past
that it returns `{available:false, spent:true}` with a reason.

---

> **PROMPT FOR UTS — today's call is visible before it acts**
>
> Apply the 2026-08-25 change from the General Classifier so this tree stays
> byte-identical. Only the folder name differs (`general-classifier/` there is
> `ultimate-trading-system/` here).
>
> The problem: `live-produce.js` computes a decision PREVIEW every tick (via
> `signal.computePreview`) and writes it to `data/live/previews/<setup-id>.json`,
> but nothing reads it back — so a call known an hour before it acts cannot be
> displayed until it becomes a recorded history row. On `daily-4d` the feature
> window closes at 00:00 UTC and the entry acts at 01:00 UTC.
>
> 1. In `lib/live/view.js`: add `previewsDir()` (honouring `GC_LIVE_PREVIEWS`,
>    defaulting to `data/live/previews`) and `loadPreview(setupId, now)`; export
>    both. `loadPreview` must: return `null` when the file is absent or
>    unparseable; pass a producer `{available:false, note}` straight through so
>    the reason is shown rather than silence; **return
>    `{available:false, spent:true, ...}` when `entry_utc` is already past**, so a
>    spent call can never render as the current one; otherwise return
>    `{available:true, side, votes, quorum, chunkStart, entryUtc, computedUtc,
>    writtenUtc, configVersion}`.
> 2. In `setupStatus()`, set `out.preview = loadPreview(setup.id)` AFTER the
>    `...book` spread so it cannot be clobbered.
> 3. In `nextActivity()`: when `st.preview` is available and its `entryUtc` is
>    still ahead, push a row for it — `Open a <SIDE> position ($<clip> clip)`, or
>    `Stand down — the call is FLAT, nothing opens` for FLAT. When the entry is
>    near but no call is readable, push a row saying so. Then **sort every row by
>    `whenUtc` ascending, undated rows last** — the panel is titled "what happens
>    next" and must be in time order.
> 4. In `public/trading.html`, add a "Today's call — decided, not yet acting"
>    panel immediately above the "Daily decision history" panel: the call, the
>    member votes (UP/DOWN/no call, same colours as the history), the quorum, the
>    acting time, a `data-when` countdown, and the window/computed stamps. Handle
>    all three states — available, not-yet-available (show the note), no file.
> 5. Copy `tests/test-preview.js` verbatim and register it in `tests/run.js`.
>    Watch each check fail by reintroducing its own fault — house rule. One check
>    exists specifically because the others call `loadPreview()` and
>    `nextActivity()` directly and would all still pass if `setupStatus()` stopped
>    attaching the preview; do not drop it.
> 6. Change nothing else, and do not deploy. Report and stop.
>
> Then append the matching entry to `UTS-PARITY.md` here.

---

### 2026-08-25 (second pass) — the blind window, and the re-shipped intents

**Why.** The first pass expired a call the instant its entry hour arrived —
which is when it matters most and is least visible: not filled, no decision row
yet, owner watching. And `live-produce.js` was *erasing* the saved call every
tick past the entry hour, because `computePreview` reports "nothing to preview"
outside its window. So the call was readable 00:00–01:00 and then destroyed.

Separately, the owner's Incidents panel showed `INTENT_STALE` ×2 and
`INTENT_DUPLICATE` ×2: `actionableChunk` keeps a chunk actionable for its whole
137h hold, so every hourly tick re-offered a period already dealt with. The box
dedupes, so nothing was double-traded — but on 2026-08-24 it was halted and
fifteen hours of re-offers surfaced as a burst of stale intents when the halt
lifted.

**A correction worth recording:** a FLAT intent is **not** a defect and must not
be suppressed. The executor accepts `FLAT`, places no order, and journals
`INTENT_SEEN` — which is the event the decision history renders. Filtering FLAT
would silently delete every declined day from the record. A test now guards
against exactly that wrong fix.

**Files changed**

| file | change |
|---|---|
| `lib/live/view.js` | `loadPreview` marks a past-entry call `acting` instead of dropping it, abandoning only after 24h; `setupStatus` retires it by SUPERSESSION (a recorded decision for the same window) rather than by clock. |
| `live-produce.js` | an available saved call is no longer clobbered by an unavailable one; an intent is not re-shipped for a period already `INTENT_SEEN` on the box. |
| `public/trading.html` | the panel reads "acting now — awaiting the fill" past the entry hour. |
| `tests/test-preview.js` | 14 checks, each watched failing. |

---

> **PROMPT FOR UTS — the blind window and the re-shipped intents**
>
> Apply the 2026-08-25 second-pass change so this tree stays byte-identical.
> Folder name is the only difference.
>
> 1. `lib/live/view.js` — `loadPreview(setupId, now)` must NOT expire a call when
>    its entry hour passes. Return it with `acting: true` instead. Only abandon it
>    when `now - entry_utc > 24h`, returning `{available:false, abandoned:true, note}`.
>    Rationale: expiring at the entry hour blanks the screen in the window
>    between the entry and the fill, which is the hole the panel exists to close.
> 2. `setupStatus()` — after attaching `out.preview`, set it to `null` if any
>    entry in `out.decisions` has the same `chunk_start`. Supersession, not a
>    clock: once the call is a history row, showing it twice makes one decision
>    appear in two places disagreeing about whether it happened.
> 3. `live-produce.js` — when `computePreview` returns unavailable, do NOT
>    overwrite an existing saved preview whose `available` is true (read the file
>    first; keep it). Only write when there is nothing worth keeping.
> 4. `live-produce.js` — before writing an intent, read the synced journal
>    (`lib/live/view`'s `readJournal`/`journalFile`) and skip the write if an
>    `INTENT_SEEN` event exists with the same `setup_id` and `chunk_start`. This
>    mirrors the box's own dedupe rule; if the journal is unreadable, ship and let
>    the box dedupe. **Do NOT filter FLAT** — a FLAT intent places no order and is
>    how a stand-down becomes an `INTENT_SEEN` row in the history.
> 5. `public/trading.html` — when `pv.acting`, label the time "acted at (UTC)" and
>    show `status: acting now — awaiting the fill` instead of a countdown.
> 6. Copy `tests/test-preview.js` verbatim (14 checks) and keep it registered.
>    Watch each fail against its own fault. Two of them are source assertions over
>    `live-produce.js` because it is a script, not a module — that is stated in the
>    test. Note one regex is deliberately tight (`out\.actionable && out\.intent &&
>    !alreadySeen\)`) because a looser `/!alreadySeen/` also matches inside
>    `!!alreadySeen` and passed with the guard torn out.
> 7. Change nothing else, do not deploy. Report and stop.

---

## Deploying this change to the running system

### Why it cannot disturb open positions

The classifier is a web service on the VPS (`127.0.0.1:8093`). Open positions
are managed by `mx_executor.py` on the **Mexico box**, fired by
`pilot-exec.timer` there. The two machines are independent: restarting the web
service cannot touch a position, cancel an order, or stop a scheduled exit.

`deploy/install.sh` rsyncs with `--delete` but **excludes `data/`**, so the
journal, the decision records and all live state survive untouched. It then runs
`npm ci --omit=dev` and restarts the systemd unit — roughly a one-to-two second
gap in the web service.

This change adds **no new npm dependency**: `tradeplan.js` and `venue.js` import
nothing at all, and `routes.js` only requires a sibling file.

### The one thing worth timing around

Four timers on the VPS talk to this service:

| timer | schedule | if it misses a run |
|---|---|---|
| `pilot-sync` | every 5 min | harmless — it is an idempotent carry, retries next run |
| `pilot-alert` | :00 :15 :30 :45 | one alert cycle skipped |
| `live-alert` | :07 :22 :37 :52 | one alert cycle skipped |
| **`live-tick`** | **hourly at :08** | **produces decisions and pushes intents — do not overlap this** |

**Deploy window: :40–:55 past the hour.** That is clear of `live-tick` by a wide
margin and lands between the alert timers. A `pilot-sync` overlap is unavoidable
at any time and does not matter.

Also check before deploying: if the box is `armed: true, halted: false` it is
live and will take entries, so confirm no entry decision is due within the hour
(`classifier-live-diag.sh`, read-only).

### Steps

1. Read-only pre-flight: `classifier-live-diag.sh` — note armed/halted, open
   legs, and the next `live-tick`.
2. Boot the service locally and confirm `/api/healthz`, the new
   `/api/live/venue`, and an existing route such as `/api/live/setups` all
   answer. (Done for this change: all three good, no stderr.)
3. Run the deploy: `{"action":"run-script","script":"deploy-general-classifier.sh"}`.
   It syncs a dedicated checkout to `origin/general-classifier` and runs
   `deploy/install.sh`.
4. Verify: `curl -s http://127.0.0.1:8093/api/healthz` and
   `curl -s http://127.0.0.1:8093/api/live/venue`.
5. Re-run `classifier-live-diag.sh` and confirm open legs and
   `journalSyncedUtc` are unchanged/advancing.

### Rollback

`git revert <commit>` on `general-classifier`, push, re-run the deploy. The
deploy is idempotent and driven entirely by `origin/general-classifier`, so
reverting the branch and redeploying restores the previous service exactly. Do
not force-push the branch backwards — a revert keeps the history honest.

### For UTS

UTS is not deployed by `deploy-general-classifier.sh`; it has its own install
path under `/opt/ultimate-trading-system`. The same three rules carry over:
exclude `data/` from the sync, add no new dependency, and deploy outside that
tree's decision-producing tick. Confirm the equivalent timers on that side
before choosing a window — do not assume they are the same minutes.

## How an entry gets added

Any change to either tree gets logged here in the same commit, with a prompt
precise enough to reproduce it exactly in the other. If a change cannot be
described that way, it is too vague to have been made.
