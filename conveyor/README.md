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
        +-----------+------------------------------+
        |           |              |               |
   plan done?  worker alive?  just committed?   otherwise
     stop         stop           stop         start ONE worker
                                                    |
                                                    v
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

## The one-line version

Twelve alarms, one worker per step, git as the memory, and never let a worker
start another worker.
