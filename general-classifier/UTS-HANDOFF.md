# UTS HAND-OFF — every engine change pending from the general-classifier branch

Written 2026-08-25 at commit `3cda802` on `general-classifier`. This is the one
document a UTS session needs to bring those changes across, and the one
document the owner needs to drive and check that work.

**Why this document exists when `UTS-PARITY.md` already does:** the parity log
is a diary — five sequential prompt blocks, each written before the next
existed, so later passes silently modify what earlier prompts instruct, and two
line-level changes were never captured in any prompt at all (§6). Replaying the
prompts in order does NOT reproduce the classifier tree. This document is the
**end state**, verified against all three trees by direct read on 2026-08-25;
the parity log remains the rationale and audit trail behind it.

**The three commits everything below refers to** (a "commit" is one saved
snapshot of the whole repository, named by its hash):

| name | commit | what it is |
|---|---|---|
| FORK | `6f295b0` | the point where UTS split off, 2026-08-19 |
| GC | `3cda802` | the general-classifier tip — the code running the live LTCUSDT book right now |
| UTS | `4129b7f` | the `ultimate-trading-system` branch tip at the time of writing |

Key: *name* = the shorthand used throughout this document · *commit* = the git
hash to pass to `git show`/`git diff` · *what it is* = plain meaning.
(If UTS has moved past `4129b7f` by the time this is read, re-run the checks in
§3 — the copy/merge classification depends on UTS not having touched these
files since; §8 step 0 covers this.)

---

## 1. SAFEGUARDS — the UTS session reads this before anything else

1. **Work only under `ultimate-trading-system/`.** Never edit anything under
   `general-classifier/` — that folder is the branch running real money today.
2. **Do not deploy, restart, or run any script against any server.** Every
   change here lands as commits only. UTS deploys under
   `/opt/ultimate-trading-system` by its own install path;
   `deploy-general-classifier.sh` is the WRONG deployer for UTS, and the deploy
   timers on that side may not match the classifier's — none of that is this
   task. Deploying is the owner's separate decision.
3. **Never touch `data/`** (runtime state) and never commit anything from it.
   All directories the new code writes (`data/live/previews`, outbox,
   decisions) create themselves on demand — there is no provisioning step.
4. **Every new test check must be WATCHED FAILING** against its own named fault
   (§8 step 5) before it is trusted. A check nobody has seen fail is not a
   check.
5. **The full suite must be green before committing** — run it to completion
   and read the exit code directly, never through a pipe that can mask it.
6. **If a merge does not land the way §5 predicts** — a conflict where CLEAN
   was promised, an anchor string missing afterwards — **stop and report.** Do
   not improvise a resolution; the prediction being wrong means one of the
   trees moved, and that is for the owner to see first.
7. **Never run the adversarial suite's `--accept`** (it rewrites the findings
   baseline — a code change needing its own authorization). Run the suite,
   report what it says, stop (§8 step 6).
8. **Report and stop.** No follow-on fixes for things noticed along the way —
   they go in the report, and the owner decides.

---

## 2. State of play — the nine pending commits

TABLE: THE PENDING WORK. One row per classifier commit absent from UTS, oldest
first. Key: *commit* = its hash on `general-classifier` · *what it did* = plain
summary · *parity-log entry* = which section of `general-classifier/UTS-PARITY.md`
documents it (that file also rode across in `58ed33e`).

