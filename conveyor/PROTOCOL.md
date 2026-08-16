# CONVEYOR PROTOCOL — the spec

You are a Claude session that has been told to follow CONVEYOR. This file tells
you exactly what to build and how to run it. Follow it literally. The rules that
look fussy are the ones that were measured — see `EVIDENCE.md` before deviating.

---

## 0. The three roles

| Role | Who | Lifetime | May it start a session? |
|---|---|---|---|
| **OWNER SESSION** | the conversation the human works in | indefinite | **yes** — this is the only thing that starts workers |
| **DISPATCHER TICK** | a message an alarm delivers into the owner session | one turn | yes — it *is* the owner session |
| **WORKER** | a fresh session with the repo attached | one step, ~90 s | **NO. Never.** |

The owner session never does plan work. Workers never dispatch. Keep that line
clean and the whole thing runs; blur it and you get refusals.

---

## 1. Preconditions — verify before building anything

1. **Permission mode must be `Auto`.** Check the mode indicator at the bottom of
   the owner session. If it is not Auto, tell the human to change it before you
   go further. Under other modes the dispatch calls will stall on approvals the
   human may not even see.
2. **You are on the project's branch**, and the work you want done lives in this
   repo. CONVEYOR moves work through git; anything outside git is invisible to it.
3. **You know this session's own id.** You need it to bind the alarms. If you
   cannot determine it, ask the human for it rather than guessing — an alarm bound
   to the wrong session is silent and confusing.

---

## 2. Build the project files

Create these in the project branch under `conveyor/`. Templates are in
`conveyor/templates/` on the `vps-access` branch — fetch them with
`git show origin/vps-access:conveyor/templates/<file>`.

    conveyor/
      QUEUE.md              ordered list of plan files; first with unfinished work wins
      plans/<name>.md       one file per plan, steps as "- [ ] " checkboxes
      STATE.md              dispatch log — one line per worker started
      WORKER-PROMPT.txt     the prompt every worker receives, verbatim
      ARMED.md              the alarm ids currently armed, so they can be found and killed

### Writing a plan

- Every step is a line beginning exactly `- [ ] `. That string is the only
  progress signal in the system. A worker ticks it to `- [x] ` when done.
- One step = one worker = one commit. Size steps so a worker finishes in a few
  minutes. A step that needs half an hour should be several steps.
- Make each step name what it needs from the previous one. A step that can be
  done without reading its predecessor's output can be faked without anyone
  noticing.
- If a plan needs a completion marker, put the marker string in its **own file**
  and have the last step copy it in. Never put the marker text in a prompt — the
  log contains prompts verbatim, so grepping the log for the marker will match
  the prompt and report the job done when it isn't. This bug has bitten twice.
- **The completion test is always: zero lines matching `^- \[ \]`.** Never grep a
  log for a banner.

### Queueing several projects

`QUEUE.md` lists plan files in priority order. A dispatcher tick picks the
**first plan file with at least one unchecked step** and dispatches for that.
When every listed plan is fully ticked, ticks become no-ops and the conveyor
enters its cool-off window.

---

## 2a. Adding work to a conveyor that is already running

This is the normal way to use it: stack work up as you think of it. **Adding
work never requires re-arming and never costs another approval.** Every tick
re-reads the queue from the branch, so anything pushed before the next tick is
picked up automatically.

There are three states you might be adding into.

**While it is working.** Add the plan and push. The next tick sees it. Because
ticks always take the *first* queue entry with unfinished steps, position in
`QUEUE.md` is the priority control — put it above the current plan to jump the
line, below to run after.

**During the cool-off window** (queue finished, `idle-ticks` counting up toward
`linger-ticks` — about 30 minutes). Same thing: add and push. The next tick
finds unfinished work, **resets `idle-ticks` to 0**, and carries straight on.
The cool-off exists precisely for this.

**After it has disarmed.** The alarms are gone, so this costs a fresh arming and
twelve approvals. Nothing else is lost — the queue, plans, logs and state files
are all still in the branch, so a new conveyor picks up exactly where the old
one stopped.

