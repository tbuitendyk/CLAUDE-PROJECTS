# CONVEYOR — what YOU have to do

For the human. You will not remember the details between uses; you do not need
to. This page is the whole of your side.

---

## Starting a run

**1. Set permission mode to `Auto`.**
Bottom of the session. This is the single most important switch — under the
other modes the system stalls on approvals you may never see. If a run
mysteriously does nothing, check this first.

**2. Tell the session what to do.** Paste this:

> Follow the CONVEYOR protocol. Fetch it with:
> `git fetch origin vps-access && git show origin/vps-access:conveyor/PROTOCOL.md`
> Then set up a conveyor for this plan: <describe the work, or point at a plan file>

**3. Approve twelve alarms.** Twelve permission prompts in a row, one per alarm.
Normal, and it is the price of a five-minute heartbeat — the server refuses any
single alarm that fires more often than hourly, so twelve hourly alarms offset
five minutes apart is the only way. Tested twice, both rejected, 2026-08-15.

**4. Walk away.** It runs itself, works through everything you queue, and shuts
itself down when done or when stuck. One short line appears in the session every
five minutes. Steps complete roughly every 2–5 minutes.

---

## Adding more work — any time, no approvals

**This is the main thing to remember, because it is what makes the twelve
approvals worth paying.** Once a conveyor is armed, piling on more work is free:

| When you add it | What happens |
|---|---|
| While it is working | Next tick picks it up. Put it above the current entry in the queue to jump the line. |
| During the 30-minute cool-off | Next tick resets the cool-off and carries on. |
| After it has shut down | Costs a fresh arming — twelve approvals. Nothing is lost; it resumes exactly where it stopped. |

Just say: **"add a plan to the conveyor that does X."** The session writes it,
queues it, and pushes. You can do this while it is mid-run.

The cool-off window exists for exactly this. If you think more work is coming,
say so and it can be widened.

---

## Stopping — it stops itself, but it needs one thing from you

Two conditions end a run, and either one shuts it down:

- **Everything is done.** After 30 minutes of finding nothing left to do, it
  disarms.
- **It got stuck.** If nothing has moved for 3 hours and work is still
  outstanding, it disarms. This is a *stall* timer, not a deadline — a project
  that keeps making progress runs as long as it needs to, all day or overnight.
  Only silence ends it.

**Here is the part that needs you.** Deleting an alarm requires your approval,
same as creating one — and by then you're not watching, which is the whole
point. So the twelve deletions will be sitting there waiting.

**You will be told.** Any shutdown sends you a push notification *and* an email
through the mail hub, before it starts deleting. The message says what happened
and that twelve approvals are waiting. Open the session on any client, approve
them, done.

If you ignore it, the alarms keep ticking — harmlessly, one line every five
minutes — until you get to it. Nothing runs away; it just doesn't finish
cleaning up.

To stop early: **"tear down the conveyor."**

---

## What "normal" looks like

- One line in your session every five minutes.
- Most say nothing was dispatched — correct, not a stall.
- A step lands every few minutes while there is work.
- Worker sessions pile up in your sidebar; ask for them to be archived whenever.

## What "wrong" looks like

| Symptom | Almost certainly |
|---|---|
| Ticks arrive, nothing ever dispatches, work is outstanding | permission mode is not Auto |
| No ticks at all | alarms were never created, or bound to a different session |
| A worker sits forever in the sidebar | started without a repo attached, stuck on an invisible approval |
| Steps get done twice | worker liveness not being checked properly |
| It says complete but isn't | something grepped a log for a completion banner and matched prompt text |
| It shut down mid-project | 3-hour stall timer fired — something was wedged; check the last log entry |

Any of these: say what you're seeing and ask for `OPERATIONS.md` to be followed.

---

## The costs, stated plainly

- **Twelve approvals to start, twelve to stop.** Both create *and* delete need
  your click. Unavoidable. The point of the design is that you pay this twice
  per project instead of continuously.
- **Adding work costs nothing** — no re-arming, no approvals.
- **Twelve alarms firing hourly is 288 wake-ups a day** if one ran a full day.
  Each is a fetch and a grep. The stall timer is what keeps that bounded.
- **Worst case five minutes of dead air per step**, typically two to three.

---

## Two things that are not your fault

**Workers sometimes report "need input" or "stopping here" after finishing
correctly.** The status field lies; the repo is the truth. The dispatcher treats
that as "not running" and moves on, which is right.

**The first tick after a long idle can lag.** Alarms delivered into an idle
session have arrived anywhere from five minutes to three hours late. Once the
session is active, ticks land on time.

---

## You do not have to predict how long steps take

Worth knowing because it removes a question you'd otherwise have to answer at
arming time. A worker is judged **alive or dead by whether it is still doing
things**, not by a stopwatch. Its activity timestamp ticks with every action it
takes, so a step that runs for three hours is left alone as long as it keeps
moving. Nothing in this system caps how long work may take.

The single exception: a step whose entire work is **one** long blocking command
with no other activity — a fifteen-minute `make` and nothing else. That can look
frozen. If you have one of those, say so, or just split it into smaller steps.
