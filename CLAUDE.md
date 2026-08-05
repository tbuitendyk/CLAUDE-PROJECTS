# CLAUDE.md — `winserv-2k8-r2-std-perfmon` branch

Project lives under `winserv-2k8-r2-std-perfmon/`. Infra/deploy tooling + full security model are on the `vps-access` branch.

## Target environment

Windows Server 2008 R2 Standard (SP1, x64 only — NT 6.1). This is an old OS:
modern toolchains have dropped it (e.g. Go ≥ 1.21 requires Windows 10 / Server
2016), so anything built here must be checked against what actually runs on
NT 6.1 before assuming it works.

## Working style (all sessions)

Confirm the task before building. **Don't assume a direction, write a pile of
code, and burn tokens producing the wrong thing.** When anything is ambiguous or
a detail is unstated, ask one quick clarifying question and get clear alignment
first — then do the work.

- If the task is genuinely unambiguous, just do it — no needless confirmation friction.
- If there's a real fork or a missing detail, check in briefly before spending effort.
- Verify facts instead of guessing (e.g., check an address/mailbox/branch exists
  rather than assuming its spelling).