| commit | what it did | parity-log entry |
|---|---|---|
| `58ed33e` | Trading decisions moved into the product: `lib/live/tradeplan.js` (the trading brain — netting, dust, borrow/repay sizing, drift), `lib/live/venue.js` (the trading-platform contract as enumerable data), the executor source (`executor/`, 4 files) owned by the product, a read-only `GET /api/live/venue` route, 13 new tests | "THE PROMPT TO FEED INTO UTS" (2026-08-24) |
| `e60ff70` | The deploy runbook (documentation only) | "Deploying this change to the running system" |
| `8009299` | Today's call visible before it acts: previews are read back (`loadPreview`), attached to the status payload, rendered as a panel; "what happens next" gains the pending entry and is sorted by time | pass 1 (2026-08-25) |
| `bb92542` | The decided call must not vanish at its own entry hour: `acting` state + 24h abandonment replace clock-expiry; `keepSaved` guard in the producer | pass 2 |
| `b90336a` | Stop re-shipping periods the box has already seen (`INTENT_SEEN` dedupe mirror) — and keep FLAT shipping on its first pass | pass 2 |
| `ec1ac32` | A FLAT day must be recordable when decided: the price fetch runs for every side; intents ship only if the decision was actually recorded (`recordedOk`) | pass 3 |
| `8c806bc` | Tightened `notRecordingIsSaidOutLoud` to assert `recorded: !!recordedOk` (did-write, not could-write) | **NONE — this commit has no parity-log entry.** §6 carries it; this document is its record |
| `515a591` | A stand-down posts when decided, not when priced: the `priced`/`recordable` split, `&& priced` on the ship gate, the FLAT price exemption in `compareDecision` with `price_unrecorded` surfaced, six new checks | pass 4 |
| `3cda802` | One outcome, one word: both fate paths say `stand down`; three wording checks, two behavioural | pass 5 |

---

## 3. The method — copy, merge, or translate, decided per file by evidence

Two facts decide the method for each file. A **blob hash** is git's fingerprint
of a file's exact bytes — identical hash means identical file. Where UTS's blob
still equals FORK's, UTS never touched the file, so copying GC's version loses
nothing. Where **both** sides moved, a copy would DESTROY UTS's own post-fork
work — those files get a **three-way merge** (apply only the classifier's
changes onto UTS's copy, keeping UTS's own). Verified by `git rev-parse` on all
three refs, 2026-08-25:

TABLE: METHOD PER FILE. Key: *file* = path (same relative path under both
folder names) · *method* = COPY (byte-for-byte from GC), MERGE (three-way),
RESOLVE (known conflict, resolution given), or TRANSLATE (different target file
in UTS) · *evidence* = the blob facts that force the method.

| file | method | evidence |
|---|---|---|
| `lib/live/tradeplan.js` | COPY (new) | no UTS counterpart |
| `lib/live/venue.js` | COPY (new) | no UTS counterpart |
| `executor/mx_executor.py` | COPY (new) | no UTS counterpart; sha256 `bb14f6ec…` (§8) |
| `executor/test_mx_executor.py` | COPY (new) | no UTS counterpart |
| `executor/EXECUTOR-SHA256` | COPY (new) | no UTS counterpart |
| `executor/README.md` | COPY (new) | no UTS counterpart |
| `tests/test-tradeplan.js` | COPY (new) | no UTS counterpart |
| `tests/test-selfcontained.js` | COPY (new) | no UTS counterpart |
| `tests/test-preview.js` | COPY (new) | no UTS counterpart |
| `live-produce.js` | COPY (overwrite) | FORK blob = UTS blob (`6b993bdc…`) — UTS never touched it; GC end state (`1ecf6ce3…`) replaces it losing nothing |
| `tests/test-standdowns.js` | COPY (overwrite) | FORK blob = UTS blob (`79826e94…`); GC end state `b424e933…` |
| `lib/decisioncompare.js` | MERGE | both moved (FORK `9dceef32`, UTS `b2e005b3`, GC `654223ac`); UTS changed a header comment only — merge is trivial |
| `lib/live/routes.js` | MERGE | both moved (`a5cf2867`/`d6434f1f`/`2ffc2a20`); disjoint regions |
| `lib/live/signal.js` | MERGE | both moved (`46982645`/`521c354c`/`d2647096`); hunks 3 lines apart, no shared line |
| `lib/live/view.js` | MERGE | both moved (`ce749682`/`dc8cd286`/`fc8b6f1a`); no shared line |
| `tests/run.js` | RESOLVE | both rewrote the single `const files = […]` line — a real conflict; resolution in §5.5 |
| `public/trading.html` | TRANSLATE | **UTS has no `trading.html`.** Its trade screen is `public/trade.html`, a rewrite. The panel is inserted there (§7); nothing is copied wholesale |
| `UTS-PARITY.md` | DO NOT COPY | classifier-branch record. The UTS session CREATES its own `ultimate-trading-system/UTS-PARITY.md` recording this integration (§9) |

