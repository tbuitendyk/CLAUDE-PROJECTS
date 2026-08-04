# Post-run audit — job bracketlab-20260804-0733-null9-census

Required by research-loop step 7 before any new job may be fired.

Run: 17 coins x 10 branches = 170 units, 9 dealt-vote null boards riding
inside the job, windowLayout reserve61, engine 1.38.0, elapsed 5,680s,
failures 0. Campaign: test1...solo asset broad sweep (owner-fired via the
copy-settings button from bracketlab-20260803-0611-null9-census).

---

## 1. What was this run supposed to answer?

Written before the run (agreed plan, 2026-08-04): History Tuning refused the
LTC candidate off the 0611 board because those census rows predate QC 73 and
carry no window stamps. This run's job was NOT to discover anything new — it
was to reproduce the 0611 census board on the current engine so every row
carries window stamps and the LTC row becomes selectable for History Tuning.
Secondary: the two null reads (Tool 1 per-setup, Tool 2 selection-aware) must
be re-verified on THIS board before HT, because a read from one board does
not transfer to another.

## 2. Does the output answer THAT question, or a neighbouring easier one?

That question. The board reproduced: the candidate family LTCUSDT daily-4d
argmax, q5-of-6, directional gate, no rails, 137h hold sits at position 29
of the top-50 real rows (it was 30 on the 0611 board) with +$43.94 test-window
money on 23/33 trades and +$96.63 against always-long. 170/170 units completed,
1,700 census rows written (each unit: 1 real + 9 dealt copies), zero failures.
The engine that ran it (1.38.0) writes window stamps on every census row and
census-backed selection passes them through (tests: test-censusselect.js) —
so the HT refusal reason is gone.

## 3. What does the metric COUNT that it should not?

The board ranking shown on screen is TEST-window money — the window each
row's settings were chosen on, flattering by construction. Nobody may read
position 29 (or the +$43.94) as evidence; it is a shopping-window echo. The
readable numbers are the held-back column and the two null reads.

## 4. What does the metric OMIT that it should include?

The board line omits the held-back result and both null verdicts — by design,
they live in the vs-nulls column and Tools 1/2. Note for the reads: 500 of
1,700 census units (29.4%) never traded in the holdout, so any pooled average
that includes silent units understates the traded population (the 1.39.0 menu
grid now discloses traded-only aggregates for exactly this reason).

## 5. Are the two compared arms the same population?

Yes by construction here: every null board ran the same 170 units through the
same promote stage with dealt votes (nullDealSeed 1..9 stamped; QC 71's test
holds the seed carriage). The census-diag aggregate mixes real and null rows
in its accuracy pools — a display quirk of the DIAG SCRIPT, not the record;
Tools 1/2 filter by the seed tag.

## 6. Is any part of the reported number achievable with NO skill?

The test-window board money largely is — that is what a shopped maximum
looks like, and it is why it carries no evidentiary weight. Directional
pooled hit rate is 35.8% across units; on a 3-class problem this must be
compared against the run's own dealt nulls, never against 50%.

## 7. Would this number look the same on pure noise?

To be answered by the owner's two reads on THIS board (Tool 1 per-setup:
does the LTC row beat its own 9 dealt copies on held-back money; Tool 2
selection-aware: does topping this board beat topping a noise board). The
0611 board's reads (Tool 1 0/200, Tool 2 9/9) do NOT transfer — different
board, different draws. Until re-read here: not known, by rule.

## 8. What did I assume and not verify?

- ASSUMED window stamps present on this run's census rows because the 1.38.0
  code path writes them and the passthrough is pinned by test. Not verified
  against the raw doc byte-for-byte. VERIFICATION: the HT launcher itself
  refuses stampless rows — pressing HT is the check, and a refusal would be
  a finding, not a loss.
- ASSUMED the run's settings byte-match 0611's except layout-era fields,
  because the copy-settings button filled the form. The comparison surface
  (engineVersion warning + settingsDiff) exists on the compare tab if any
  doubt arises. Not independently diffed here.
- VERIFIED: unit count (170), census count (1,700 = 170 x 10 boards),
  failures (0), layout (reserve61), null construction (dealt, seeds stamped).

## 9. Is the previously planned next step STILL correct?

Yes, with one inserted step that already existed as a rule: the engine moved
to 1.39.0 AFTER this run finished, so the planted check must be pressed again
(a PASS is scoped to the engine version that earned it) BEFORE any new
compute is trusted. Then, in order: Tool 1 and Tool 2 on the LTC row on THIS
board; if both pass, History Tuning on the selected row; the one-touch
reserve grade stays untouched until walked through together.

## Findings for the QC register

None new. QC 73/74 protections are what this run exists to exercise; the
stale classifier-smoke.sh script (still speaks retired 'holdout') is a
tooling cleanup, noted for the next vps-access pass, not a register item —
the engine refused it correctly, which is the register working.
