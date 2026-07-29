# Post-run audit — job bracketlab-20260729-1328-l10-walkforward-2025-06 (cycle 10)

Written 2026-07-29 under research-loop step 7.

**VERDICT: THE RUN IS VOID. Its "real" arm was a scramble.**

---

## 1. What was this run supposed to answer?

Does the money edge survive in a different stretch of history? Data ended
2025-06 so the held-back slice fell on a period not overlapping cycle 9's.
Declared rule: real beats all 19 scrambles -> not period-specific; weaker ->
cycle 9 was period-specific.

## 2. Does the output answer THAT question, or a neighbouring easier one?

**Neither. It answers nothing.** The comparison was a scramble against 19
scrambles.

What it printed, which looked like a clean decisive failure:

    net $        real -4,703.23   best null   -806.96   beats  1/19
    $ / trade    real   -0.1592   best null   -0.0237   beats  2/19
    vs hold $    real -6,062.45   best null -2,154.27   beats  0/19

I nearly reported that as "the edge is period-specific and does not
generalise". It would have been a completely wrong conclusion, and a
comfortable one, because it matched the caution I had already expressed.

## 3. What does the metric COUNT that it should not?

The real arm counted a rotated outcome series as if it were the market.

## 4. What does the metric OMIT that it should include?

An unrotated arm. There was none in the run.

## 5. Are the two compared arms the same population?

They were the SAME ARM. The r=0 "real" slice and the r=10 scramble produced
net P&L of -4703.229706986151 and -4703.2297069861515 — identical to floating
point across 170 setups and ~30,000 trades. That cannot happen by chance and
is what exposed the bug.

## 6. Is any part of the reported number achievable with NO skill?

All of it. Every arm was noise.

## 7. Would this number look the same on pure noise?

It WAS pure noise. 19/19 scrambles lost money and so did the twentieth,
because the twentieth was also a scramble.

## 8. What did I assume and not verify?

**The bug, and it is mine, introduced this morning.** `unitTask` resolved the
per-unit shift as:

    labelShiftFrac != null ? labelShiftFrac : p.labelShiftFrac

The r=0 real arm passes `null` to mean "do not rotate me". Null is not `!=
null`, so it fell through to the run-wide `labelShiftFrac: 0.5` and was
rotated. I added the r=0 arm to make a missing real arm structurally
impossible (QC 34) and in doing so made a FAKE real arm structurally
inevitable — with no error, no warning, and 3400 units of plausible output.

Assumptions this breaks, all mine:
- *A fix for one fault does not introduce another.* It did, in the same file,
  the same day.
- *Passing null to mean "none" is unambiguous.* It is not, against a
  value-based fallback. Presence of the key must decide, never its value.
- *A run with 3400 units and zero failures has run correctly.* Failure count
  measures crashes, not correctness. This is the fifth time that distinction
  has mattered here.

Also verified while checking: the r=0 arm did reach the census (170 rows,
tagged distinctly), so the plumbing added this morning works. Only the
rotation decision inside it was wrong.

## 9. Is the previously planned next step STILL correct?

The QUESTION is still correct and completely unanswered. The RUN must be
redone.

Fixed first: resolution is now by key presence, so an explicit null or 0 means
no rotation and cannot be overridden. Test asserts the code shape, asserts
resolution across four cases, and fails when the old expression returns —
watched failing before being trusted.

Cycle 11 re-runs the identical walk-forward on the fixed build. Same declared
rule, unchanged, because the question never got asked.

**Nothing about cycle 9 changes.** Cycle 9's real arm came from a separate job
with no run-wide rotation set, so it was never exposed to this path — and its
directional accuracy reproduced -2211 exactly, which is independent evidence
it was genuinely unrotated. The money result stands; the walk-forward is
simply still unknown.

## 10. New QC-REGISTER entries

- **38** — assuming null unambiguously means "none". Against a value-based
  fallback it means "inherit the default". Resolve optional per-item overrides
  by KEY PRESENCE.
- **39** — assuming a run with zero failures ran correctly. Failure count
  counts crashes. Cycle 10: 3400 units, 0 failures, void.
- **40** — assuming a fix cannot introduce a fault. The r=0 real arm was added
  to prevent a missing real arm and instead guaranteed a fake one. After any
  structural fix, verify the thing it produces is what it claims — cheapest
  check here is that no two arms are ever bit-identical.
