# Post-run audit — scoped adversarial re-review of the generalized live rail (2026-08-12)

Run: local adversarial-review workflow `wf_966cf11c-c9b`
("live-release-adversarial-review"), five finder lenses (money-math,
rails-independence, control-security, instrument-integrity,
liveness/failure-modes) over the generalized (schema-2) money path, each raised
finding independently refuted at the line-number level by a separate skeptic;
several reproduced end to end with the repo's own MockBinance harness.

Tally: 36 findings raised (heavy overlap across lenses), 15 taken to an
independent verify, **15 CONFIRMED, 0 refuted**. The run was stopped at
saturation (loop-until-dry was re-confirming the same rail-isolation cluster
from fresh lenses; the confirmed set had converged and further rounds were
returning no new distinct defect). This audit is required by research-loop
step 7d before the next job (the fixes + the 10.3 box deploy) may proceed.

---

## 1. What was this run supposed to answer?

Question, written before the run: *"Is the generalized (multi-setup) live rail
sound enough that a setup could be flipped to paper or live without harming the
running F1 pilot or trading incorrectly on its own terms?"* This is the owner's
own bar from the 2026-08-11 verified mail: "ARM when a full round comes back with
ZERO new blockers (hardening nits are fine)", scoped to the new generalized code.

## 2. Does the output answer THAT question, or a neighbouring easier one?

It answers that question. The run did NOT substitute the easier "do the
generalized unit tests pass?" (they do — that was the trap). Every confirmed
finding traces a concrete, reachable path from a supported release action
(mint a setup -> paper/live -> produce -> ship to the same box) to a wrong
outcome, with line numbers and, for the client-id and recovery-rider defects,
an end-to-end reproduction.

## 3. What does the metric COUNT that it should not?

The "green test suite" counted schema-1 (F1) coverage as if it covered schema-2:
recovery tests, cid tests, concurrency tests and kill tests are all schema-1
only, and the few schema-2 tests use short setup ids and single chunks that do
NOT exercise the truncation-collapse or cross-rail interaction. A green suite
was reading as "the generalized rail is safe" when it had never driven the
generalized rail's failure modes.

## 4. What does the metric OMIT that it should include?

Cross-rail interaction entirely. There was no test in which an F1 position and a
schema-2 position coexist on the box — which is precisely the state the whole
"keep both rails" cutover creates. Every "F1 untouched" claim was asserted, never
measured under coexistence.

## 5. Are the two compared arms the same population?

N/A for this review (no A/B metric). The relevant population error is in a
CONFIRMED finding, not the review: fidelity averages pool populations that are
not comparable — recovered fills inject a fabricated 0.0 deviation, and paper-era
tick deviations pool with real fill deviations (item R16).

## 6. Is any part of the reported "it's safe" achievable with no skill?

Yes, and that is the danger: with no schema-2 setup in paper/live today, the box
runs F1 alone and *looks* safe for free. "F1 is fine right now" is achievable
with zero correctness in the generalized code, because the generalized code is
inert. The gate is exactly to stop that false comfort from authorizing the flip.

## 7. Would this look the same on pure noise / on a broken rail?

Yes — see 6. A completely broken generalized rail produces the identical
present-day picture (F1 healthy, one open long) as a correct one, until the first
paper/live setup. That is why review, not "it's been running fine", is the test
here.

## 8. What did I assume and not verify? (now verified by this run)

- Assumed the generalized rail was resource-isolated from F1. FALSE — it shares
  F1's reject/loss/drift/exit kill switches, the 6-slot concurrency cap, the
  wallet/borrow pool, the client-order-id space, and the journal the F1 screen
  and F1 alerter read. (R1, R2, R3, R6, R7)
- Assumed crash recovery reconstructs a schema-2 position correctly. FALSE — the
  riders (hold/stop) are never journaled, so recovery inherits F1's 137h hold and
  runs stopless. (R4)
- Assumed the fail-closed allowlist pinned paper-vs-real. FALSE — the paper bit
  is trusted from the intent, and hold/stop are unbounded box-side. (R5)
- Assumed paper books always measure. FALSE — paper entries sit behind the
  arm/halt gate, so a disarmed/halted box silently stops measuring. (R8)
- Assumed per-setup alerting worked. FALSE — the alertable schema-2 incidents are
  journaled without setup_id, so live-alert drops them and pilot-alert
  misattributes them to F1. (R6/R12)

Every one of these is now a QC-REGISTER entry (section 10) and a fix task (R1-R18).

## 9. Is the previously planned next step STILL correct?

No — and this is the whole point of the gate. The planned next step was 10.3
(deploy the generalized executor to the box). That step is now PROVISIONAL and
does NOT proceed. Intervening steps inserted first: fix R1-R18, each with a
watched-failing test; re-run the suites green; run one more scoped adversarial
round over just the fixes; and only on a zero-blocker round does 10.3 proceed —
with F1 running untouched through it, exactly as agreed. There is no budget limit
on these intervening steps; a wrong instrument makes the deploy worthless.

Live-risk note: F1 and its open $10 LTC long are NOT endangered in the meantime.
Every confirmed defect requires a schema-2 setup in paper/live to bite; the only
registered setup (f1-pilot) is DRAFT, which produces no intents and never enters
the box allowlist. The generalized rail is inert today.

## 10. New QC-REGISTER entries

Confirmed defects, each becoming a permanent check with a watched-failing test as
it is fixed (R1-R18; QC entries 117+ appended as each fix lands):

- R1  rail-blind box kills (reject/loss/drift/exit halt) — a schema-2 fault halts F1.
- R2  shared 6-slot cap — one schema-2 real position drops an F1 model-called entry.
- R3  BLOCKER: 14-char client-id truncation collapses all schema-2 orders to one cid.
- R4  BLOCKER: recovery loses schema-2 hold/stop — recovered position rides stopless 137h.
- R5  BLOCKER: allowlist does not pin paper-vs-real; hold/stop unbounded box-side.
- R6  shared journal corrupts the F1 screen + F1 alerter (bare chunk_start keys).
- R7  pooled short interest misattributed to whichever rail closes last.
- R8  paper books stop measuring under disarm/halt.
- R9  setup view sums paper + real unrealized into one number.
- R10 non-LTC / unsupported-geometry setup runs silently wrong instead of a visible refusal.
- R11 unvalidated runId path-traversal in the greenlight endpoint.
- R12 generalized-rail health fail-open (mirror staleness reads fresh; incidents lack setup_id).
- R13 live-alert re-pages one historical incident hourly for ~26h.
- R14 producer ships intents even when the allowlist carry failed; non-atomic scp.
- R15 unbounded terminal-state file accumulation.
- R16 fidelity averages mix populations (fabricated 0.0 deviation; paper/real dev pooling).
- R17 mirror coverage gaps (stopped setups unchecked; only newest-10 recomputed).
- R18 intent consumed before price/concurrency checks — a transient skip forfeits the period.
