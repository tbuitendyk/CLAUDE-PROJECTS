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

## 3–5. Metric counts / omits / populations
No change to any metric this run — that was the point. One arm, reference
check. Nothing new found.

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

## 9. Is the planned next step still correct?
Yes: HARD STOP for the L14 consult (owner-ordered exception to the no-handoff
rule). The owner selects freeze candidates interactively; null-shift timing on
survivors is the standing agenda item. Nothing fires until that conversation.

## 10. New QC entries
- **48** — a selector file pinned for one investigation silently redirects the
  next. Every reader now prints the doc id it actually read (already true —
  which is what caught it); pins get reset as part of reading, not left for
  the next session to trip on.
