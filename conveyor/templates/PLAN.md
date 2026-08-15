# <PLAN NAME>

One line on what finishing this plan achieves.

**Branch:** `<BRANCH>`
**Log:** `conveyor/logs/<name>-log.md` — every worker appends its prompt, full
response, and results there.
**Completion test:** no lines matching `^- \[ \]` remain below. That is the ONLY
test. Never grep the log for a banner — the log contains prompt text verbatim and
will false-positive.
**Completion marker** (optional): keep the marker string in its own file, e.g.
`conveyor/plans/<name>-marker.txt`, and have the last step copy that file's line
into the log. Never write the marker string into any prompt.

## How to write the steps below

- Each step is one line beginning exactly `- [ ] ` followed by a short name, then
  the instructions. A worker changes it to `- [x] ` when done.
- One step = one worker = one commit. Aim for a few minutes of work each. Split
  anything that would run half an hour.
- Make each step depend on the previous one's published output where the work
  naturally allows it. A step that can be completed without reading its
  predecessor's results can be silently faked.
- Say what to record, not just what to do — the log is how the next worker and
  the human both find out what happened.
- The last step should verify the earlier ones rather than just declaring
  victory. An audit step that re-derives results independently is cheap and
  catches the failure mode where a worker invented a number.

## Steps

- [ ] Step 1 — <name>. <what to do, what to record>
- [ ] Step 2 — <name>. Read Step 1's <result> from the log, then <what to do>.
- [ ] Step 3 — <name>. <...>
- [ ] Step N-1 — Audit. Independently re-derive the results of the earlier steps
  by a different method than they used. State plainly whether each matches; if
  anything disagrees, report the disagreement rather than papering over it.
- [ ] Step N — Close. Confirm every earlier step is ticked and its results are in
  the log. Append the completion marker and the UTC timestamp. Spawn nobody.
