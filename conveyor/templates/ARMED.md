# CONVEYOR — currently armed alarms

Fill this in at arming time and commit it before walking away. The dispatcher
reads this file every tick to decide when to shut itself off, and it is the only
place the trigger ids are written down.

- **Project:** <PROJECT>
- **Branch:** <BRANCH>
- **Owner session:** <session id the alarms wake>
- **Armed at:** <UTC timestamp>
- **Armed by:** <who / which session>

## Shutdown policy

The conveyor disarms itself. These three fields decide when.

    expires: <UTC timestamp, e.g. 2026-08-17T00:00:00Z>
    linger-ticks: 3
    idle-ticks: 0

- **`expires:`** — a hard deadline. Past it, the next tick disarms no matter what
  state the queue is in. This is the backstop for the bad case: a conveyor that
  wedges and would otherwise tick forever. Set it at arming time; default 24
  hours out, longer for a genuinely long build. **A missing or unreadable
  `expires:` is treated as expired**, so a conveyor armed without a deadline
  shuts itself off on the next tick rather than running loose.
- **`linger-ticks:`** — how many consecutive "nothing left to do" ticks to wait
  before disarming. Default 3, i.e. about 15 minutes of idle. The window exists
  so the owner can add another plan to the queue without having to re-arm twelve
  alarms and approve twelve prompts.
- **`idle-ticks:`** — the running count. The dispatcher increments it when the
  queue is complete and resets it to 0 the moment new work appears.

To make a conveyor run until manually stopped, set `expires:` far out and
`linger-ticks:` high — but understand that you are opting out of the thing that
stops you forgetting.

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

## History

Record every teardown here, so an empty table is distinguishable from one that
was never filled in.

| Armed | Torn down | Reason | Project | Notes |
|---|---|---|---|---|
