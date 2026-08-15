# CONVEYOR — what YOU have to do

For the human. You will not remember the details between uses; you do not need
to. This page is the whole of your side.

---

## Starting a run

**1. Set permission mode to `Auto`.**
Bottom of the session. This is the single most important switch — under the
other modes the system stalls on approvals you may never see. If a run mysteriously
does nothing, check this first.

**2. Tell the session what to do.** Paste this:

> Follow the CONVEYOR protocol. Fetch it with:
> `git fetch origin vps-access && git show origin/vps-access:conveyor/PROTOCOL.md`
> Then set up a conveyor for this plan: <describe the work, or point at a plan file>

**3. Say how long it may run**, if 24 hours isn't right. Every conveyor is armed
with an expiry and shuts itself down when it passes, finished or not. *"Give this
one three days"* is enough. If you say nothing you get 24 hours.

**4. Approve twelve alarms.** You will get twelve permission prompts in a row,
one per alarm. This is normal and it is the price of a five-minute heartbeat —
the server refuses any single alarm that fires more often than hourly, so twelve
hourly alarms offset five minutes apart is the only way. Tested twice, both
rejected, on 2026-08-15.

**5. Walk away.** From here it runs itself, and turns itself off when the work is
done or the deadline passes. Your session will show one short line every five
minutes. Steps complete roughly every 2–5 minutes.

---

## Stopping a run — it stops itself

**You do not have to remember to turn it off.** Every tick checks two shutdown
conditions, and either one ends the run:

- **The work is done.** After about 15 minutes of finding nothing left to do, it
  deletes all twelve alarms. The short wait is deliberate: it is your window to
  add another plan without re-arming and re-approving twelve times.
- **The deadline passed.** Every conveyor is armed with an expiry — 24 hours by
  default, longer if you say so. Past it, the next tick shuts everything down no
  matter what state the work is in. This is the one that saves you when a project
  wedges and would otherwise tick until you noticed.

Tell the session at arming time if you want a different horizon: *"give this one
three days"* or *"expire it tonight."*

To stop early, say **"tear down the conveyor."**

**One caveat, stated plainly:** deleting an alarm sometimes asks you to approve
and sometimes doesn't — it has been seen both ways. If it asks while you're away,
the deletions sit waiting and the alarms stay live until you answer. So
self-shutdown makes forgetting far less likely; it does not make it impossible.
If you come back to a session full of ticks, that is what happened — approve the
prompts, or just say "tear down the conveyor."

---

## Adding more work mid-run

Just say so. New plans go in the queue and the next tick picks them up. **No
re-arming, no new approvals.** This is the point of the queue: you can stack up
however many builds and projects you like and they will be worked in order.

---

## What "normal" looks like

- One line in your session every five minutes.
- Most of them say nothing was dispatched — that is correct, not a stall.
- A step lands every few minutes while there is work.
- Worker sessions appear in your sidebar as they run. They pile up; ask for them
  to be archived whenever you like.

## What "wrong" looks like

| Symptom | Almost certainly |
|---|---|
| Ticks arrive, nothing ever dispatches, queue has unfinished work | permission mode is not Auto |
| No ticks at all | alarms were never created, or bound to a different session |
| A worker sits forever in the sidebar | it was started without a repo attached and is stuck on an invisible approval |
| Steps get done twice | the dispatcher is not checking worker liveness properly |
| It says the plan is complete but it isn't | something grepped a log for a completion banner and matched prompt text |

Any of these: say what you are seeing and ask for `OPERATIONS.md` to be followed.

---

## The costs, stated plainly

- **Twelve approvals to start.** Unavoidable — the server refuses any alarm that
  fires more often than hourly.
- **Shutdown is automatic**, but may ask you to approve the twelve deletions
  depending on how the session is behaving that day.
- **Twelve alarms firing hourly is 288 wake-ups a day** if one somehow ran a full
  day. Each is a fetch and a grep — cheap, but not free. The expiry is what keeps
  that number theoretical.
- **Worst case five minutes of dead air per step**, typically two to three.

---

## Two things that are not your fault

**Workers sometimes report "need input" or "stopping here" after finishing
correctly.** The status field lies; the repo is the truth. The dispatcher treats
that status as "not running" and moves on, which is right.

**The first dispatch after a long idle can lag.** Alarms delivered into an idle
session have been observed arriving anywhere from five minutes to three hours
late. Once the session is active, ticks land on time.
