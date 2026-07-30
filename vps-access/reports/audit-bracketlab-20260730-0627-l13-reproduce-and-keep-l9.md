# Post-run audit — bracketlab-20260730-0627-l13-reproduce-and-keep-l9 (L13)

Written 2026-07-30 under research-loop step 7.

## 1. What was this run supposed to answer?
Does the L12 build (model persistence, vote export, uncapped census, settable
grid, range-keyed cache) reproduce L9 exactly — and keep everything this time?
Rule declared in the launcher before firing: exact match = engine sound, L9
becomes a permanent dataset; any drift = full stop.

## 2. Does the output answer THAT question?
Yes, exactly. 36.09% (7,187/19,913), 98/170, net +$1,469.95, median $9.88,
win 55.9%, vs hold $1,385.92 — every declared figure identical to L9. Runtime
21.5 min vs L9's 21.8. Persistence verified: 170/170 files, 0 write failures,
real-arm file carries 12 models + 12 vote streams + 12 per-member scores.

## 3. What does the metric COUNT that it should not?
Nothing new — every metric is L9's, bit for bit, which was the declared
point. The standing caveats on those metrics (census total sums 170
overlapping setups, QC 36; accuracy counts stand-asides, QC 35) carry over
unchanged and are recorded against L9.

## 4. What does the metric OMIT that it should include?
Nothing beyond L9's recorded omissions (fee sensitivity, QC 37). This run
added the one thing the record DID omit — the fitted models, votes and
per-member scores now on disk — which was its purpose.

## 5. Are the two compared arms the same population?
Yes, trivially: the comparison is L13-vs-L9 on the identical configuration,
same data range, same split, same committee. Runtime differed (21.5 vs 21.8
min); every number matched exactly.

## 6. No-skill share
Unchanged from the L9 audit (noise pays ~34.2% of directional calls; the
skill component is ~1.6 points). This run adds no new evidence about the
market — it is evidence about the ENGINE.

## 7. Noise comparison
Not this run's job; L9's null (cycle 8's 19 scrambles) stands.

## 8. What did I assume and not verify?
- *EDGE-JOB pin state.* The first read silently returned L9 because the
  selector file was still pinned from a day-old investigation. Caught because
  the doc id is printed in the header — the id-in-output habit paid for
  itself. Re-pinned explicitly before reading.
- *Model files would carry models.* Verified on disk, not assumed.

## 9. Is the previously planned next step STILL correct?
It was not, and it changed (owner consult, 2026-07-30, after this note was
first written): the freeze consult moved to L15, and L14 became the rebuild
of THIS run's search on the corrected instrument — 6-member committees
(the 12-seat committees here were half echoes, QC 49) under both window
layouts (quota-first chronological + interlaced, phase 2). L13's board is
therefore CONTEXT for the L15 selection, not its source; the L14 board
supersedes it. L13's role — proving the engine reproduces L9 and keeping
L9's data permanently — is untouched by any of that.

## 10. New QC-REGISTER entries
- **48** — a selector file pinned for one investigation silently redirects the
  next. Every reader now prints the doc id it actually read (already true —
  which is what caught it); pins get reset as part of reading, not left for
  the next session to trip on.
- (Post-run, same day: the interlacing investigation and phase-2 code audit
  added 49-53. They belong to the platform work that followed this run, not
  to L13 itself, and are recorded in the register with their own tests.)