### The two ways to add

**Tell the session** — the normal path. "Add a plan to the conveyor that does X,
Y, Z." It writes the plan file, appends it to `QUEUE.md`, and pushes. Do this
even when the conveyor is mid-run; the session is not the thing doing the work.

**Edit the files yourself** — from anywhere with a clone:

    git fetch origin <branch> && git checkout <branch>
    # write conveyor/plans/<name>.md with "- [ ] " steps
    # add a line for it to conveyor/QUEUE.md, in priority order
    git add -A && git commit -m "conveyor: queue <name>" && git push origin <branch>

Two rules when hand-editing:

- **Never edit a plan file that a worker might be holding.** Adding a *new* plan
  is always safe. Editing the steps of the plan currently being worked risks a
  push race with the worker, and `git pull --rebase` on a checkbox line is
  exactly where a conflict costs you a completed step. Queue a new plan instead.
- **Push it.** A plan sitting uncommitted on a laptop is invisible to the
  conveyor. Git is the entire communication channel.

---

## 3. Arm the alarms

Twelve alarms, one per five-minute offset. **This is the only way to get a
five-minute cadence** — the server rejects any cron that fires more often than
hourly, both `*/5 * * * *` and an explicit minute list. Both were tried on
2026-08-15 and both were refused with `cron interval too short`.

For each of the twelve minutes `0 5 10 15 20 25 30 35 40 45 50 55`, call
`create_trigger` with:

    name:                  "conveyor-<project>-<MM>"
    cron_expression:       "<MM> * * * *"
    persistent_session_id: "<the owner session's id>"
    prompt:                the full text of templates/DISPATCHER-PROMPT.txt,
                           with its placeholders filled in

Notes that matter:

- Use explicit minutes. Do **not** use `0 * * * *` for the top of the hour — the
  server anchors minute-0 schedules to the creation minute, so you will not get
  the offset you asked for. Every other minute value is stored verbatim.
- Bind to the **owner session** (`persistent_session_id`). Do **not** use
  `create_new_session_on_fire`: `create_trigger` cannot attach a repo, so a fresh
  session wakes with nothing, calls `add_repo`, and hangs forever on an approval
  nobody sees. This was the cause of a whole day of silent failures.
- Record all twelve ids in `conveyor/ARMED.md` and commit it. That file is not
  bookkeeping — the dispatcher reads it every tick to decide when to shut itself
  off, and it is the only written record of what is armed.
- **Fill in the settings block in `ARMED.md`**: `stall-hours` (default 3),
  `linger-ticks` (default 6, ≈30 min), and `idle-ticks: 0`. That is the whole
  settings block — there is no per-step budget to guess at.
- **Register with the mail hub once** so the shutdown notice can reach the owner.
  Run script `hub-register.sh` with the conveyor's hub name (the project branch
  name, lowercased, non-alphanumerics turned to hyphens) via the deploy endpoint
  in `vps-access/MAIL-CHEATSHEET.md`. Idempotent, safe to re-run.
- Expect the human to approve twelve times. Tell them up front, in one line, so
  it does not feel like a malfunction. **Creating and deleting triggers both
  require their approval** — there is no way around it, so the value of this
  system is that approvals happen twice per project rather than continuously.

---

## 4. What a dispatcher tick does

Every alarm delivers `DISPATCHER-PROMPT.txt` into the owner session. The tick
does exactly one of four things and then stops. It never does plan work.

1. **Sync.** `git fetch origin <branch> && git checkout -B <branch> origin/<branch>`
2. **Done?** Pick the first plan in `QUEUE.md` with an unchecked step. If there is
   none, reply one line and stop.
3. **Already somebody's step?** Compare two timestamps out of git: the newest
   commit to any plan or log (T), and the last dispatch recorded in `STATE.md`
   (D). If D is newer than T, a worker already owns this step — do not dispatch,
   do not check whether it is alive, do not replace it. If it has been that way
   for `stall-hours`, disarm instead. See §4a.
