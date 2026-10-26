# CLAUDE.md — `atas-indicators/` (ATAS 8 custom indicators)

Custom indicators for the ATAS trading platform (classic ATAS 8, Windows), built with
Visual Studio 2026 / .NET 10. Build, load and debug steps: `README.md`. This project has no
VPS deploy: the owner builds it on their own Windows machine, where ATAS is installed.

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
  do it" and then not doing it is disobedience, not an accident of
  architecture. Never claim a future behavior unless the mechanism that
  guarantees it is verifiably in place (armed wakeup, cron entry, committed
  hook); otherwise state plainly what is NOT guaranteed. Deliver more than was
  promised, never less.

**Harness-backed persistence rule (owner directive, 2026-08-12).** A promise
to "keep working" is not a schedule: when a turn ends, the session stops
existing until something re-invokes it, and intentions held in context do not
survive that. Therefore: whenever the owner asks for ongoing, overnight,
multi-hour, or run-to-completion work, arm a HARNESS-BACKED loop in that same
turn — /loop (ScheduleWakeup or CronCreate) — and end EVERY subsequent turn by
re-arming the next wakeup until the work is genuinely done. Never accept such
a task with only a verbal commitment; if the loop is not armed, say so instead
of promising. (Background: the 2026-08-11 overnight classifier project died by
sleep despite full advance permissions — the mechanism was missing, not the
authorization.)

**This applies on every branch, and new ones inherit it.** Every project
branch's root `CLAUDE.md` carries this same "Working style" section. When
creating a new branch/project (branches are created from here, the control
plane), seed its `CLAUDE.md` with this header so the behavior carries forward.

## Settled facts (verified 2026-10-26, do not re-litigate)

- **Target `net10.0-windows`.** ATAS 8 runs on .NET 10. Source: docs.atas.net BasicIndicator page
  and ATAS's own sample project. The platform version number does not indicate the runtime: the
  authority is `tfm` in `OFT.Platform.runtimeconfig.json` in the install folder.
- **Install folder** `C:\Program Files (x86)\ATAS Platform`. Reference `ATAS.Indicators.dll`
  (required), plus `ATAS.DataFeedsCore`, `OFT.Attributes`, `OFT.Rendering`, `Utils.Common`, all
  with `Private=false`.
- **Load folder** `%AppData%\ATAS\Indicators` (NOT Documents). The build copies there. A running ATAS
  shows a status-bar reload button and loads changed DLLs without a restart.
- **The API reference is ATAS's open-source indicators repo**, github.com/AtasPlatform/Indicators:
  read a real indicator there before guessing at an API. `CrossColor` in that repo is a global
  alias: `System.Windows.Media.Color` on classic ATAS.
- **Cloud sessions cannot build against the real ATAS DLLs**, which exist only on the owner's
  machine. Compile-check against a stub of the API with the .NET 10 SDK, and say plainly that
  this is not a run inside ATAS.
