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
    hung-worker-minutes: 10

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

**`hung-worker-minutes`** — how long a worker may sit in `WORKING` before it is
presumed dead and a replacement is dispatched. Default 10, which suits steps of
a couple of minutes. **Raise this for real builds** — a compile, a deploy, or a
long test run can legitimately exceed ten minutes, and leaving it at the default
will dispatch a second worker on top of a healthy one.

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
