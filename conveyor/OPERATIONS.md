# CONVEYOR — operations runbook

For a session running or repairing a conveyor. `PROTOCOL.md` says what to build;
this says how to operate it.

---

## Arming

1. Confirm permission mode is `Auto`. If not, stop and tell the human.
2. Confirm the project files exist and are pushed: `QUEUE.md`, at least one plan
   with unchecked steps, `STATE.md`, `WORKER-PROMPT.txt`.
3. Get the owner session id.
4. Tell the human, in one line, that twelve approvals are coming.
5. Register with the mail hub: run script `hub-register.sh` with the conveyor's
   hub name via the deploy endpoint (`vps-access/MAIL-CHEATSHEET.md`). Without
   this the shutdown email cannot be delivered. Idempotent.
6. Create twelve triggers, minutes `0 5 10 15 20 25 30 35 40 45 50 55`.
7. Write all twelve ids into `ARMED.md` and fill the settings block —
   `stall-hours: 3`, `linger-ticks: 6`, `idle-ticks: 0`. Commit, push.
8. Confirm with `list_triggers` that twelve exist and their `next_run_at` values
   are spread five minutes apart. If they are bunched, the cron strings were
   wrong — fix before walking away.

**Do not tell the human it is running until step 8 passes.** A conveyor that was
never armed looks identical to one that is idle.

**You do not need to ask how long steps take.** Nothing caps step duration. A
step is left alone until it delivers or until `stall-hours` passes with nothing
committed at all.

---

## Watching

Each tick replies one line. Do not narrate; the human is reading these in a
scrollback and wants density.

Good tick replies:

    3 steps left; worker <id> still working (2 min) — nothing dispatched
    2 steps left; last commit 41 min old — dispatched step 4 as <id>
    queue complete — nothing dispatched

To check progress without waiting for a tick:

    git fetch origin <branch>
    git show origin/<branch>:conveyor/plans/<name>.md | grep -c '^- \[ \]'
    git log origin/<branch> --format='%ci  %s' -10

---

## Stopping

Normally you do not: the conveyor disarms itself when the queue is complete
(after `linger-ticks`) or when it has stalled for `stall-hours`. Both paths run
the same procedure, spelled out at the end of `DISPATCHER-PROMPT.txt` — and both
**notify the owner before deleting anything**, because the deletions need their
approval and they are not watching. Never skip or reorder that step.

To stop early, or to finish a disarm that only partly succeeded:

1. Read the twelve ids from `ARMED.md`.
2. `delete_trigger` on each — including the one that fired the current tick, if a
   tick is what brought you here. Its message is already delivered.
3. If any delete fails, **continue with the rest** and name the survivors
   explicitly. A half-disarmed conveyor reported as "done" is the worst outcome.
4. `list_triggers` to confirm none remain.
5. Archive the worker sessions.
6. Move the `ARMED.md` rows into History with the reason, reset `idle-ticks:`,
   clear `expires:`, commit, push.

### If ticks keep arriving after a disarm

The deletions were refused or are sitting on approvals the human has not
answered. Check `list_triggers` for what is still live, tell the human exactly
which ids remain, and retry the deletes. Do not report the conveyor as stopped
until `list_triggers` is clean.

---

## Troubleshooting

### Ticks arrive but nothing ever dispatches
Check in this order:
1. Is the queue actually finished? `grep -c '^- \[ \]'` on each plan.
2. Is a dispatch recorded as newer than the last plan/log commit? Then the tick
   correctly believes a worker owns the step and is waiting it out. Check how old
   that dispatch is — if it is past `stall-hours`, the tick should have disarmed;
   if it hasn't, the tick logic is wrong.
3. Is the staleness gate too wide? At five-minute spacing anything above about
   3 minutes starts eating ticks.
4. Permission mode.

### Dispatch is being refused
Read the refusal text. If it is `Blocked by classifier`:
- Check the call has **exactly four arguments**. Any extra argument, especially
  `extra_allowed_tools`, is the usual cause.
- Check `WORKER-PROMPT.txt` does not tell the worker to spawn anything. A
  self-replicating worker prompt is refused ~95% of the time.
- If both are clean, it is the intermittent gate: retry identically up to three
  times, then record and let the next tick handle it. Do not reword the call.

### A worker hangs forever
Almost always spawned without `source_url`/`source_revision`, so it called
`add_repo` and is blocked on an approval nobody can see. To confirm while
debugging you may call `get_session` by hand and look for `status_detail`
mentioning a permission wait — that is a diagnostic, not something a tick should
ever do. Archive it and fix the dispatch call.

### Two workers did the same step
The dispatch record was missing when the second tick ran — this cannot happen if
`STATE.md` is written correctly. Verify the tick (a) anchors on `^20[0-9][0-9]-`
rather than a loose substring when finding the last dispatch line, (b) skips
REFUSED lines when looking for the last *dispatch*, and (c) commits and pushes
that line before ending its turn. An unrecorded or unpushed dispatch is invisible
to every later tick.

### The plan reports complete but isn't
Something grepped a log for a completion banner and matched prompt text echoed
in the log. The completion test is `grep -c '^- \[ \]'` on the plan. Fix the test,
not the data.

### Pushes keep getting rejected
Expected when workers and ticks overlap. `git pull --rebase origin <branch>` then
push again. **Never force-push** — that discards a worker's completed step.

### The container restarted mid-run
Harmless. Workers run in their own containers and the repo holds all state. Sync
and carry on. Anything you had running in the background locally is gone — only
git survives.

---

## Tuning

Defaults, and what moves them:

| Knob | Default | Raise it if | Lower it if |
|---|---|---|---|
| alarm spacing | 5 min | ticks feel wasteful | you need tighter latency (needs more alarms) |
| `stall-hours` | 3 | a single step can legitimately deliver nothing for longer | you want a wedged run cleaned up sooner |
| `linger-ticks` | 6 (≈30 min) | more work is likely to arrive | you want the alarms gone promptly |
| just-committed gate | 2 min | you see duplicate dispatches | dead air is eating the run |
| retry attempts | 3 | refusals are frequent | — |

`stall-hours` is the only timer that touches step execution, and it is a silence
detector rather than a budget: it measures how long since anything was
*committed*, not how long a step has been running. Nothing in this system caps
how long work is allowed to take.

At the original 10-minute spacing the just-committed gate was 6 minutes and cost
a full extra tick on the last step of a six-step plan — more than a third of the
total run time. Keep this gate well under the spacing.
