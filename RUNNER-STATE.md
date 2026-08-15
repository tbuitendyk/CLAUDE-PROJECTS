# RUNNER state

One line per worker the scheduler has dispatched, newest last. The scheduler
reads the last line to decide whether a worker is already in flight before
dispatching another. This is what makes "never cut off a working session" a
check rather than a guess.

Format (real lines always begin with a 4-digit year — match `^20[0-9][0-9]-`,
never a loose substring, or this very paragraph will false-positive):

    YYYY-MM-DDTHH:MM:SSZ  session <id>  step <N>  DISPATCHED

## Dispatch log
2026-08-15T21:42:55Z | session session_01RA3A6w3AHipE66KtywAK6u | step 2 | dispatched
2026-08-15T21:53:05Z | session session_019utpPMhZB9rxMzMnX96MpM | step 3 | dispatched
2026-08-15T22:03:43Z | session session_01Kfs3gF6CGxd9xD34xpeTWX | step 4 | dispatched
2026-08-15T22:15:22Z | session session_01VjZNiCS6YeKpLMYKHzRHUV | step 5 | dispatched
