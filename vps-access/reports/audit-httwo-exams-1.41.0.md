# Post-run audit — HT v2 entrance exams (engine 1.41.0)

Runs: httwo-20260805-005210-ht2-exam-a-late (PLANTEDLATEUSDT) and
httwo-20260805-010230-ht2-exam-b-flat (PLANTEDUSDT). Both 20 paired folds,
135-day windows, 12mo half-life vs reference, frozen exam cell (3-of-6,
direction gate, market entry, 17h), 0 failures, 0 dropped folds.

## 1. What were these runs supposed to answer?
DESIGN-HT2.md R4, stamped before the build: the instrument touches no real
pair until it (A) PASSES on the late-rule pair (rule lives only in the final
third — age-weighting has a KNOWN advantage) and (B) does NOT pass on the
stationary pair (uniform rule — a KNOWN non-advantage).

## 2. Did they answer THAT question?
Yes, both ways round:
- Exam A: paired sum +$262.74, 13/20 folds positive, sign-flip p = 0.0212,
  concentration 23% (no one-fold carry) -> PASS. The instrument SEES a real
  late-only signal.
- Exam B: paired sum -$48.00, 9/20 folds positive, p = 0.8243 -> NO EFFECT
  SHOWN. The instrument does NOT see ghosts in a stationary world.
Gate: ready=true on engine 1.41.0. Any engine change resets it (R4 is
version-scoped, like the planted check).

## 3-7. Instrument-hunting notes
- The verdict computed its own audit obligations (QC 78 pattern): fold
  counts, silent folds (0), concentration — nothing left for the reader to
  skip. The sign-flip null fired on BOTH runs including the failure, so the
  no-effect verdict carries its own noise scale (p 0.82, not silence).
- Exam A's p of 0.0212 on a KNOWN-real effect is worth remembering as the
  instrument's sensitivity at this fold count: a genuine advantage of this
  size clears 0.05 but not by orders of magnitude. Real-world effects
  smaller than the planted one may need more folds. Recorded, not fixed —
  a resolution statement, not a defect.
- One asymmetry accepted by design: the exams run the fixed exam cell on
  daily-1d; real candidates run their own frozen cells on their own
  geometry. The exams validate the MACHINERY (training, weighting, purges,
  pairing, verdict arithmetic), not every geometry's corner cases.

## 8. Assumed and not verified
- ASSUMED the exam cell (3-of-6, market, 17h) is a fair vehicle for the
  planted rule because the planted gate's own board wins with that shape.
  VERIFIED indirectly by exam A passing.

## 9. Next step
The instrument is open for real candidates. If the owner wants the
contaminated-origin hypothesis tested (36mo on LTC daily-4d from the v1
design read), it fires through the UI with its origin printed on the label.
Nothing fires without his word — candidate choice is his.

## QC register
Nothing new: R4's version-scoped gate and QC 78's endpoint-computed
obligations are the register items working as built.
