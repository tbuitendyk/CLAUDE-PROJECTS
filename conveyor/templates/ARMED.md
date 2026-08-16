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

**`stall-hours`** — how long a step may go without delivering before the whole
conveyor gives up. Default 3.

The clock starts when a worker is dispatched and is reset by any commit to a
plan or log. So a step that keeps working — however long it takes — is never
disturbed, and a step that has produced nothing for three hours ends the run.

**Nothing caps how long work may take.** There is no per-step budget, no
liveness check, and no worker is ever replaced. Exactly one worker is dispatched
per step. If it delivers, the next step goes out. If it dies silently, the
conveyor waits `stall-hours`, then stops and emails the owner with the work
sitting exactly where it stopped.

**`linger-ticks`** — how many consecutive "nothing left to do" ticks to wait
before disarming once the queue is complete. Default 6, i.e. about 30 minutes.
That window is the owner's chance to add more work without re-arming twelve
alarms and approving twelve prompts. See "Adding work" in `PROTOCOL.md`.

**`idle-ticks`** — the running count. The dispatcher increments it when the
queue is complete and resets it to 0 the moment new work appears.

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