4. **Just landed?** If the last commit touching the plan or log is under 2 minutes
   old, reply one line and stop. This is only a race absorber for the gap between
   a worker pushing and its status flipping — keep it short or it eats your cadence.
5. **Otherwise dispatch** one worker, record it, push.

## 4a. Two timestamps, no liveness check

The tick has to answer one question — *is this step already somebody's?* — and
it answers it entirely from git:

- **T** = newest commit touching any plan or log
- **D** = last recorded dispatch in `STATE.md`

`D` newer than `T` means a worker was sent after the last thing landed, so the
step is taken. `T` newer than `D` means work landed and the next step is free.
That is the whole rule.

**No worker is ever replaced.** Exactly one is dispatched per step. If it
delivers, the chain moves on. If it goes quiet for `stall-hours`, the conveyor
stops and emails the owner, leaving everything exactly where it stopped.

### Why the liveness check was removed

An earlier version asked `get_session` whether the worker was alive and
dispatched a replacement if it looked dead. That is guesswork, and being wrong
means two sessions on the same step: both writing the same files, racing pushes,
fighting over the same checkbox. On a real build that is far worse than waiting.

The status fields cannot carry that weight anyway. Both were observed wrong, in
opposite directions, in a single evening:

- a worker actively mid-task reported `IDLE` / `REVIEW_READY`
- a worker that had finished correctly and pushed reported `BLOCKED` /
  `need_input`

And the failure it was insuring against has never once been observed: across
every worker dispatched with a repo attached and a terminal prompt, none died
silently. It was recovery machinery for a hypothetical, with a real blast radius.

**Never add a liveness check back in. Waiting is cheap; trampling is not.**

### Clean failures still retry immediately

This does not mean one shot per step. The worker prompt tells a worker that
cannot finish to append `[worker failed at <ts>: <reason>]` to its log and stop.
That is a commit, so T moves, and the very next tick dispatches a fresh worker
at the same step. Only a *silent* death — no commit at all — triggers the wait.

A refused dispatch is likewise not a dispatch: `STATE.md` records it in a form
that does not end in "dispatched", so the next tick retries it.

---

### The dispatch call — exact form

Call `create_session` with **these four arguments and nothing else**:

    title:           "<project> worker — <step name>"
    source_url:      "https://github.com/tbuitendyk/CLAUDE-PROJECTS"
    source_revision: "<the project branch>"
    prompt:          the entire verbatim contents of conveyor/WORKER-PROMPT.txt

**Do not add any other argument.** Not `extra_allowed_tools`, not
`permission_mode`, not `tags`, not `connectors`. Adding arguments to improve the
odds is what destroys them: plain calls succeeded 4 of 5 times, calls that asked
to hand permissions to the new session succeeded 2 of 17.

`source_url` and `source_revision` are mandatory. A worker without a repo hangs.

If the call is refused, `sleep 20` and repeat the **identical** call, up to three
attempts. Do not reword, retitle, or vary it between attempts — you are riding
out an intermittent gate, and varying the call to slip past it is both
ineffective and the wrong thing to do.

If all three attempts fail, write the refusal into `STATE.md`, commit, push, and
reply plainly that dispatch was refused. The next tick will try again in five
minutes. Do not attempt the step yourself.

### Recording a dispatch

Append to `STATE.md` a line that **begins with a 4-digit year**:

    2026-08-15T21:42:55Z | session session_01ABC… | plan <name> | step <N> | dispatched

Then commit `"conveyor: dispatch <plan> step <N>"`, push, and mirror if the
project mirrors. When reading this file back, match `^20[0-9][0-9]-` — never a
loose substring, or the format example in the file header matches and you will
think a worker exists that does not.

---

## 5. Rules for the worker prompt

The worker prompt is the highest-leverage text in the system. Every rule below
was paid for.

- **Terminal, never self-replicating.** It must tell the worker to do one step
  and stop, and to spawn nothing. A worker prompt that instructs the worker to
  start a successor gets refused about 95% of the time.
- **Tell it nobody is watching.** Say it plainly: no human, no approval coming,
  never end the turn with work half-done. Otherwise it politely waits for someone
  who will never arrive.
