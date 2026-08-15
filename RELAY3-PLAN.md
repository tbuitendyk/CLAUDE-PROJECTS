# RELAY3 — pure self-chaining relay

The decisive test of the SPAWNTEST round-2 finding: shifts hand off to each
other with a **plain** spawn call and nothing else. No permissions passed down,
no bell rung, no owner session in the loop, **and no watchdog**. If a shift dies,
the chain stops dead — that is deliberate. A safety net would hide whether
self-chaining actually works.

**Branch:** `claude/sandbox-fd3rem`, mirrored to `sandbox`.
**Log:** `RELAY3-LOG.md` — every shift appends the prompt it received, its full
response, and the outcome of its handoff attempt.
**Shift prompt:** `RELAY3-SHIFT-PROMPT.txt` — each shift passes this file's
contents to its successor verbatim.

**Completion test:** no `- [ ]` lines remain below. That is the only test. Do NOT
grep the log for the completion marker — the log contains prompt text and would
false-positive, which is a bug that bit RELAY2.

**Completion marker:** the exact line is given in `RELAY3-MARKER.txt`. Step 6
copies that file's single line into the log. It is kept in a separate file so the
marker string never appears in any shift prompt.

## What is being measured

- Does a six-step chain complete with no human and no watchdog?
- Wall-clock per hop, and end to end. Target is ~65 s per hop from SPAWNTEST.
- How many spawn refusals occur across five handoffs, and whether retries clear
  them. Every refusal is recorded, including ones that were retried away.

## Steps

Each step depends on the previous one's published result, so a shift that cannot
read its predecessor's work cannot fake its own.

- [x] Step 1 — Seed. Run `date -u +%s` for epoch seconds. Compute
  `printf '%s' "<epoch>" | md5sum`. Record the epoch, the full md5 hash, and the
  first 8 hex characters of that hash for Step 2.
- [x] Step 2 — Convert. Read Step 1's first 8 hex characters from RELAY3-LOG.md.
  Convert to decimal with `printf '%d\n' 0x<hex>`, then convert that decimal to
  base 7 with `echo "obase=7; <decimal>" | bc`. Record hex, decimal, and base-7.
- [x] Step 3 — Fibonacci. Read Step 2's base-7 value from the log. Sum its digits
  to get n. Compute the nth Fibonacci number with F(1)=1, F(2)=1. Show the
  sequence you generated up to F(n). Record n and F(n).
- [x] Step 4 — Sentence. Read Step 3's F(n) from the log. Take its decimal digits
  in order. Write an original sentence about relays or persistence in which the
  Nth word has exactly as many letters as the Nth digit — treat a digit of 0 or 1
  as 3 letters, and any digit as a minimum of 2. Record the sentence and a
  per-word letter count proving the fit.
- [x] Step 5 — Audit. Independently re-derive Steps 2 and 3 from Step 1's md5
  hash: redo the hex-to-decimal conversion, redo the base-7 conversion, recompute
  the digit sum, and recompute F(n) by a different method than Step 3 used. Then
  check Step 4's per-word letter counts yourself. Say plainly whether each item
  matches; if anything disagrees, report the disagreement rather than papering
  over it.
- [ ] Step 6 — Close. Confirm Steps 1–5 are ticked and their results are present
  in RELAY3-LOG.md. Append the single line found in RELAY3-MARKER.txt to the log,
  followed by the UTC timestamp and the end-to-end elapsed time from Step 1's
  epoch. Spawn nobody.
