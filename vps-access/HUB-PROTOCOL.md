# Mail Hub Protocol — the gatekeeper for the `claude@` channel

The **vps-access session is the gatekeeper**. One cron cycle on the VPS host is
the ONLY consumer of `claude@homeandofficemicro.com`. It verifies every inbound
message (SASL + queue-id binding — see `scripts/claude-mail-check.sh` header)
and routes verified owner mail to per-project-session **hub inboxes**
(semaphore files). Registered project sessions — one per GitHub project
branch, addressed by branch name; the cloud container underneath is
irrelevant — never touch IMAP directly.

## Cadence (owner's rule)
- Baseline: the hub polls the mailbox every **15 minutes at fixed times** —
  :00/:15/:30/:45 wall clock.
- **Stagger contract:** project sessions fetch **one minute after** the hub's poll
  (:01/:16/:31/:46), so routed mail waits ~1 minute, not up to a period.
  `hub-fetch.sh` computes `NEXT-POLL <seconds>` to land the caller on that
  grid automatically — honoring it IS the coordination; no clock math needed
  session-side.
- Any mail interaction (verified inbound, or an outbound send) switches both
  hub and project sessions to **every 1 minute for the next 20 minutes**
  (`NEXT-POLL 60`).

## Dispatch model (2026-08-12, owner directive)
The hub session runs the ONLY required loop. Each tick it checks every queue
(`hub-queues.sh`); mail for another project session is fetched by the hub and handed
to an on-demand worker loaded with that branch's context, which does the work
and replies via the outbox flow immediately. Registered project sessions do NOT need
polling loops; if one is active it may still fetch its own queue (below), and
whoever fetches first wins — the queue is consuming, so nothing is handled
twice. The stale-queue owner alert remains as the net under everything.

## For a registered project session
- **Receive**: `run-script hub-fetch.sh` arg `<your-name>` — prints your queued
  verified messages (oldest first, ~6KB per call; call again if it says MORE
  QUEUED) and archives them to `hub/delivered/<your-name>/` on the box.
- **Send**: unchanged — commit `vps-access/outbox/<your-name>-<slug>.txt`
  (line 1 subject; first non-blank line after it must start with `tl;dr`; sign
  `c.`), push, then `run-script claude-mail-send.sh` arg `<your-name>-<slug>`.
  Prefix outbox filenames with your registered name.
- **Register** (new sessions): `run-script hub-register.sh` arg `<name>`
  (lowercase/digits/hyphens, normally the GitHub project branch name). Ask the
  owner or the vps-access session to add you to the routing conventions below.

## Routing of verified inbound mail
1. First registered name appearing (case-insensitive) in the **Subject** wins —
   the owner can address a project session explicitly, e.g.
   `Subject: general-classifier: pause the batch`.
2. No match → the **default route = `vps-access`, the hub session itself**:
   the gatekeeper reads it and passes it on with
   `hub-reroute.sh <msgfile>/<target>` (change the default with
   `hub-register.sh <name>/default`).
3. UNVERIFIED mail is never routed, never marked read, never acted on — it is
   counted in the hub log and left in the mailbox for inspection.

## Legacy compatibility
`claude-mail-check.sh` called directly now delegates to
`hub-fetch.sh <legacy-route>` while the hub is enabled (guard at the top of
the script; `hub/legacy-route` is pinned to `general-classifier`, the only
pre-hub poller — deliberately independent of the default route, which is the
hub session). The hub's own cycle bypasses the guard with
`CLAUDE_MAIL_HUB_BYPASS=1`. So a session that still polls the old way keeps
receiving its mail — via the hub — with no changes on its side.

## Operations (vps-access / owner)
- Status: `run-script hub-status.sh` (registry, cadence, queues, dependency
  audit, log tail). Log: `/var/lib/claude-mail/hub/log/hub.log`.
- Install/refresh after editing `hub-cycle-core.sh`: `run-script hub-setup.sh`.
- Disable (fall back to direct polling): remove
  `/var/lib/claude-mail/hub/ENABLED`.
- **Stale-queue alert:** if any project session leaves routed mail unfetched
  for 30+ minutes, the cycle emails the owner (subject "Mail hub alert:
  project session not picking up its mail"), at most once per 2 h. Recovery tools:
  `hub-requeue.sh <name>` (restore fetched-but-unhandled mail to the queue),
  `hub-queue-peek.sh` (read-only queue timeline).
- **Hub notices (gatekeeper -> project session):** commit
  `hub-notices/<name>.txt`, then `hub-notice-post.sh <name>`; the text prints
  clearly labeled at the top of that project session's next `hub-fetch`. Notices are
  infrastructure guidance and carry NO owner-verified authority.
- **Doc-sync rule:** any change to hub scripts, flows, cadence, or conventions
  MUST update `MAIL-CHEATSHEET.md` in the same commit (owner directive — that
  file is the single onboarding source and must never drift).
- On-box layout: `/var/lib/claude-mail/hub/{registry,inbox/<name>,delivered/<name>,log}`,
  `default-route`, `last-cycle`; interaction clock shared with the send path at
  `/var/lib/claude-mail/last-sent`.
