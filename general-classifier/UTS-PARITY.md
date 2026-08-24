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

## How an entry gets added

Any change to either tree gets logged here in the same commit, with a prompt
precise enough to reproduce it exactly in the other. If a change cannot be
described that way, it is too vague to have been made.
