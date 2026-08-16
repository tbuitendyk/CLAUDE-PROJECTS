# CONVEYOR — currently armed alarms

Fill this in at arming time and commit it before walking away. The dispatcher
reads this file every tick to decide when to shut itself off, and it is the only
written record of what is armed.

- **Project:** <PROJECT>
- **Branch:** <BRANCH>
- **Owner session:** <session id the alarms wake>
- **Armed at:** <UTC timestamp>
- **Armed by:** <who / which session>

## Settings

    stall-hours: 3
    linger-ticks: 6
    idle-ticks: 0
    worker-silence-minutes: 15

**`stall-hours`** — the shutdown backstop. If nothing has been committed to any
queued plan or log for this many hours, there are still unfinished steps, and no
worker is alive, the conveyor is wedged and the next tick disarms it.

This is a **stall** timeout, not a wall-clock deadline. A conveyor that keeps
making progress runs as long as the work takes — all day, overnight, however
long. Progress is the licence to keep running. Only silence ends it.

**`linger-ticks`** — how many consecutive "nothing left to do" ticks to wait
before disarming once the queue is complete. Default 6, i.e. about 30 minutes.
That window is the owner's chance to add more work without re-arming twelve
alarms and approving twelve prompts. See "Adding work" in `PROTOCOL.md`.

**`idle-ticks`** — the running count. The dispatcher increments it when the
queue is complete and resets it to 0 the moment new work appears.

**`worker-silence-minutes`** — how long a worker's activity timestamp
(`updated_at`) may be **frozen** before it is presumed dead. Default 15.

Read that carefully, because it is not a step budget. `updated_at` advances at
least once per tool call the worker makes, so a healthy worker's timestamp is
never more than one tool call old — **no matter how long its whole step takes.**
A three-hour build that keeps doing things is never touched. Only a session that
has genuinely gone quiet gets replaced. You do not have to guess step durations
in advance, and this normally needs no tuning at all.

Measured 2026-08-15: a worker's `updated_at` advanced at every sample while it
worked (23:58:44 → 00:00:51 → 00:03:50), tracking real progress.

The one case that needs it raised: a step that makes a **single** tool call
lasting longer than this, with no other activity — one long `make`, say.
`updated_at` is confirmed to advance *between* tool calls; whether it also
advances *during* one long call is untested, because this harness blocks
foreground `sleep` and the case could not be constructed. If a step has one very
long blocking command, either raise this value past its worst case or split the
step.

## Alarms

| Alarm | cron (UTC) | trigger id |
|---|---|---|
| conveyor-<project>-00 | `0 * * * *`  | trig_… |
| conveyor-<project>-05 | `5 * * * *`  | trig_… |
| conveyor-<project>-10 | `10 * * * *` | trig_… |
| conveyor-<project>-15 | `15 * * * *` | trig_… |
| conveyor-<project>-20 | `20 * * * *` | trig_… |
| conveyor-<project>-25 | `25 * * * *` | trig_… |
| conveyor-<project>-30 | `30 * * * *` | trig_… |
| conveyor-<project>-35 | `35 * * * *` | trig_… |
| conveyor-<project>-40 | `40 * * * *` | trig_… |
| conveyor-<project>-45 | `45 * * * *` | trig_… |
| conveyor-<project>-50 | `50 * * * *` | trig_… |
| conveyor-<project>-55 | `55 * * * *` | trig_… |

Note on the `0 * * * *` row: minute-zero schedules are anchored server-side to
the minute the trigger was created, so that alarm may not land exactly on the
hour. It still fires hourly, which is all the conveyor needs — but if you want
precise placement, use a non-zero minute instead.

## Manual teardown

Self-disarm is the normal path. To stop early, tell the session "tear down the
conveyor": delete every trigger id above, confirm with `list_triggers` that none
remain, archive the worker sessions, and move the rows into History below.

Deleting a trigger requires the owner's approval, so a teardown started while
they are away will sit pending until they open a client. That is expected, and
it is why the disarm procedure notifies before it starts deleting.

## History

Record every teardown here, so an empty table is distinguishable from one that
was never filled in.

| Armed | Torn down | Reason | Project | Notes |
|---|---|---|---|---|
