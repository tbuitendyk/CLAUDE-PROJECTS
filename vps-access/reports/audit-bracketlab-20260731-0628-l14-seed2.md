# Post-run audit — bracketlab-20260731-0628-l14-seed2 (seed check 1/2)

Written 2026-07-31 under research-loop step 7.

## 1. What was this run supposed to answer?
One arm of the declared seed check (launcher: classifier-l14-seed2.sh):
L14's interlaced layout rerun with block-placement seed 2, everything else
identical. Reads R1-R4 are declared in the launcher and are to be taken
over BOTH new seeds together.

## 2. Does the output answer THAT question, or a neighbouring easier one?
It ran cleanly for the purpose: 170/170 units, 0 failures, 11.1 min
(expectation was ~11). DELIBERATELY NOT READ YET: the declared design
reads both seeds at once, and reading seed 2 before seed 3 exists would
let one seed's numbers shape the other's reception. This note documents
completion, not results.

## 3. What does the metric COUNT that it should not?
Deferred to the combined seed-check read (same metrics as L14; caveats
QC 54/55 carry over).

## 4. What does the metric OMIT that it should include?
Deferred; nothing new versus L14's audit.

## 5. Are the two compared arms the same population?
This run has one arm. The comparison population question belongs to the
combined read (its comparators: L14's chronological arm, unchanged by the
seed, and the other interlaced seeds).

## 6. Is any part of the reported number achievable with NO skill?
Same exposure as L14 (q1/always cells ride the era's tide); the combined
read applies the same always-long controls.

## 7. Would this number look the same on pure noise?
Not tested in this run (0 scrambles, declared) — the seed check judges
placement sensitivity, not noise.

## 8. What did I assume and not verify?
That firing seed 3 before reading seed 2 is the right order — asserted by
the declared design, and the reason this note contains no numbers.

## 9. Is the previously planned next step STILL correct?
Yes: fire seed 3 (same launcher family), then the combined R1-R4 read,
then the L15 consult with everything on the table.

## 10. New QC-REGISTER entries
None from this run yet; anything the combined read catches will be
registered there.
