# CONVEYOR dispatch state

One line per worker dispatched, newest last. The dispatcher reads the LAST line
to decide whether a worker is already in flight before starting another. That
check is what makes "never cut off a running worker" a fact rather than a hope.

Real lines always begin with a 4-digit year. **Match `^20[0-9][0-9]-`, never a
loose substring** — otherwise this very paragraph matches and the dispatcher will
believe in a worker that does not exist. That bug has been hit twice.

Line shape (this example deliberately does not begin with a year):

    YYYY-MM-DDTHH:MM:SSZ  |  session <id>  |  plan <name>  |  step <N>  |  dispatched

Refusals are recorded too, so a stalled conveyor explains itself:

    YYYY-MM-DDTHH:MM:SSZ  |  DISPATCH REFUSED after 3 attempts  |  plan <name>  |  step <N>

## Dispatch log