**Why the MERGE files must never be copied:** UTS's own post-fork work lives in
them and the system depends on it — `signal.js` threads the profile's real
trading fee into every training call (`, fee` — UTS's `lib/bracket.js` refuses
an undefined fee, so a copy would not just lose work, it would **break UTS**);
`view.js` carries UTS's torn-journal accounting (`dropped`, `unterminated`,
`unreadableFigures`) and fee fields; `routes.js` carries the fee fields,
`hasKeyRef` (presence-only), and the reproduce-check `mirror` in the status
payload. All of that must still be there afterwards — §8 step 2 checks it.

---

## 4. The byte-copies — commands

From the repo root, with both branches fetched
(`git fetch origin general-classifier ultimate-trading-system`):

```bash
GC=3cda802
mkdir -p ultimate-trading-system/executor
for f in lib/live/tradeplan.js lib/live/venue.js \
         executor/mx_executor.py executor/test_mx_executor.py \
         executor/EXECUTOR-SHA256 executor/README.md \
         tests/test-tradeplan.js tests/test-selfcontained.js tests/test-preview.js \
         live-produce.js tests/test-standdowns.js; do
  git show $GC:general-classifier/$f > ultimate-trading-system/$f
done
```

Verification is §8 step 1 (hash the results against GC's blobs).

---

## 5. The three-way merges — one file at a time

The mechanical recipe, per file (the patch carries the classifier's changes
only; `git apply -3` merges them against UTS's copy using the shared FORK
ancestor, whose objects are in this repository):

```bash
git diff 6f295b0 3cda802 -- general-classifier/<file> > /tmp/one.patch
sed -i 's|general-classifier/|ultimate-trading-system/|g' /tmp/one.patch
git apply -3 /tmp/one.patch     # then check the §8 anchors for this file
```

What each file's merge contains, what must survive, and what §8 checks:

### 5.1 `lib/decisioncompare.js` — expected CLEAN

- **Classifier changes:** inside `compareDecision`: the local
  `let priceUnrecorded = false;`, a new branch
  `} else if (rp == null && recorded.side === 'FLAT') {` (a stand-down recorded
  priceless makes no price claim — skipping ONLY the price check, narrowly, for
  FLAT alone), and `price_unrecorded: priceUnrecorded,` in the returned object.
- **UTS's own change that must survive:** a reworded header comment (line 8
  area). Nothing else.
- **Must remain untouched on both sides:** the
  `} else if ((rp == null) !== (cp == null)) {` branch — it is what still
  BREAKS a priceless LONG or SHORT, and the whole safety of the exemption is
  that it stays.

### 5.2 `lib/live/routes.js` — expected CLEAN

