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
| C | Server-side one-shot (`send_later` → trigger fires into session) | control plane | `heartbeat-oneshot.log` | **DELIVERED** 13:45 (25 min late, queued behind busy session) — arm complete |
| D | Recurring Routine (`create_trigger` cron, bound to session), hands-off | control plane | `heartbeat-routine.log` | **delivering** (`trig_01Kw5YebXXZKbXknH9NMWHb7`): first two fires arrived batched-late at 13:45; first cold-idle test 14:19Z |
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
| 20:27 | Breadcrumb ledger: worker #10 lived ~4 min (alive 19:28:37Z on `873cfc8b`, killed by swap; engine at 20:27 reads `f83b4faf`). Shortest lifespan yet. A~s attempt-9 wakeup (due 20:25Z) not arrived — kill #8 pending confirmation. Worker #11 hired. |
| 18:05 | **PR #1 created via the Claude client's Create PR button and merged by owner** into `sandbox` (merge commit `cf0ac70`; base was auto-targeted correctly at the fork-source branch). Ongoing dual-branch sync now authorized and live: session branch and `sandbox` unified at the merge commit; arm B's script now pushes both branches (SYNC_BRANCH); watchdog and loop prompts to dual-push at each re-arm. |
| 17:50 | **New variable identified by owner**: an open Claude client (even with another session focused) surfaces notifications and may accelerate fire delivery — deliveries ran 15-30 min late with client open vs 96+ min stalls when fully away. Isolation test planned: ~06:00Z owner shuts down all clients for 6+ h; fires in that phase test pure server-side delivery with zero client presence anywhere. |
| 17:07 | **HANDS-OFF OBSERVATION WINDOW BEGINS** (owner away until evening; no human input expected). States at window start: A's 16:58Z attempt-7 lost (**kill #6**, tick 6 now 70 min old — next alarm fire will revive it); B found dead a 5th time (8th identity change, `a6a6862b` → `2b474b3f`), restarted (pid 2568); D is the sole sustaining mechanism — hourly fires at :19 UTC, delivery lateness 0–96+ min observed. Success criterion for the window: heartbeat commits continue appearing with zero human involvement; every gap and revival self-documents. |
| 16:48 | **First autonomous cold-idle delivery — partial revision of the 15:55 finding.** The 16:19Z fire arrived at 16:48Z (29 min late) into a session idle for 49 min, with no human involvement — session-bound fires CAN wake an idle session, but latency is high and inconsistent (the 14:19/15:19 fires never self-delivered in 96+ min and needed a user poke). 7th machine-identity change (`298674f4` → `a6a6862b`); B's 4th silent death (restarted, pid 2568, tick 6 `50851ab`); routine tick 4 (`35aeb61`). A healthy at 52 min — no revival needed; A's 16:58Z attempt-7 verdict pending. |
| 15:55 | **Cold-idle revival test: FAILED — and first watchdog revival executed.** Session idle 13:52→15:55. D's fires due 14:19Z and 15:19Z did not wake it; one fire flushed at 15:55 only when a user message activated the session (same queue-flush pattern as 13:45; the second slot coalesced or is still queued). Meanwhile: arm A's 14:45Z wakeup lost (**kill #5**), 6th machine-identity change (`8184e4ff` → `298674f4`), B's 3rd silent death (restarted, pid 2572, its tick 5 `44e79aa`). Watchdog duty triggered for the first time: A revived via tick 6 (`de7ca76`), routine tick 2 recorded (`0441b14`). **Architectural implication:** a session-bound Routine inherits the session's revival problem — fires queue behind an idle session rather than provisioning it. The true "never stops" layers are fresh-session-per-fire Routines (arm F) or an external scheduler (arm E). |
| 13:45 | **CORRECTION + first autonomous wake-up of the experiment.** The three "missed" server-side fires (D@12:19, D@13:19, C@13:20) were **queued, not dropped**: all three flushed into the session as one batch the instant the previous turn ended (13:45:04 turn end → fires arrived immediately after). Server-side delivery defers while a session is busy and delivers on idle. Fire C landed 25 min late (`9dcaf54`); D's two fires recorded as routine tick 1 (`5d7ee1c`). Also: **fifth machine-identity change happened mid-conversation** (`ff6de0f7` → `8184e4ff` between consecutive commands at 13:36→13:45), killing B's daemon 9 min after restart (restarted again, pid 2985, tick 4 `575bc71`). The predicted two-writers push collision occurred and resolved loudly and safely. True cold-idle revival test: D's next fire at 14:19 with the session untouched. |
| 12:19–13:36 | *(superseded by the 13:45 correction)* Server-side layer appeared to miss its first three deliveries. D's hourly fires due 12:19Z and 13:19Z and C's one-shot due 13:20Z: none arrived (verified 13:36Z — no turns, no commits). Arm A's 12:22Z wakeup also lost (**kill #4**, 0/5). Session revived only by user messages (~12:36, ~13:36). Fourth machine-identity change (`32501ee3` → `ff6de0f7`). B daemon dead again; restarted 13:36 (pid 2221). The MCP link to the scheduling service also repeatedly disconnected from this container during the window, blocking server-side status checks. Open questions: are trigger fires dropped or just late? does delivery skip a session that appears busy (interrupted turns)? Next observable: D's 14:19Z fire. |
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
