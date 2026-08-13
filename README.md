# Scheduling-Mechanism Durability — Experiment Record

**Branch:** `claude/sandbox-fd3rem` (throwaway sandbox — see `CLAUDE.md`)
**Question under test:** what does it actually take to make a recurring agent loop
in a Claude Code cloud session *never stop*?
**Method:** competing heartbeat loops, one per scheduling mechanism, each appending
a timestamped tick line to its own log file and pushing a commit. GitHub commit
timestamps are the independent, tamper-proof evidence record. A mechanism's death
is visible as a gap or permanent silence in its file's commit history.

Session: `session_01XgtdraagzH1VbjJ1KUHk3w` · Experiment night: 2026-08-13 (UTC)

## The four lifetimes

Everything below is explained by four nested lifetimes, each dying independently:

1. **Turn** — one model activation (message in → tools → final text). Work happens
   *only* inside turns. Between turns no computation exists.
2. **Worker process** — the harness process that executes turns and holds
   in-memory schedules (CronCreate jobs, pending ScheduleWakeup wakeups).
   Observed tonight to recycle every ~10–20 minutes (correlates with MCP server
   disconnect/reconnect bursts in the session).
3. **Container / VM** — the filesystem (fresh clone at provisioning) plus any OS
   processes started in it. Survives worker recycles; reclaimed after inactivity.
4. **Session** — the conversation transcript (server-side) plus whatever was
   pushed to GitHub. Survives all of the above; any new message resumes from it.

**Core finding:** a promise ("I'll keep working") lives in lifetime 0 — nothing.
In-session schedulers live in lifetime 2 and die in minutes. Durable loops must be
driven from outside (control plane or external infrastructure), with state
externalized to lifetime 4.

## Test arms

| Arm | Mechanism | Lives in | Evidence file | Status |
|---|---|---|---|---|
| A | ScheduleWakeup chain (`/loop` dynamic mode) | worker memory | `heartbeat-wakeup.log` | running under D supervision; **3 kills, 0/4 autonomous ticks** |
| B | In-container daemon (`heartbeat-cron.sh`, setsid loop — container has no cron binary) | container process | `heartbeat-cron.log` | **died silently in first idle hour**; restarted 11:16 under D supervision |
| C | Server-side one-shot (`send_later` → trigger fires into session) | control plane | `heartbeat-oneshot.log` | **armed** (`trig_011MHsneUo9gKUAyu53UY52E`), fires 13:20Z |
| D | Recurring Routine (`create_trigger` cron, bound to session), hands-off | control plane | `heartbeat-routine.log` | **active hourly at :19** (`trig_01Kw5YebXXZKbXknH9NMWHb7`), first fire 12:19Z |
| E | External scheduler (GitHub Actions cron → `claude -p "…" --cloud <session-id>`) | owner infrastructure | tick annotation | planned |
| F | Fresh-session Routine + repo-state resumption (no session persistence at all) | control plane + repo | separate plan file | planned (production pattern) |

## Findings log (all times UTC, 2026-08-13)

