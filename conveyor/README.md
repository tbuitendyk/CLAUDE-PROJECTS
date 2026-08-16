# CONVEYOR — run a long project to completion without being poked

**CONVEYOR** is the named procedure for getting Claude to work a multi-step plan
all day, unattended, across any branch of this repo. It exists because sessions
stop existing between turns: a promise to "keep working" is not a schedule.

It was designed, measured, and proved on 2026-08-15. A six-step dependent chain
finished in 53 minutes with zero human input and zero permission prompts. See
`EVIDENCE.md` for the numbers and the four things that were tried and failed.

---

## How to use it, from any session

Paste this into any Claude session working any branch of this repo:

> Follow the CONVEYOR protocol. Fetch it with:
> `git fetch origin vps-access && git show origin/vps-access:conveyor/PROTOCOL.md`
> Then set up a conveyor for the plan I'm about to give you.

That is the whole entry point. The session reads `PROTOCOL.md` and knows what to do.

To retrieve any file in this directory from another branch:

    git fetch origin vps-access
    git show origin/vps-access:conveyor/PROTOCOL.md
    git show origin/vps-access:conveyor/templates/WORKER-PROMPT.txt

---

## The mental model, in four sentences

Your conversation is a **session**. A session does nothing unless something
wakes it. The only wake-up that survives everything is an **alarm stored on
Anthropic's servers** — not a timer inside the session, and not a background
process in the container. So: alarms wake your session, your session starts one
short-lived **worker** per step, and the **git repo** is the memory that ties
them together.

```
   12 hourly alarms, offset 5 minutes apart
   :00 :05 :10 :15 :20 :25 :30 :35 :40 :45 :50 :55
                    |
                    v
        your OWNER SESSION wakes up
                    |
        +--------+-----------------+------------------+
        |        |                 |                  |
     queue    a worker was      same, but          otherwise
     done?    sent after the    3+ hours ago
        |     last commit?          |                 |
     DISARM      wait —          DISARM          start ONE worker
     after       do nothing      itself                |
     linger                                            v
                                     fresh session, repo attached,
                                     does exactly ONE step,
                                     ticks its box, pushes, STOPS.
                                     It starts nothing.
```

The worker never starts the next worker. That is not a style preference — a
session that was itself spawned is refused when it tries to launch an
open-ended chain of further sessions. The clock outside the chain is what
advances it.

---

## The files

| File | What it is |
|---|---|
| `PROTOCOL.md` | **The spec.** What a session must do to set up and run a conveyor. Exact tool calls and arguments. |
| `OWNER-CHECKLIST.md` | **What you personally must do.** Auto mode, the approvals, what to expect. Read this if you've forgotten the routine. |
| `OPERATIONS.md` | Arm it, watch it, stop it, fix it. The runbook. |
| `EVIDENCE.md` | Why every rule is the way it is, with measurements. Read before changing anything. |
| `templates/` | Copy these into your project branch and fill them in. |

## Stacking work on it

Once armed, adding work is free — no re-arming, no approvals. Every tick
re-reads `QUEUE.md` from the branch, so anything pushed before the next tick gets
picked up. Queue order is priority order. This works while it is running *and*
during the 30-minute cool-off after the queue empties, which resets the moment
new work appears. That is what makes the twelve approvals worth paying: you pay
them once per project, not once per task. Full detail in `PROTOCOL.md` §2a.

## It turns itself off

The owner has to remember to *start* a conveyor. They should never have to
remember to stop one. Every tick checks two shutdown conditions first:

- **Stalled** — a step was dispatched `stall-hours` ago (default 3) and has
  committed nothing since. A *stall* timer, not a deadline: a run that keeps
  delivering continues as long as the work takes, all day or overnight. Progress
  is the licence to keep running; only silence ends it.
- **Queue complete + cool-off** — nothing left to do for `linger-ticks` (default
  6, ≈30 minutes), so it disarms.

**Shutdown needs one thing from the owner, and that is why it emails them.**
Deleting an alarm requires their approval, and at shutdown time they are by
definition not watching. So the disarm procedure notifies **first** — push
notification plus email through the established mail hub — and then starts
deleting, leaving twelve approvals waiting alongside an alert explaining them.
Unapproved alarms keep ticking harmlessly until the owner gets to it.

## One worker per step, never replaced

The tick decides from two git timestamps — newest commit, and last dispatch —
and never asks whether a worker is alive. If a step is taken, it waits, however
long that takes. If a step delivers nothing for three hours, the whole conveyor
stops and emails, leaving the work untouched where it stopped.

That means no step has a time limit, and no second worker is ever sent onto a
live step to race it. A worker that *fails* cleanly logs the failure, which is a
commit, so the next tick retries immediately — only silent death costs the wait.

## The one-line version

Twelve alarms, one worker per step never replaced, git as the memory, never let a
worker start another worker, stack on as much work as you like for free, and it
emails you when it wants to shut down.

---

## Status: designed and documented, NOT yet proven as written

Read this before trusting it with something that matters.

The **mechanisms** underneath are measured and solid (see `EVIDENCE.md`):
server-side alarms fire reliably, a top-level session can dispatch a worker, a
repo-attached worker does its step and pushes, git survives everything, and a
five-step dependent chain completed unattended in 53 minutes.

But **that proven run used an earlier control design** — six alarms at ten
minutes, a liveness check, a freshness gate. The scheduling logic documented here
replaced all of that and **has never executed end to end.** Specifically, these
have never once run:

| Never executed | Where |
|---|---|
| the two-timestamp dispatch rule (T vs D) | `PROTOCOL.md` §4a |
| twelve alarms at five-minute spacing | `PROTOCOL.md` §3 |
| self-disarm deleting its own twelve alarms | `DISPATCHER-PROMPT.txt` |
| the shutdown notification (push + mail hub) | `DISPATCHER-PROMPT.txt` |
| the stall timer actually firing | `PROTOCOL.md` §6 |
| a multi-plan queue | `QUEUE.md` |
| adding work to a live conveyor | `PROTOCOL.md` §2a |

The mail-hub send path in particular is transcribed from
`vps-access/MAIL-CHEATSHEET.md`, not executed — nobody has confirmed a conveyor
shutdown notice actually arrives.

**What would make this production:** one small real conveyor, three or four
steps, run to completion and then allowed to disarm itself. That single run
exercises arming, the dispatch rule, the queue, cool-off, self-disarm, and the
notification path together. Until then this is a careful design, not a proven
process.
