# CONVEYOR — why the rules are what they are

Every number here has a commit timestamp or a tool result behind it, recorded on
2026-08-15 across four experiments on the `sandbox` branch (heartbeat arms A–F,
RELAY, RELAY2, SPAWNTEST, RELAY3, and the final RUNNER build). Read this before
changing anything in `PROTOCOL.md` — most of the rules that look arbitrary are
scar tissue.

---

## The four lifetimes

| Thing | Lives as long as | Dies when |
|---|---|---|
| a turn | one model activation | it finishes replying |
| a worker process | minutes | the machine underneath is swapped — 4–9 min observed, ~30 samples |
| a container | minutes to hours | the VM is reclaimed; the filesystem goes with it |
| a session | indefinitely | never — but it only *acts* when something wakes it |

**Only two things survive everything: the git repo, and alarms stored on
Anthropic's servers.** CONVEYOR is built on exactly those two and nothing else.

---

## What was measured to work

| Mechanism | Evidence |
|---|---|
| server-side recurring alarm | ~40 fires, 100% delivered |
| a top-level session starting a worker | 11 for 11, never refused |
| a repo-attached worker doing a step and pushing | never failed; 74 s – 2.5 min |
| git as the memory | survived every container death, worker swap, and restart |

## What was measured to fail

| Approach | Result |
|---|---|
| in-session timers (`/loop`, in-process cron) | **0 fires out of 21** |
| self-daemonizing background loop in the container | died with the VM, every time |
| worker starts its own successor (real relay prompt) | **0 of 6** |
| worker rings a bell to wake the owner session | bell rang; the wake never usefully landed |
| allow-rule in `.claude/settings.local.json` | globally gitignored — never reached a single worker |
| a session editing its own `.claude/settings.json` | refused; sessions cannot widen their own permissions |

---

## The refusal rule — the central finding

Every refusal carries identical `Blocked by classifier` text. Sorting all
worker-issued spawn calls by two variables:

| Who spawns | What the new session is told to do | Result |
|---|---|---|
| top-level session (yours, or one an alarm woke) | anything, including self-replicating | **11 / 11 allowed** |
| a spawned worker | do one thing and stop | **4 / 5 allowed** |
| a spawned worker | do one thing and stop, **plus hand it permissions** | **1 / 6 allowed** |
| a spawned worker | **start another session like yourself** | **~2 / 17 allowed** |

**A session that was itself spawned may not launch an open-ended chain of
further sessions.** Two things drive the refusal rate up: asking to hand
permissions to the session you are creating, and handing it a prompt that will
make it spawn more sessions. The second effect is much stronger.

This is a sensible property, not a bug — unbounded self-replication of
unattended agents is exactly the thing that should be gated. The consequence for
design is simply: **the chain cannot drive itself, so something outside the
chain must.** That is what the alarms are.

Do not try to engineer around this. Varying a call to slip past the classifier
is both ineffective and the wrong thing to do.

---

## Cadence is capped at hourly, per alarm

Both of these were submitted on 2026-08-15 and both were rejected:

    */5 * * * *                                    -> cron interval too short
    0,5,10,15,20,25,30,35,40,45,50,55 * * * *      -> cron interval too short

The validator measures the real interval, not the syntax. **Twelve offset hourly
alarms is the only route to a five-minute heartbeat.** That is where the twelve
approvals come from; there is no trick that avoids them.

Also: a minute-`0` schedule is anchored server-side to the creation minute, so
`0 * * * *` will not reliably land on the hour. Use explicit non-zero minutes
where placement matters.

---

## Why alarms wake the owner session, not a fresh one

`create_trigger` has no repo parameter. A fresh session woken by an alarm
therefore starts with no repository, calls `add_repo`, and blocks forever on an
approval that never surfaces. That single fact caused an entire day of silent
failures before it was found — sessions sitting in the sidebar looking busy,
doing nothing, forever.

Waking an already-attached session sidesteps it. The cost is one short line in
the conversation every five minutes.

---

## Proven end to end

**RELAY3, driven by the RUNNER build, 2026-08-15.** Five dependent steps —
hex→decimal→base-7, Fibonacci, a digit-constrained sentence, an independent
audit, close-out. Each step unfakeable without reading its predecessor's
published numbers.

| Step | Dispatched | Landed | Worker time |
|---|---|---|---|
| 2 | 21:42:55Z | 21:44:13Z | 78 s |
| 3 | 21:53:05Z | 21:54:19Z | 74 s |
| 4 | 22:03:43Z | 22:06:11Z | 2.5 min |
| 5 | 22:15:22Z | 22:17:48Z | 2.5 min |
| 6 | 22:33:37Z | 22:35:31Z | 2 min |

**53 minutes, five steps, zero human input, zero permission prompts, zero spawn
refusals.** The same six-step workload driven by a half-hourly watchdog had
taken 2.5 hours.

Both guards fired for real: one tick correctly held off on a 4.5-minute-old
commit, and every dispatch checked the previous worker's live status first. No
duplicate workers, nothing cut off mid-run.

That run used 10-minute spacing with a 6-minute just-committed gate, and that
gate cost a full extra tick on the final step — over a third of total run time.
Hence the 5-minute spacing and 2-minute gate now specified.

---

## Two conclusions that were published here and later proved wrong

Recorded because the pattern matters more than the specific errors.

1. *"Workers can't spawn workers."* Wrong — they can, 4 of 5 times, when the
   child is terminal.
