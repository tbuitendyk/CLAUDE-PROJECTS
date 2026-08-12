# Independent review — generalized live rail (schema-2), pre-deploy gate

Date: 2026-08-12. Reviewer: session-run independent agents (four fresh finders,
none carrying the author's reasoning), then a confirming pass over the fixes.
Scope: the R1–R18 generalized-rail work as it stood on origin, gating the
Phase-10.3 box deploy of `mx_executor.py`. Owner's arm bar: "ARM when a full
round comes back with ZERO new blockers (hardening nits are fine)."

## Why this review, and why independent

The 10.3 deploy was pre-authorized but GATED behind a clean adversarial review.
The earlier "review subagents are broken" diagnosis turned out to be specific to
the Workflow tool's array-typed structured-output path; plain Agent calls read
files and reason normally (verified). So a genuinely independent review WAS
runnable this session, and it earned its keep — it found two blockers the
author's own inline pass had missed.

## Round 1 — four independent finders

| Lens | Verdict | Findings |
|---|---|---|
| F1 byte-identity / rail isolation | **2 BLOCKERS** | shared-wallet coupling; blocked-loop corrupt-intent |
| Executor money-correctness | no blockers | N1 uncapped real schema-2 exposure; N2 cross-rail interest; N3–N5 pre-existing/documented |
| Classifier live-intent gating | no blockers | MODERATE: updateSetup bypasses live gates; nit: 500 vs 400 |
| Operational scripts / alerting | no blockers | fail-open allow_ok; live-alert ORDER_REJECT gap; mirror blind spot; batch String(id) |

Two independent reviewers converged on ONE mechanism — the shared LTCUSDT
isolated-margin wallet — which is strong signal, not one reviewer's hunch.

### BLOCKER 1 — a real schema-2 order would share F1's wallet (confirmed)

The box signs every order with F1's single `~/.executor-env` sub-account key
(open gap G8). Schema-2 intents are forced to the same symbol (LTCUSDT), so a
REAL schema-2 order lands on F1's OWN wallet + borrow pool. That re-couples the
rails the design keeps apart:
- **reconcile-halt** sums both rails' open legs and sets the BOX halt on any
  mismatch — a schema-2 discrepancy halts F1;
- **short-close sizing** (`is_last_short` counts across rails) — a live schema-2
  short changes the real buy-back quantity of F1's own short;
- **shared margin** — a live schema-2 setup can exhaust borrow and fail an F1 entry.

The classifier's transition gate refused live-without-keyRef, but the EXECUTOR
never checked — so a hand-edited allowlist `state:"live"` was one line from a
real order on F1's account. The whole rail-isolation held only by allowlist
discipline, which the owner's doctrine says must be enforced in code.

**Fix (QC 135):** `S2_LIVE_ROUTING = False` makes schema-2 paper-only on the F1
box — a would-be-real schema-2 intent is booked paper (still measures, places NO
order) and logs `S2_LIVE_UNSUPPORTED`. Applied at both the blocked-path
pre-check and the main `eff_paper`. This also removes uncapped real schema-2
exposure (N1) and cross-rail interest (N2) until G8 lands. F1 untouched.
Watched-failing: flip the flag True → a real order appears → test fails.

### BLOCKER 2 — blocked-rail intent loop touches a torn F1 intent (confirmed, narrow)

The corrupt/torn-intent `.bad` set-aside ran BEFORE the `real_blocked` gate, so a
torn F1 intent arriving during a disarm/halt window was consumed where the
pre-R8 early-return left it alone; and the unguarded `os.rename` could raise on a
vanished file and abort the whole run (F1 exits included). Mostly mitigated by
R14's atomic shipping, but a genuine un-`is2`-gated F1 behavior change.

**Fix (QC 136):** while blocked, a parse failure is left untouched (retried next
armed run) — byte-identical to the pre-R8 early-return; the set-aside rename is
guarded. Two watched-failing tests.

### Also fixed
- **MODERATE → QC 137:** `updateSetup` re-runs the live gate (shared
  `liveGateErrors`) so routing/keyRef can't be blanked past the door.
- **Fail-closed → QC 138:** `live-produce-and-push.sh` withholds intents when the
  local allowlist file is absent (was fail-open against a stale box list).

### Deferred (not blockers; schema-2 is paper-only until G8) — gap G9
live-alert ORDER_REJECT / absent-mirror paging asymmetries; sweep ACK reject-kill
dilution (N3, pre-existing); sweep client_id (N4); batch String(id); 500-vs-400.
To close when the generalized rail actually goes live (needs G8).

## Round 2 — confirming re-review of the fixes

<!-- FILL IN when the two confirming reviewers return -->

## Deploy-gate decision

<!-- FILL IN: gate met iff round-2 returns zero new blockers -->
