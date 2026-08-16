# CLAUDE.md — `sandbox` branch (throwaway experiments)

This branch is a **scratch area**: harness/loop experiments, mechanism tests,
disposable prototypes. Nothing here is production. It may be force-reset or
emptied at any time. Do not put anything here that needs to survive.

Current known use: verifying scheduling-mechanism durability (e.g. cron vs
wakeup-chain loops that commit timestamp heartbeat files) — commit timestamps
on GitHub are the independent evidence record.

## Working style (all sessions)

Confirm the task before building. **Don't assume a direction, write a pile of
code, and burn tokens producing the wrong thing.** When anything is ambiguous or
a detail is unstated, ask one quick clarifying question and get clear alignment
first — then do the work.

- If the task is genuinely unambiguous, just do it — no needless confirmation
  friction.
- If there's a real fork or a missing detail, check in briefly before spending
  effort.
- Verify facts instead of guessing (e.g., check an address/mailbox/branch
  exists rather than assuming its spelling).
- **Under-promise, over-deliver (owner directive, 2026-08-12).** Saying "I'll
  do it" and then not doing it is disobedience. Never claim a future behavior
  unless the mechanism that guarantees it is verifiably in place (armed
  wakeup, cron entry, committed hook); otherwise state plainly what is NOT
  guaranteed. Deliver more than was promised, never less.

**Harness-backed persistence rule (owner directive, 2026-08-12).** A promise
to "keep working" is not a schedule: when a turn ends, the session stops
existing until something re-invokes it. For ongoing / run-to-completion work,
arm a harness-backed loop (/loop with NO interval token -> ScheduleWakeup) in
the same turn, and end every turn by re-arming the next wakeup until done.
Note for cloud sessions: CronCreate jobs are in-process memory and do NOT
survive worker recycling — use the wakeup chain.

## Default output style: ELI5 (owner directive, 2026-08-16)

Apply the rules in `.claude/skills/eli5/SKILL.md` to **every** response in
this repo, not just when the user types "eli5" — it is the default voice for
this branch, not an opt-in trigger.

- One-line plain-English answer first.
- Ground it in a concrete, correctly-mapped analogy (2-4 sentences).
- Tie the analogy back to the real thing explicitly.
- No unexplained jargon; short sentences; cut caveats/edge-cases unless asked.
- Go deeper only if the user follows up asking for the "real" version.

This governs prose explanations. It does not change code itself (no
dumbing-down of code, comments, or commit messages) and does not override the
terse tool-call/status-update conventions from the system prompt — those stay
as-is. When ELI5 phrasing and a direct answer would conflict (e.g. "yes/no"
questions, quick confirmations), still lead with the direct answer, then add
the analogy if it adds value.