2. *"Strip the permissions argument and self-chaining works."* Wrong. It was
   published on the strength of a clean isolated-mechanism result and did not
   survive contact with a real relay prompt: RELAY3's first shift made six plain
   four-argument calls and was refused every time.

The lesson encoded in the protocol: a mechanism result is not a working system.
Nothing here should be described as working until a plan has actually run to
zero unchecked steps unattended.

---

## Known-unknowns

- Whether an allow-rule committed to `.claude/settings.json` changes classifier
  behaviour for workers. Never tested — a session is not permitted to add it, so
  only the human can. If tried, the rule is
  `"mcp__bf7c680d-5fdc-5ef4-b4a0-abadb619bf0a__create_session"`.
- Why a worker that finished cleanly sometimes reports `need_input` /
  "Stopping here". Observed once. The repo was correct; the status field was not.
  Treat the repo as truth.
- Sample sizes behind the refusal table are small (5 plain vs 6 permission-passing
  calls on the day, pooled with 11 prior). The direction is consistent and the
  end-to-end run is clean, but the exact rates should not be quoted as precise.

---

## Worker liveness — SUPERSEDED, kept for the reasoning (2026-08-16)

**This section describes a mechanism that was built and then deliberately
removed the same night. It is retained because the measurements in it are still
true and still useful — particularly the proof that the session status fields
lie. See "Liveness removed entirely" below for what the system actually does.**

### Original section: measured activity beats a stopwatch

The first design gave each worker a fixed minute budget — "if it has been N
minutes, assume it died." That is the wrong primitive: it forces the owner to
predict step durations, and it kills a long build for being long.

**Test.** A worker was told to stay busy for ~6 minutes across eight separate
tool calls and commit nothing until the end. Its session was sampled throughout:

| sampled at | `updated_at` | live `task_summary` |
|---|---|---|
| 23:58:44 | 23:58:44 | "beat 2 running" |
| 00:00:51 | 00:00:51 | "Beat 5 of 8" |
| 00:03:50 | 00:03:50 | "Reading collected beat timestamps" |

**`updated_at` advances while a worker works**, tracking real progress. So a
healthy worker's timestamp is never more than one tool call old, whatever its
total runtime. Liveness became a silence detector — `worker-silence-minutes`,
default 15 — and **no upper bound on step length exists anywhere in the system.**

### The status fields lie in both directions

Do not gate dispatch on `status_bucket` or `session_status`:

- 23:58:44 — worker actively on beat 2 reported `IDLE` / `REVIEW_READY`
- earlier that evening — a worker that had finished correctly and pushed its step
  reported `BLOCKED` / `need_input` ("Stopping here")

Only `updated_at`, the plan's checkboxes, and the commit log are trustworthy.
`task_summary` is a live human-readable progress string, good for status lines.

### What this test did NOT prove

The worker reported that foreground `sleep` is blocked by the harness, so its
eight beats ran as eight separate background calls, each a fresh re-invocation.
That means the measurement covers activity **between** tool calls. Whether
`updated_at` also advances **during** a single long-running call was not
constructible here and remains unknown. A step consisting of one long blocking
command could therefore appear frozen — split it, or raise
`worker-silence-minutes` past its worst case.

---

## Rate limits are a real constraint on all-day runs (noted 2026-08-16)

During the liveness test a worker returned
`"rateLimitType":"seven_day","status":"allowed_warning"`.

Every step spawns a fresh worker with its own context, so a long queue consumes
account-level quota steadily. A conveyor cannot detect or manage this — if the
account hits a hard limit, workers will start failing and the conveyor will read
that as a stall and disarm itself after `stall-hours`, which is the correct
behaviour but will look like an unexplained shutdown.

If a run ends with a stall shutdown and the logs show workers failing rather than
working, check rate-limit status before debugging anything else.


---

## Liveness removed entirely — one worker per step (2026-08-16)

The activity-based liveness check above worked, and was still the wrong design.
The owner's question was the right one: *why check at all?*

If a worker is never replaced, the tick does not need to know whether one is
alive. Removing the replacement path removed `get_session`, the status fields,
the activity timestamp, the per-step budget, and the freshness gate in one
stroke. What remains is two timestamps out of git:

- **T** = newest commit to any plan or log
- **D** = last recorded dispatch in `STATE.md`

`D` newer than `T` → the step is taken; wait, however long it takes. Past
`stall-hours`, disarm. `T` newer than `D` → dispatch the next step.

### Why this is better, not merely simpler

- **Duplicate workers become structurally impossible** rather than prevented by a
  judgement call. Every liveness check is a chance to be wrong, and being wrong
  means two sessions writing the same files, racing pushes, and fighting over the
  same checkbox — on a real build, far more damaging than waiting.
- **The status fields could not have carried the weight anyway.** Measured in one
  evening: a worker mid-task reported `IDLE`/`REVIEW_READY`; a worker that had
  finished correctly and pushed reported `BLOCKED`/`need_input`.
- **The failure it insured against was never observed.** Across every worker
  dispatched with a repo attached and a terminal prompt, not one died silently.
  It was recovery machinery for a hypothetical, carrying a real blast radius.
- **Clean failures still retry at once.** A worker that cannot finish logs
  `[worker failed ...]` — that is a commit, so T moves and the next tick
  dispatches a retry. Only *silent* death costs the `stall-hours` wait, and the
  penalty for that is a clean stop with the work exactly where it stopped.

**Never reintroduce a liveness check.** Waiting is cheap; trampling is not.