- **Tell it to read its predecessor's published results** out of the log and
  build on the actual numbers, and not to invent values it cannot find.
- **Tell it to find the first unchecked step and do only that one.**
- **Tell it how to push:** commit, push, and on rejection
  `git pull --rebase origin <branch>` then push again. **Never force-push.**
- **Tell it how to find the spawn tool it must NOT use** — this sounds odd but
  saves confusion: spawned sessions see MCP tools under a long UUID-ish prefix,
  already loaded, and `ToolSearch` cannot see them and will falsely report they
  do not exist.
- **Give it a failure path:** if it cannot do its step, append
  `[worker failed at <ts>: <reason>]` to the log, commit, push, and stop. A
  recorded failure lets the next tick move on. A silent one stalls the conveyor.

---

## 6. Shutting down — the conveyor disarms itself

The dispatcher created the alarms and can delete them, so **teardown is not
something the human has to remember.** Every tick checks two shutdown conditions
before it does anything else.

**Stalled.** If nothing has been committed to any queued plan or log for
`stall-hours` (default 3), there are still unfinished steps, and no worker is
alive, the conveyor is wedged and the next tick disarms it.

This is a **stall** timeout, not a wall-clock deadline — a deliberate choice. A
conveyor that keeps making progress runs as long as the work takes: all day,
overnight, however long the project needs. **Progress is the licence to keep
running; only silence ends it.** That way a legitimately long build is never
killed for being long, while a wedged one cannot tick forever.

**Queue complete plus cool-off.** When nothing in the queue has unfinished
steps, the tick increments `idle-ticks:`. Once that reaches `linger-ticks:`
(default 6, about 30 minutes), it disarms. Any tick that finds new work resets
the counter to 0 — see §2a, that window is the whole point.

The disarm procedure itself:

1. **Notify the owner first, before touching anything.** Push notification plus
   email through the mail hub. See below for why this comes first.
2. Delete every trigger id in `ARMED.md`, **including the alarm that fired the
   current tick** — its message has already been delivered, so deleting its
   source is safe.
3. If a delete fails or cannot complete, keep going with the rest. Then **name
   the survivors explicitly in the reply.** A half-disarmed conveyor that reports
   success is worse than one that never tried.
4. Confirm with `list_triggers` that no alarm for this project remains.
5. Optionally archive the worker sessions listed in `STATE.md`.
6. Move the `ARMED.md` rows into its History section with the timestamp and
   reason, reset `idle-ticks:`, commit, push.

### Why notification is a required step, not a courtesy

**Deleting a trigger requires the owner's approval, and at shutdown time the
owner is by definition not watching** — that is the entire purpose of this
system. So the twelve deletions will usually sit pending until they next open a
client. The conveyor cannot finish its own teardown unaided.

That makes the notification the step that actually causes shutdown to happen.
Send it **before** starting the deletes, so the alert is already waiting when the
approvals appear. Send both channels: a push notification, and an email through
the established mail hub (`vps-access/MAIL-CHEATSHEET.md` — repo-first outbox
plus the deploy endpoint; do not reach for a Gmail or other connector). Exact
steps are in `templates/DISPATCHER-PROMPT.txt`.

If notification fails, still do the deletes, and say so plainly in the reply.
Never let a failed notification stop a teardown.

To stop early at any point, the human says "tear down the conveyor" and you run
the same procedure immediately.

---

## 7. Things that do not work — never build these

| Approach | Outcome |
|---|---|
| Timers inside the session (`/loop`, in-session cron) | Live in a process that dies in minutes. 0 fires out of 21. |
| A background daemon in the container | Dies with the VM every time. |
| Worker starts the next worker | Refused. 0 of 6 on a real relay prompt. |
| Worker rings a bell to wake the owner | Bell rings, wake never usefully lands; also needs a permission grant, which is itself a refusal trigger. |
| Allow-rules in `.claude/settings.local.json` | Gitignored globally. Never reaches a worker. |
| A session granting itself permissions | Refused. Only the human can widen permissions. |
