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
        +--------+---------+---------+-------------+----------+
        |        |         |         |             |          |
    past its  queue     worker    just          otherwise
    deadline? done?     alive?    committed?
        |        |         |         |                |
     DISARM   DISARM    stop      stop        start ONE worker
     itself   after                                   |
              linger                                  v
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

## It turns itself off

The owner has to remember to *start* a conveyor. They should never have to
remember to stop one. Every tick checks two shutdown conditions before doing
anything else:

- **`expires:`** — a hard deadline set at arming time, 24 hours by default. Past
  it, the next tick deletes all twelve alarms whatever state the work is in. This
  covers the case that actually strands people: not a finished project, but a
  wedged one that would tick forever. A conveyor armed with no deadline disarms
  immediately, by design.
- **queue complete + linger** — once there is nothing left to do, it waits about
  15 minutes (in case more work is coming) and then disarms.

Caveat worth knowing: deleting an alarm sometimes asks the owner to approve and
sometimes doesn't. If it asks while they are away, the deletions wait and the
alarms stay live. Self-disarm makes forgetting far less likely; it does not make
it impossible.

## The one-line version

Twelve alarms, one worker per step, git as the memory, never let a worker start
another worker, and it shuts itself off when the work is done or time runs out.
