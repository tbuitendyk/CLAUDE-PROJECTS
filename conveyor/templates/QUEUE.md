# CONVEYOR queue

Plan files in priority order. Each dispatcher tick takes the FIRST plan below
that still has at least one unchecked step and dispatches a worker for it.
When every plan is fully ticked, ticks become no-ops and the conveyor idles.

Add a plan at any time — the next tick picks it up. **No re-arming, no new
approvals.** Reorder freely; order is read fresh every tick.

Each entry: plan file, then its log file, then a one-line description.

## Queue

1. `conveyor/plans/example.md` — log `conveyor/logs/example-log.md` — replace this with your first real plan

## Finished

Move completed entries down here rather than deleting them, so the record of
what this conveyor has worked survives.