- **Classifier changes:** `const venue = require('./venue');` at the top, and
  the read-only route
  `app.get('/api/live/venue', …res.json(venue.inventory())…)` (the trading
  surface made visible — owner's point 5). Depends on `lib/live/venue.js`
  having been copied first (§4).
- **UTS's own work that must survive:** `feePerLeg`/`feeInherited` in
  `summarize`, `hasKeyRef` presence-only fields, the reproduce-check `mirror`
  read in the status route, `feePerLeg` in the shuttle options.

### 5.3 `lib/live/signal.js` — expected TOUCHING (adjacent, not conflicting)

- **Classifier change (one hunk):** the live entry-open fetch gate loses its
  `call !== 0 &&` term — at UTS line 186 today:
  `if (call !== 0 && entryOpen == null && typeof opts.liveOpenFetcher === 'function') {`
  becomes
  `if (entryOpen == null && typeof opts.liveOpenFetcher === 'function') {`
  with the explanatory comment block above it. A FLAT call fetches its price
  like any other, because the decision RECORD needs the price even though no
  order does. **The early return three lines below —
  `if (call !== 0 && entryOpen == null) {` — is left exactly as it is.**
- **UTS's own work that must survive, three lines above:** the
  `committeeCallFor(…, freeze.throughMs, fee);` call must keep its trailing
  `, fee` (UTS line 183). The two edits are close enough to share diff context —
  after merging, check BOTH by eye/grep.

### 5.4 `lib/live/view.js` — expected TOUCHING (five hunks, no shared line)

- **Classifier changes:** (a) the preview block near the top —
  `PREVIEW_ABANDONED_MS`, `previewsDir()` (honours the `GC_LIVE_PREVIEWS`
  test-only env override — the `GC_` prefix is UTS's retained convention too,
  do not rename), `loadPreview(setupId, now = Date.now())` with `acting` and
  the 24h `abandoned` state; (b) the `INTENT_SEEN` fate becomes
  `'stand down'` (UTS line 187 today reads `'flat — no trade'`; UTS's
  decision-log path at line 252 already reads `'stand down'` — after this, one
  word for one outcome); (c) `nextActivity` gains the pending-entry rows
  (`'Stand down — the call is FLAT, nothing opens'` /
  `` `Open a ${call} position ($${st.clipUsd} clip)` ``) and the chronological
  sort; (d) in `setupStatus`, after the `…book` spread:
  `out.preview = loadPreview(setup.id);` plus the supersession null-out (once a
  decision for the same window is on the record, the preview has become that
  row); (e) exports gain `loadPreview, previewsDir`.
- **UTS's own work that must survive:** `readJournal`'s `dropped`/
  `unterminated` counting, the qty/`entry_price` readability guards,
  `unreadableFigures`/`unreadableDetail`, `feePerLeg`/`feeInherited` and
  `journalDropped`/`journalUnterminated` in the status payload.

### 5.5 `tests/run.js` — KNOWN CONFLICT, resolution fixed here

Both sides rewrote the single `const files = […]` line. **Resolution: take
UTS's line unchanged and append exactly three entries before the closing
bracket**, so it ends:

```
…, 'test-servicecontrol.js', 'test-tradeplan.js', 'test-selfcontained.js', 'test-preview.js'];
```

Do **not** reintroduce the seven entries UTS removed (`test-consensus.js`,
`test-tracker.js`, `test-dogebook.js`, `test-books.js`, `test-metalens.js`,
`test-permscreen.js`, `test-wfcompare.js`) — those files do not exist in UTS
and the runner `require`s every entry, so any of them crashes the suite.
Registration is not optional either: UTS's meta-check
`everyTestFileIsRegisteredWithTheRunner` (in `tests/test-forwardbook.js`) scans
the disk and fails the moment a `test-*.js` file exists unregistered.

---

## 6. What the historical prompts get wrong — read before trusting any of them

The five "PROMPT FOR UTS" blocks in `UTS-PARITY.md` were written sequentially;
each was correct when written and three things make them collectively wrong as
instructions today:

1. **Later passes modify earlier ones.** The shipping gate alone evolved
   `!alreadySeen` → `recordedOk && !alreadySeen` (pass 3) →
   `recordedOk && priced && !alreadySeen` (pass 4, final). Pass 1's
   `spent:true` expiry was replaced by pass 2's `acting`/`abandoned` semantics
   — the word `spent` appears nowhere in the final code. The test-regex advice
   changed twice, ending at pass 4's rule: locate the gate by the statement it
   guards (`const stamp =`), never pin its literal text.
2. **Two line-level changes appear in no prompt at all:** the per-setup result
   reports `recorded: !!recordedOk` (did-write, not could-write; commit
   `ec1ac32`), and `aDeclinedDayIsRecordedNotDiscarded` asserts
   `/const recordable = priced/` (commit `515a591`). A session replaying
   prompts literally would end byte-divergent on both.
3. **Commit `8c806bc` has no parity-log entry** (the test tightening to
   `/recorded: !!recordedOk/`). This document is its record.

**Therefore: integrate from §4/§5 of THIS document.** The end-state files at GC
already contain every one of these deltas — the byte-copies carry them exactly,
and the merge patches carry them in the hunks. Use the parity-log passes as
rationale (each explains WHY its change exists), never as the instruction.
One more prompt error to ignore: every pass names `public/trading.html`, a file
UTS does not have — §7 is the translation.

---

## 7. The screen work — `public/trade.html`

UTS's trade screen is `public/trade.html` — a rewrite, not a copy, drawn by ONE
render path (`async function drawLive(){`, line 874 at UTS `4129b7f`) serving
both branches from `const BRANCHES=[['paper','Paper Books'],['real','Live Trading']];`
(line 423). One insertion therefore serves Paper Books and Live Trading alike —
the classifier's RULE TWO (the two must move together) is satisfied by
construction here.

**(a) The "Today's call" panel.** Copy the 21-line block from GC —
`general-classifier/public/trading.html` lines **789–809**, starting
`<div class="panel"><div class="k">Today's call <span …>— decided, not yet acting</span></div>`
and ending at that panel's closing `</div>` — and insert it between UTS
`trade.html` line 981 (`      </tbody></table></div>`, closing the
"Current status — what happens next" table whose empty row reads
`nothing scheduled`) and line 982 (the panel opening
`Daily decision history`). Those two neighbour lines exist verbatim in both
trees — that seam IS the location. Nothing else changes:

- the panel reads `st.preview`, which rides the existing per-setup status
  payload once §5.4's view.js merge lands — **no new endpoint, no new fetch**;
- every CSS class it uses (`.panel .k .lbl .row .pos .neg .muted .empty`) has
  exactly one definition in trade.html's stylesheet already, and the
  `data-when` countdown ticker it relies on exists at trade.html:1077 — zero
  new CSS, zero new JS (the classifier's RULE FOUR, alignment built-in, holds
  with no extra work);
- its empty states carry their own text (`no call computed yet — the producer
  has not written one for this profile` / `no call to show yet`).

The producer half already exists in UTS (`computePreview` in signal.js, written
to `data/live/previews/<id>.json` by live-produce.js) — it was write-only
there; this change is what finally reads it back.

**(b) The fate wording** rides the §5.4 merge (view.js line 187:
`'flat — no trade'` → `'stand down'`). No separate screen edit: the outcome
cell at trade.html:1002 renders `${esc(dec.fate||'')}` raw, so the corrected
word appears by itself.

**(c) `fateTxt()` — nothing to do.** GC's parity log flags an unused helper in
GC's `trading.html` that maps both wordings to a third. UTS never inherited it:
`git grep fateTxt` over the UTS tree returns zero hits. Do not create one.

**(d) Word lists.** UTS's closed word list (`SCREEN-WORDS.md`, `SERVED.json`,
`tests/sweep-words.js`) covers the **Construct page only** — `trade.html` has
no closed list, so nothing is regenerated for this change. What DOES apply is
UTS's own deploy-before-naming discipline: until the change is deployed on that
side, `stand down` and `Today's call` are words in the code, not names of
things on the owner's screen — reports must say so.