| Time | Event |
|---|---|
| 01:03 | Branch created (`865f254`). |
| 01:18 | **Tick 1** pushed (`5abd52b`); wakeup armed for 02:19. |
| 01:25 | Pending wakeup visible in-process: CronList shows one-shot entry `0aff7759` `[session-only]`. |
| 01:40 | Entry **gone** from CronList after MCP disconnect/reconnect burst (worker recycle fingerprint). Survival ≤ 21 min. |
| 02:19 | **No fire. Kill #1 confirmed.** |
| 02:55 | **Tick 2** pushed late with outage annotation (`69a2055`); wakeup re-armed 02:56 for 03:57. |
| 03:07 | CronList empty again — survival ≤ 11 min. |
| 03:57 | **No fire. Kill #2 confirmed.** |
| 04:12 | **Tick 3** pushed late (`35f63f3`); container fingerprint instrumentation added to tick lines (`[container:<boot-id-8>]`, first value `52f537e3`); wakeup re-armed 04:13 for 05:13. |
| 04:29 | CronList empty again — survival ≤ 16 min. **Kill #3 likely; verdict 05:13.** |
| 05:10 | **Arm B started**: script committed (`f95a36e`), daemon launched (pid 2610), tick 1 pushed within 1 s (`8cbf6fe`) — git auth confirmed working from a detached process. |
| 05:10 | **Fingerprint anomaly**: boot_id changed `52f537e3` → `010a9cff` since 04:12, yet the filesystem persisted (untracked script and `.git/info/exclude` entry survived). boot_id therefore tracks the VM/kernel layer, not filesystem lifetime — a changed value is ambiguous between kernel churn and true reclaim; only a *fresh clone* (arm B files gone) proves reclaim. |
| 05:11–11:15 | **Six-hour idle gap — total silence from every arm.** Arm A tick 4 (due 05:13) never fired: **kill #3**, 0/4 autonomous ticks. Arm B's daemon died silently within its first idle hour (one tick at 05:10, then six straight missed hourly ticks; no error in its output log; all its files survived). Fingerprint changed a third time during the gap (`010a9cff` → `32501ee3`). Conclusion: **nothing running inside the machine survives idle time — processes die, only files persist; only inbound messages revive the session.** |
| 11:16 | Session revived by user message. Tick 4 outage recorded (`cfa3671`). Arm B daemon restarted (pid 2594); its tick 2 pushed (`beec902`). |
| 11:19 | **Arms C and D armed on Anthropic's servers.** C: one-shot `trig_011MHsneUo9gKUAyu53UY52E`, fires 13:20Z. D: hourly routine `trig_01Kw5YebXXZKbXknH9NMWHb7` (`19 * * * *`), first fire 12:19Z, bound to this session; duties = own tick to `heartbeat-routine.log` + revive arm A if stale >75 min + restart arm B if dead. Caveat to verify at first fire: routine-started turns may lack some in-session scheduling tools; the hourly cadence alone still sustains all arms. |

Autonomous ticks delivered by arm A so far: **0 of 3**. Every heartbeat commit was
triggered by a human message reviving the session.

## Interpretation so far

- Pending ScheduleWakeup wakeups and CronCreate jobs are **worker-process memory**
  in this environment. Worker recycles (frequent, minutes-scale tonight) silently
  destroy them. A self-re-arming wakeup chain is therefore a daemon without a
  supervisor: any single lost link ends the loop forever, unnotified.
- The session itself is durable: user messages revived it through every recycle.
  The asymmetry (in-worker schedules die in minutes; inbound messages always land)
  means durability is a property of the **re-invocation path**, not the agent.
- Fix architecture = supervisor pattern: fine-grained in-session pacing (arm A)
  supervised by control-plane schedules (arms C/D) and/or external cron (arm E),
  with all progress state externalized to the repo (arm F) so any wake — even a
  fresh container — resumes losslessly. Autonomous wakes must also have their
  tool permissions pre-granted, or they stall on approval prompts.

## Reading the evidence

- Tick line format: `tick <n>: <ISO-8601 UTC> [container:<boot-id-8>]`, plus
  parenthetical annotations for late/restarted ticks and their cause.
- Timeline across all arms: `git log --format='%ci %s' -- heartbeat-*.log`
- A changed `[container:…]` value between ticks = container reclaim/re-provision
  happened in the gap; same value = worker-only churn.

## Next steps

1. **Observe hands-off**: D's first fire 12:19Z, C's fire 13:20Z, then hourly D
   fires. Success = commits appearing on this branch with no human involvement.
   Watch for: fire regularity, revival of A/B by the watchdog, fingerprint
   changes across fires, and whether routine-started turns have full tooling.
2. **Arm E** (owner infra, later): GitHub Actions cron →
   `claude -p "…" --cloud <session-id>` — supervision no Anthropic-side churn
   can touch.
3. **Arm F** (production pattern, later): Routine spawning fresh sessions that
   resume purely from repo state — continuity with zero session persistence.
