# Post-run audit — bracketlab-20260807-085851-triples-confirm-c-ltc-sharpen

Confirm run C: sole surviving candidate (LTC+XRP+BCH, LTC traded) sharpened
from 9 to 19 null draws on identical structure. 60 rows, 0 failures, 19.1 min.
Rule stamped before launch: real must beat ALL 19 draws (p-floor 0.05).

## 1. What the run reported
CANDIDATE (LTC traded): hold raw $13.03 (310t), alwaysLong -$657.82,
skill +$670.85. 19 nulls' skill $305.70..$586.95. Beat 19/19 -> PASS.
SIBLING (BCH traded): skill $936.98, nulls $1004.60..$1153.74 -> beat 0/19.
SIBLING (XRP traded): skill $1012.39, nulls $996.66..$1171.82 -> beat 3/19.

## 2. THE PASS IS WITHDRAWN — the instrument was defective (QC 80)
A 17-agent adversarial audit (6 hostile lenses, each surviving objection put
to an independent refuter) was run against the pass. 59 objections raised, 49
serious, and all but a handful were refuted. One survived and I confirmed it
in the source myself:

lib/bracketwork.js dealt each member's null votes across the CONCATENATED
test+hold span and sliced afterwards. So every null arm's hold window carried
the POOLED vote mix of both windows, while the real arm kept the hold window's
own mix. The hold window was strongly one-directional (alwaysLong -$657.82 vs
alwaysShort +$478.32), and in such a window the overall directional lean is
worth money by itself. The real arm was therefore credited for its lean, not
only for its timing — the thing the null exists to isolate. lib/walkforward.js
has always dealt per slice; only the board path was wrong.

Corroboration computed from this run's own data (classifier-nullspread-diag.sh):
  ordering            real$    nullMean   nullSd     z    beat
  LTC traded         670.85     413.93     77.94  +3.30   19/19
  BCH traded         936.98    1071.60     33.32  -4.04    0/19
  XRP traded        1012.39    1083.49     50.83  -1.40    3/19
An information-removal null should not be able to place sibling arms of the
SAME window and the SAME three coins at +3.30 and -4.04. One common factor
of about 2.02 applied to the null spread brings every arm inside |z|<2. That
factor is GUESSED, not derived — it is a symptom reading, not a correction to
apply. The correction is the code fix plus a re-measurement.

Fix: engine 1.42.0, per-slice deals, with tests/test-gatepipe.js
nullArmsAreDealtWithinTheirOwnSlice driving the real worker on the fabricated
pair. Watched failing with the fault reintroduced, then passing. 231/231 green.
Registered as QC 80.

CONSEQUENCE: every null-board number this project has produced — runs A, B, C
and the null census work before them — was measured against the old
construction. Run B's FAIL and run C's PASS are both withdrawn as evidence.
Nothing is retired and nothing is promoted on them (project rule).

## 3. Other findings from the audit worth keeping (not defects)
- Runs A and C are NOT two confirmations. nullRng keys on
  (unitKey|foldIdx|memberIdx|slice) with no job id and seeds run 1..reps, so
  A's 9 draws are a subset of C's 19. One hold window, 19 distinct draws.
  Recording this so a later reader cannot count two passes. Salting the key
  with a job id would be a REGRESSION (past runs' nulls become unverifiable).
- Money, independent of any null question: hold net $13.03 on 310 trades;
  fees paid $77.50 of $90.53 gross (85.6%); break-even fee $0.1460/leg against
  $0.125 charged, i.e. 16.8% of cost headroom; alwaysShort made $478.32 on the
  same window with no model at all. Even a clean pass would not have made this
  tradeable.
- Selection: the discovery board's PROMOTION used the search window
  (lib/batch.js promotionSet), and the reader lists I selected from sorted on
  test-window quantities. But leaderCmp DOES order promoted rows by held-back
  money for display. Not a leak into promotion; it is a leak into what a human
  eye sees first. Worth a future guard, not a QC entry yet.

## 4. Next step, declared before it runs
Re-run confirm C byte-for-byte on 1.42.0 (same universe, same declared cell,
same 19 seeds) as run D. Reading rule, stamped now: real must beat all 19
corrected draws (p-floor 0.05). Expectation stated in advance: the candidate
FAILS, because the fix removes the directional-lean credit that plausibly
produced the whole margin. If it fails, the lead is parked, not retired. If it
passes, the money objections above still block any promotion, and the next
question becomes a fresh period rather than a fresh null.
BLOCKED: 1.42.0 is committed and pushed to claude/general-classifier-7q9oxt
but the deploy script is hard-wired to the general-classifier branch, which I
am not permitted to push to without the owner's word. Asked.

## 5. Audit process defect (mine)
The workflow verified only the first 10 of 49 serious objections
(`serious.slice(0, 10)`), drawn in lens order, so lens coverage was skewed and
the decisive objection was never put to a refuter — it survived by not being
tested. I verified it by hand against the source instead. Any future audit
harness must either verify all serious objections or state the cap in its
output. Not a QC register item (it is my tooling, not the engine's), but it is
recorded here so the next audit does not inherit the blind spot.
