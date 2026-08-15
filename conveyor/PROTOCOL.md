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
idles harmlessly. Add a new plan to the queue at any time — the next tick picks
it up. You do not need to re-arm anything.

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
- Record all twelve ids in `conveyor/ARMED.md` and commit it. Without that list
  the human cannot find them to shut them off.
- Expect the human to approve twelve times. Tell them up front, in one line, so
  it does not feel like a malfunction.

---

## 4. What a dispatcher tick does

Every alarm delivers `DISPATCHER-PROMPT.txt` into the owner session. The tick
does exactly one of four things and then stops. It never does plan work.

1. **Sync.** `git fetch origin <branch> && git checkout -B <branch> origin/<branch>`
2. **Done?** Pick the first plan in `QUEUE.md` with an unchecked step. If there is
   none, reply one line and stop.
3. **Busy?** Read the last dispatch line of `STATE.md`, take its session id, call
   `get_session` on it. If `status_bucket` is `SESSION_STATUS_BUCKET_WORKING` and
   it was dispatched under 10 minutes ago, a worker is in flight — reply one line
   and stop. **Never start a worker on top of a running one.**
4. **Just landed?** If the last commit touching the plan or log is under 2 minutes
   old, reply one line and stop. This is only a race absorber for the gap between
   a worker pushing and its status flipping — keep it short or it eats your cadence.
5. **Otherwise dispatch** one worker, record it, push.

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

## 6. Tearing down

When the queue is finished, or the human says stop:

1. Delete all twelve alarms by the ids in `ARMED.md`. Twelve approvals, once.
2. Archive the worker sessions so they do not clutter the sidebar.
3. Clear `ARMED.md`.

Alarms do not stop themselves. An idle conveyor keeps ticking forever, one line
every five minutes, until somebody deletes it.

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
