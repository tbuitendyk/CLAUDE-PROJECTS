# CONVEYOR queue

Plan files in priority order. Each tick takes the FIRST plan below that still has
at least one unfinished step and dispatches a worker for it. When every plan is
fully ticked, ticks become no-ops and the conveyor enters its cool-off window.

Add a plan at any time — the next tick picks it up. No re-arming, no new
approvals. Reorder freely; order is read fresh every tick.

## Queue

1. `conveyor/plans/checksum-chain.md` — log `conveyor/logs/checksum-chain-log.md` — end-to-end proof run of the CONVEYOR protocol

## Finished

Move completed entries down here rather than deleting them.