---

## 8. Verification — the gate before "done"

**This procedure has been rehearsed.** On 2026-08-25 the whole of §4–§7 was
performed in a throwaway worktree against UTS tip `4129b7f`, then deleted —
nothing was committed from it. Every prediction held: all 11 byte-copies
hash-matched GC; the four merges applied without conflict; `tests/run.js`
conflicted exactly as §5.5 predicts and its documented resolution took; every
step-2 anchor came back green in both directions; the panel block dropped into
the §7 seam with the neighbour lines exactly as quoted; the merged tree then
passed **UTS's full suite — 714 checks, 0 failures, exit 0** — plus the
executor's own `Ran 130 tests … OK` under python3; and one deliberate fault
(reverting the fate wording) turned `aStandDownIsCalledAStandDownByEveryPath`
red in that tree and green again on revert. So a clean run of the steps below
is the expected outcome, not a hope — any deviation means the ground moved
(step 0) and is a stop-and-report.

**Step 0 — the ground moved?** This document classified files against UTS tip
`4129b7f`. First check UTS's tip: if any §3 file changed after `4129b7f`,
STOP and report before integrating — the copy/merge table must be re-derived.

**Step 1 — byte-copies verify by hash.** For each §4 file:
`git hash-object ultimate-trading-system/<f>` must equal
`git rev-parse 3cda802:general-classifier/<f>`. Spot values:
`live-produce.js` → `1ecf6ce3874b92910d5c1745c55887b79a91ae47`,
`tests/test-standdowns.js` → `b424e9339aac89c97a630d6b8a7adc6769e5c585`.

**Step 2 — merged files verify by anchor.** Both lists, both directions:

