# RUNNER state

One line per worker the scheduler has dispatched, newest last. The scheduler
reads the last line to decide whether a worker is already in flight before
dispatching another. This is what makes "never cut off a working session" a
check rather than a guess.

Format:
`<UTC ts> | session <id> | step <N> | dispatched`

## Dispatch log
