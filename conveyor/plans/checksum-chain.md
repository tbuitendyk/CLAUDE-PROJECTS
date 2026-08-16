# checksum-chain

A short dependent chain used to prove the CONVEYOR protocol end to end. Each step
needs the previous step's published numbers, so a worker that cannot read its
predecessor's output cannot fake its own.

**Branch:** `claude/sandbox-fd3rem`
**Log:** `conveyor/logs/checksum-chain-log.md`
**Completion test:** no lines matching `^- \[ \]` remain below. That is the only
test — never grep the log for a banner, it contains prompt text verbatim.
**Completion marker:** the exact line lives in
`conveyor/plans/checksum-chain-marker.txt`. Step 4 copies that file's line into
the log. It is kept in its own file so the marker string never appears in a
prompt.

## Steps

- [x] Step 1 — Seed. Run `date -u +%s` for epoch seconds. Compute
  `printf '%s' "<epoch>" | sha1sum`. Record the epoch, the full sha1 hash, and
  the first 6 hex characters of that hash for Step 2.
- [ ] Step 2 — Expand. Read Step 1's first 6 hex characters from the log.
  Convert to decimal with `printf '%d\n' 0x<hex>`, then compute
  `decimal * 7 + 13` with `bc`. Record the hex, the decimal, and the result.
  Also record the result's digit count.
- [ ] Step 3 — Verify. Independently re-derive Step 2 from Step 1's sha1 hash:
  redo the hex-to-decimal conversion and redo the arithmetic by a different
  method than Step 2 used (for example `python3 -c` rather than `bc`). State
  plainly whether each value matches. If anything disagrees, report the
  disagreement rather than papering over it.
- [ ] Step 4 — Close. Confirm Steps 1–3 are ticked and their results are present
  in the log. Append the single line from
  `conveyor/plans/checksum-chain-marker.txt` to the log, followed by the UTC
  timestamp and the elapsed time from Step 1's epoch. Spawn nobody.