*The classifier's changes are in* — grep each, exactly:
- signal.js: `if (entryOpen == null && typeof opts.liveOpenFetcher === 'function') {` present; `call !== 0 && entryOpen == null && typeof` ABSENT; `if (call !== 0 && entryOpen == null) {` still present once.
- decisioncompare.js: `} else if (rp == null && recorded.side === 'FLAT') {`; `price_unrecorded: priceUnrecorded,`; `(rp == null) !== (cp == null)` still present.
- view.js: `PREVIEW_ABANDONED_MS`; `GC_LIVE_PREVIEWS`; both fate lines read `'stand down'` and `'flat — no trade'` appears nowhere in live code; `out.preview = loadPreview(setup.id);`; exports end `loadPreview, previewsDir };`.
- routes.js: `const venue = require('./venue');`; `app.get('/api/live/venue'`.

*UTS's own work is still in* — grep each, exactly:
- signal.js: `freeze.throughMs, fee);` and `const { setupFee } = require('./setups');`
- view.js: `journalDropped:` and `unreadableFigures:`
- routes.js: `feeInherited:` and `hasKeyRef:`

**Step 3 — executor integrity.**
`git show 3cda802:general-classifier/executor/mx_executor.py | sha256sum` and the
copied file's sha256 must both read
`bb14f6ec5befdc05f6a3d98eea415bbd9ffde213a6469cba7f742ee10e4cf39b` — the value
inside `executor/EXECUTOR-SHA256`, and the value the deployed box copy was
verified against on 2026-08-24.

**Step 4 — the suite.** `node tests/run.js` (or `npm test`) from
`ultimate-trading-system/`, run to completion, exit code read directly. The
meta-check `everyTestFileIsRegisteredWithTheRunner` binds the three new files
(§5.5). Also run the executor's own tests once:
`python3 executor/test_mx_executor.py` (stdlib only, no network) — and do not
commit the `executor/__pycache__/` directory it leaves behind.

**Step 5 — watch the new checks fail.** For each row, introduce the fault in
the UTS copy, run the one check, see RED, revert, see GREEN. Do them one at a
time; never commit with a fault in place.

TABLE: FAULT INJECTIONS. Key: *check* = exported test function (file it lives
in) · *the fault that must turn it red* = the one deliberate reversion to make,
then undo.

| check | the fault that must turn it red |
|---|---|
| `aStandDownIsRecordedTheMomentItIsDecided` (test-standdowns) | remove the `out.intent.side === 'FLAT'` arm from `const recordable` in live-produce.js |
| `aPricelessIntentIsNeverShipped` (test-standdowns) | delete `priced` from the intent-write gate |
| `aPricelessStandDownIsNotADivergence` (test-standdowns) | delete the FLAT branch from decisioncompare.js |
| `aPricelessTradedRecordStillBreaks` (test-standdowns) | widen that branch to `rp == null` (drop the FLAT restriction) |
| `aStandDownStillHasItsVotesAndHashChecked` (test-standdowns) | make the FLAT branch return early, skipping votes/hash |
| `aTradedRecordIsNeverWrittenWithoutItsPrice` (test-standdowns) | delete the `const priced =` line |
| `aStandDownIsCalledAStandDownByEveryPath` (test-standdowns) | revert view.js's INTENT_SEEN fate to `'flat — no trade'` |
| `aTradedDayIsNotCalledAStandDown` (test-standdowns) | hardcode `fate: 'stand down'` for every side |
| `theRetiredFlatWordingIsGoneFromTheRenderedText` (test-standdowns) | reintroduce the literal `'flat — no trade'` in view.js live code |
| `notRecordingIsSaidOutLoud` (test-standdowns) | report `recorded: !!recordable` instead of `!!recordedOk` |
| `aFlatCallFetchesItsEntryPriceLikeAnyOther` (test-preview) | restore `call !== 0 &&` on the signal.js fetch gate |
| `noDecisionRecordMeansNoShippedIntent` (test-preview) | delete `recordedOk` from the ship gate |
| `theProducerDoesNotReshipAPeriodTheBoxHasSeen` (test-preview) | delete `!alreadySeen` from the ship gate |
| `aFlatIntentIsStillShippedOnItsFirstPass` (test-preview) | add a `side !== 'FLAT'` filter to shipping |
| `theProducerDoesNotEraseADecidedCall` (test-preview) | make the preview write unconditional (drop `keepSaved`) |
| `theStatusEndpointActuallyCarriesThePreview` (test-preview) | delete `out.preview = loadPreview(setup.id);` from setupStatus |

