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

**3. Approve twelve alarms.** You will get twelve permission prompts in a row,
one per alarm. This is normal and it is the price of a five-minute heartbeat —
the server refuses any single alarm that fires more often than hourly, so twelve
hourly alarms offset five minutes apart is the only way. Tested twice, both
rejected, on 2026-08-15.

**4. Walk away.** From here it runs itself. Your session will show one short line
every five minutes. Steps complete roughly every 2–5 minutes.

---

## Stopping a run

Tell the session: **"tear down the conveyor."** You will approve twelve
deletions. Then it is gone.

**Alarms never stop on their own.** When a plan finishes, the ticks keep coming
— they just say "queue complete, nothing dispatched" forever. That is by design
(so you can add more work without re-arming) but it means teardown is a thing
you have to actually ask for.

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

- **Twelve approvals to start, twelve to stop.** Unavoidable.
- **Twelve alarms firing hourly is 288 wake-ups a day.** Each is a fetch and a
  grep — cheap, but not free, and they run until deleted.
- **Worst case five minutes of dead air per step**, typically two to three.

---

## Two things that are not your fault

**Workers sometimes report "need input" or "stopping here" after finishing
correctly.** The status field lies; the repo is the truth. The dispatcher treats
that status as "not running" and moves on, which is right.

**The first dispatch after a long idle can lag.** Alarms delivered into an idle
session have been observed arriving anywhere from five minutes to three hours
late. Once the session is active, ticks land on time.
