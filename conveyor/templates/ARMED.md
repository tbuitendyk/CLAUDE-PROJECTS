# CONVEYOR — currently armed alarms

**Alarms never stop themselves.** Without this list nobody can find them to shut
them off, so fill it in at arming time and commit it before walking away.

- **Project:** <PROJECT>
- **Branch:** <BRANCH>
- **Owner session:** <session id the alarms wake>
- **Armed at:** <UTC timestamp>
- **Armed by:** <who / which session>

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

## To tear down

Delete every trigger id above (twelve approvals, once), confirm with
`list_triggers` that none remain, archive the worker sessions, then empty this
table.

## History

Record teardowns here so an empty table is distinguishable from one that was
never filled in.

| Armed | Torn down | Project | Notes |
|---|---|---|---|