(The remaining test-preview checks — loadPreview's states, the time-ordering of
"what happens next" — are behavioural; the suite exercising them green after the
merge, plus any one of them red under a deliberate view.js mutilation of your
choosing, is sufficient.)

**Step 6 — the adversarial suite.** UTS carries
`npm run test:adversarial`, which discovers routes from `lib/live/routes.js` —
it WILL find the new `GET /api/live/venue` and attack it. A new finding fails
the suite by design. **Report any new finding verbatim; do not run `--accept`**
(that rewrites the findings baseline and is the owner's call under UTS's own
RULE ZERO).

**Step 7 — the report.** State: step 0 verdict; the hash table from step 1;
both anchor lists from step 2 with pass/fail each; the sha256; suite counts and
exit codes (node and python); the fault-injection table with red/green observed
per row; the adversarial verdict; any §1.6 stop that occurred. Then stop.

---

## 9. Expected permanent differences — what is NOT drift

These stay different between the trees on purpose; no future parity check
should flag them:

- the folder name (`general-classifier/` vs `ultimate-trading-system/`);
- UTS's `public/` set (5 rewritten files) vs the classifier's (8 legacy files) —
  including `fateTxt()` existing only on the classifier side;
- UTS's own post-fork engine work (fee threading, journal robustness,
  keyRef-presence fields, `mirror` in status, its Service/Sweep/word-list
  machinery, its `package.json` name/scripts incl. `test:adversarial`);
- the seven test files UTS deleted;
- `lib/live/exchange.js` (data-side venue adapter, both trees) vs
  `lib/live/venue.js` (order-side capability contract, arriving in this
  hand-off): same word, disjoint jobs — do not unify or rename them;
- `UTS-PARITY.md` and this file are general-classifier records. The UTS
  session's first commit of this integration CREATES
  `ultimate-trading-system/UTS-PARITY.md`, recording what landed, from where
  (GC `3cda802`), and this document as the instruction followed — so both trees
  carry their own log from then on.

**Off-repo facts, stated for the record:** the QC register entries backing
these changes (QC 182–185, plus 169/180/181 cited in the code) live in
`QC-REGISTER.md` on the `vps-access` branch — not reachable from either tree
here; nothing for the UTS session to do about them. The executor's deployment
mirror also lives on `vps-access`; byte-identity with it is provable only via
the sha256 in `executor/EXECUTOR-SHA256` (§8 step 3).

---

## 10. For the owner — how to run this hand-off

**The prompt to paste into the UTS session** (add your own start word to it as
you see fit — nothing here starts work by itself):

> Fetch the general-classifier branch and read
> `general-classifier/UTS-HANDOFF.md` from its tip
> (`git fetch origin general-classifier` then
> `git show origin/general-classifier:general-classifier/UTS-HANDOFF.md`) —
> the document post-dates the `3cda802` code snapshot it describes, so it is
> not IN that commit; the code refs inside it still all point at `3cda802`.
> Follow it exactly:
> its §1 safeguards, §4/§5 integration, §7 screen work, §8 verification. Its
> instructions supersede the prompt blocks inside `UTS-PARITY.md`. Commit on
> the UTS branch only. Do not deploy anything. Report per §8 step 7 and stop.

**What to demand in the report back** — refuse "done" without all seven:
1. step 0 verdict (did UTS move past `4129b7f`?);
2. the hash table (11 byte-copies matching GC);
3. the two anchor lists, every line pass/fail;
4. the executor sha256 (`bb14f6ec…`);
5. suite counts + exit codes, node and python;
6. the fault-injection table — each row's red-then-green observed, not claimed;
7. the adversarial suite verdict, with any new finding quoted and NOT accepted.

**Decisions that remain yours alone:** deploying UTS afterwards (separate act,
separate word — and on that side, only after its own served-fingerprint
discipline); accepting or rejecting any new adversarial finding; whether the
unused `fateTxt()` on the classifier side is deleted or wired (unchanged from
pass 5: reported, not touched).

**One caution when reading the report:** until UTS is deployed, `stand down`
and `Today's call` are words in its code, not names of anything on your screen.
The classifier side already shows them — live since the 2026-08-25 02:59 UTC
deploy.
