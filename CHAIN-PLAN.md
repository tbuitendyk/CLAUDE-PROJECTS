# CHAIN-PLAN — fresh-session relay experiment (arm F, chained one-shots)

**What this is:** each work step is done by a brand-new session ("shift") started by a
one-shot server-side trigger. The shift reads this file, does the first unchecked
step, logs BOTH sides of its conversation into `TRANSCRIPT.md`, pushes, and arms
the next one-shot trigger (~2 min out). A half-hour watchdog (two offset hourly
triggers firing into the owner's main sandbox session) rescues the chain if a
link fails to arm. Continuity lives entirely in this repo — no shift remembers
anything.

**Branch:** work on `claude/sandbox-fd3rem`, mirror every push to `sandbox`.
**Do not touch** `heartbeat-*` files or `README.md` — those belong to a finished, unrelated test.

## Steps (tick exactly one per shift)

- [ ] Step 1 — Haiku seed: write an original haiku about relay races. Compute its
  SHA-256: `printf '%s' "<haiku text>" | sha256sum`. Record haiku + full hash in your transcript entry.
- [ ] Step 2 — Primes: find the five smallest prime numbers greater than 1000,
  verify primality with a quick script, compute their product. Record list + product.
- [ ] Step 3 — Hash arithmetic: take the FIRST 8 hex characters of Step 1's hash
  (from the transcript), convert to decimal, multiply by the number of vowels in
  Step 1's haiku. Record all three values.
- [ ] Step 4 — Weave: write one paragraph (3–5 sentences) connecting the haiku,
  the prime product, and Step 3's number as if they were clues in a tiny mystery.
  Count its words. Record paragraph + word count.
- [ ] Step 5 — FINAL: verify steps 1–4 are ticked and their results present in
  `TRANSCRIPT.md`. Append the banner line:
  `=== CHAIN COMPLETE — all steps done at <UTC timestamp> ===`
  Push + mirror. **Arm nothing.**

## SHIFT PROMPT (canonical template — used verbatim for every link, replace <N>)

CHAIN SHIFT <N> — relay experiment, repo tbuitendyk/CLAUDE-PROJECTS. You are a fresh session; your entire context is this prompt plus the repo. Times in UTC. Do exactly: (1) cd /home/user/CLAUDE-PROJECTS (or the repo checkout); git fetch origin claude/sandbox-fd3rem; git checkout -B claude/sandbox-fd3rem origin/claude/sandbox-fd3rem. (2) Read CHAIN-PLAN.md. Identify the first unchecked step. (3) Do that step exactly as written. (4) Append to TRANSCRIPT.md: a heading `## Shift <N> — <UTC timestamp> [container:<first 8 chars of /proc/sys/kernel/random/boot_id>]`, then a `**Prompt received:**` block containing THIS ENTIRE PROMPT verbatim, then a `**Response:**` block containing your complete working narrative and results (show the actual commands/outputs for computations). (5) Tick the step's checkbox in CHAIN-PLAN.md. (6) Commit everything as "chain shift <N>: <step name>"; push with `git push -u origin claude/sandbox-fd3rem`; mirror with `git push origin HEAD:sandbox`. (7) IF unchecked steps remain: arm the next link — use the Claude_Code_Remote MCP tool `create_trigger` (load via ToolSearch "select:mcp__Claude_Code_Remote__create_trigger" if needed; it waits for connecting servers) with: name `chain-link-<N+1>`, `create_new_session_on_fire` true, `cron_expression` pinned to a UTC time 2–3 minutes from now in the form `M H 14 8 *` (minute hour day month), and `prompt` = this same canonical SHIFT PROMPT from CHAIN-PLAN.md with <N> replaced by <N+1>. Then, if the tool allows, delete the spent trigger named `chain-link-<N>` via `delete_trigger` (find its trig_ id via `list_triggers`); non-fatal if unavailable. IF the arming tool is unavailable or errors: append `[shift <N>: ARMING FAILED — <reason>]` to TRANSCRIPT.md, commit "chain shift <N>: arming failed", push + mirror — the watchdog will rescue the chain within ~30 min. (8) IF you just completed Step 5: follow Step 5's banner instructions and arm nothing. Keep chat text to one or two lines; TRANSCRIPT.md is the deliverable.

## State notes (shifts append nothing here; watchdog may)
