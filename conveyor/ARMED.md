# CONVEYOR — currently armed alarms

- **Project:** checksum-chain
- **Branch:** claude/sandbox-fd3rem
- **Hub name:** sandbox
- **Owner session:** session_01XgtdraagzH1VbjJ1KUHk3w
- **Armed at:** 2026-08-16T03:07Z
- **Armed by:** Sandbox owner session (end-to-end proof run)

## Settings

    stall-hours: 3
    linger-ticks: 2
    idle-ticks: 0

**`stall-hours`** — how long a step may go without delivering before the whole
conveyor gives up. Default 3. The clock starts when a worker is dispatched and is
reset by any commit to a plan or log. Nothing caps how long work may take.

**`linger-ticks`** — consecutive "nothing left to do" ticks before disarming.
**Set to 2 for this proof run (≈10 minutes) so self-disarm is exercised inside a
single sitting. The production default is 6 (≈30 minutes).**

**`idle-ticks`** — running count, reset to 0 the moment new work appears.

## Alarms

| Alarm | cron (UTC) | trigger id |
|---|---|---|
| conveyor-checksum-00 | `0 * * * *`  | (pending) |
| conveyor-checksum-05 | `5 * * * *`  | (pending) |
| conveyor-checksum-10 | `10 * * * *` | (pending) |
| conveyor-checksum-15 | `15 * * * *` | (pending) |
| conveyor-checksum-20 | `20 * * * *` | (pending) |
| conveyor-checksum-25 | `25 * * * *` | (pending) |
| conveyor-checksum-30 | `30 * * * *` | (pending) |
| conveyor-checksum-35 | `35 * * * *` | (pending) |
| conveyor-checksum-40 | `40 * * * *` | (pending) |
| conveyor-checksum-45 | `45 * * * *` | (pending) |
| conveyor-checksum-50 | `50 * * * *` | (pending) |
| conveyor-checksum-55 | `55 * * * *` | (pending) |

## Manual teardown

Self-disarm is the normal path. To stop early, tell the session "tear down the
conveyor": delete every trigger id above, confirm with `list_triggers` that none
remain, archive the worker sessions, and move the rows into History below.

## History

| Armed | Torn down | Reason | Project | Notes |
|---|---|---|---|---|
