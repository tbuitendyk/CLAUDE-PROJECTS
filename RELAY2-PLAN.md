# RELAY2 — self-chaining relay, take two

Each step is done by a **brand-new session** that then spawns the next one. No
session does two steps. Continuity lives only in this repo. Steps deliberately
depend on earlier results, so a shift that cannot read its predecessor's work
cannot fake its own.

**Branch:** `claude/sandbox-fd3rem`, mirrored to `sandbox`.
**Log:** `RELAY2-LOG.md` — every shift appends the prompt it received and its full response.
**Completion test:** no `- [ ]` lines remain below. That is the only test; do not
grep the log for a banner (the log contains prompt text and would false-positive).
**Completion marker** (Step 6 writes this line, at the start of a line, exactly):
`RELAY2 COMPLETE`

## Steps

- [x] Step 1 — Seed. Run `date -u +%s` for the epoch seconds. Compute
  `printf '%s' "<epoch>" | sha256sum`. Record the epoch, the full hash, and note
  the first 6 hex characters for Step 2.
- [x] Step 2 — Prime. Read Step 1's first 6 hex characters from RELAY2-LOG.md,
  convert to decimal (`printf '%d\n' 0x<hex>`), then find the smallest prime
  greater than or equal to that number. Show the primality check you ran.
  Record hex, decimal, and the prime.
- [x] Step 3 — Shape. Read Step 2's prime from the log. Compute its digit sum and
  its binary representation (`printf '%d %s\n' "$p" "$(echo "obase=2;$p" | bc)"`).
  Record both, plus the prime's first four decimal digits as a list.
- [ ] Step 4 — Verse. Read Step 3's four digits from the log. Write an original
  four-line poem about relays or continuity in which line N has exactly as many
  words as the Nth digit (treat a digit of 0 or 1 as 3 words, and any digit as a
  minimum of 2 words). Record the poem and a per-line word count proving the fit.
- [ ] Step 5 — Audit. Independently re-verify Steps 2 and 3 from Step 1's hash:
  redo the hex→decimal conversion, re-test the prime's primality, recompute the
  digit sum and binary. Record whether each matches; if anything disagrees, say
  so plainly rather than papering over it.
- [ ] Step 6 — Close. Confirm Steps 1–5 are ticked and their results present in
  RELAY2-LOG.md. Append the completion marker line exactly as given at the top of
  this file, followed by the UTC timestamp. Spawn nobody.
