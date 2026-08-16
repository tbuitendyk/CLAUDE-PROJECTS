# The permission fix — why nothing worked, and the exact setting

Found 2026-08-16 by reading the settings schema instead of guessing at it.

## Why every previous attempt failed

`.claude/settings.json` in this repo has listed `mcp__Claude_Code_Remote__create_trigger`
and `delete_trigger` under `permissions.allow` for days. It never stopped a single
prompt.

**Because `permissions.allow` is not what auto mode reads.**

Auto mode runs its own classifier with its own separate rule sections:

    autoMode.allow        <- auto mode's allow list
    autoMode.soft_deny    <- destructive actions, clearable by user intent
    autoMode.hard_deny    <- security boundaries, NOT clearable

`permissions.allow` governs the *non-auto* permission modes. Under auto mode the
classifier decides, and it never consults `permissions.allow` at all. Every
allow-rule written into this repo was inert from the moment auto mode was
switched on.

The literal string `"$defaults"` inside an `autoMode` array inherits the built-in
rules at that position — always include it, or the built-in safety rules are
replaced rather than extended.

## A session cannot fix this for itself

Attempting to write `~/.claude/settings.json` from inside a session is refused by
the same classifier — "Blocked by classifier". That is deliberate and correct:
self-granting permissions would make the gate meaningless. **Only the owner can
apply this.**

## The exact settings

```json
{
  "permissions": {
    "allow": [
      "mcp__Claude_Code_Remote__create_session",
      "mcp__Claude_Code_Remote__create_trigger",
      "mcp__Claude_Code_Remote__delete_trigger",
      "mcp__Claude_Code_Remote__update_trigger",
      "mcp__Claude_Code_Remote__list_triggers",
      "mcp__Claude_Code_Remote__get_session",
      "mcp__Claude_Code_Remote__list_sessions",
      "mcp__Claude_Code_Remote__archive_session"
    ]
  },
  "autoMode": {
    "allow": [
      "$defaults",
      "Creating, listing, updating, firing, or deleting Claude Code Remote scheduled triggers (Routines) via mcp__Claude_Code_Remote__*_trigger tools. Owner-authorized unattended operations for the CONVEYOR protocol; reversible, and they touch only this account's own scheduling state.",
      "Creating Claude Code Remote sessions via mcp__Claude_Code_Remote__create_session, including sessions that clone and push to the owner's own tbuitendyk/CLAUDE-PROJECTS repository. This is the dispatch step of the owner-authorized CONVEYOR protocol.",
      "Reading, listing, and archiving Claude Code Remote sessions via get_session, list_sessions, and archive_session."
    ]
  }
}
```

Both blocks matter: `autoMode.allow` covers auto mode, `permissions.allow` covers
the other modes, so the conveyor behaves the same whichever mode a session is in.

## Where to put it

Settings load **user → project → local**, later overriding earlier. Security-
sensitive keys are deliberately ignored in repo-resident project settings, so a
file committed to this repo is the wrong home for this. It needs to be **user
scope**.

**For cloud sessions** (what the conveyor runs in), `~/.claude/` lives in an
ephemeral container that is rebuilt per session — a file written by hand is gone
next time. The durable route is the **environment's setup script**: have it write
`~/.claude/settings.json` with the JSON above at container start. Every session
in that environment then begins pre-authorized. Configure it where the
environment is defined (see code.claude.com/docs/en/claude-code-on-the-web).

**For a local CLI session**, put it straight in `~/.claude/settings.json`.

## The blunter alternative

`permissions.defaultMode` also accepts `"bypassPermissions"` and `"dontAsk"`,
which stop prompting wholesale rather than for these specific tools. That is a
much larger surface than the conveyor needs and an org policy may disable it
(`disableBypassPermissionsMode`). The targeted `autoMode.allow` list above is the
narrower and safer fix.

## How to verify it took

In a fresh session in that environment, have it call
`mcp__Claude_Code_Remote__create_session` once. No prompt means it is live. If a
prompt still appears, the settings file was not read — check that the setup
script actually wrote it, and that the JSON parses (a malformed settings file
silently disables every setting in it).

## What this changes about CONVEYOR

Everything. With this applied, the alarm-driven design works as originally
described: alarms wake the owner session, it dispatches one worker per step, and
nothing prompts. Without it, every dispatch costs an approval and unattended
operation is not achievable — which is the state all testing to date was
conducted in.
