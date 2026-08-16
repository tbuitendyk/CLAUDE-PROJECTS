# CONVEYOR dispatch state

One line per worker dispatched, newest last. The dispatcher reads the LAST
dispatch line and compares its timestamp against the newest commit to any plan or
log. Dispatch newer than commit means the step is already somebody's, so the tick
waits. That comparison is the entire scheduling decision — no session is ever
queried, and no worker is ever replaced.

A line recording a REFUSED dispatch is NOT a dispatch: it does not end in
"dispatched", so the next tick skips past it and retries.

Real lines always begin with a 4-digit year. **Match `^20[0-9][0-9]-`, never a
loose substring** — otherwise this very paragraph matches and the dispatcher will
believe in a worker that does not exist.

Line shape (this example deliberately does not begin with a year):

    YYYY-MM-DDTHH:MM:SSZ  |  session <id>  |  plan <name>  |  step <N>  |  dispatched

## Dispatch log
