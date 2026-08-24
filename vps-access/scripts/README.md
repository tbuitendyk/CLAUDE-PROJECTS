# scripts/ — what `run-script` executes

`claude-deploy run-script <name>` (endpoint action `run-script`) syncs the
`vps-access` branch on the box, then runs `vps-access/scripts/<name>` **as
root**. That makes this directory the trust boundary: anything committed here
is one API call away from running with full privileges on the production VPS.

Rules for every script in this directory:

1. **Reviewed before run.** A script lands here via a commit; the commit is the
   review artifact. Don't run a script the user hasn't seen land.
2. **Names**: must match `^[A-Za-z0-9][A-Za-z0-9._-]*$` (enforced twice — in
   `server.py` and in the helper). Keep the `.sh` suffix by convention.
   A script may receive **one optional argument** as `$1` (passed via the
   endpoint's `"arg"` field, regex-validated `^[A-Za-z0-9][A-Za-z0-9._/@+-]*$` —
   branch- or email-shaped, no spaces/metacharacters). It's positional data,
   never a command; re-validate it inside the script anyway.
3. **Idempotent** wherever possible — safe to run twice.
4. `set -euo pipefail` at the top; fail loudly, not silently.
5. **State intent in the header comment**: read-only vs. what it changes.
   Destructive steps (delete/uninstall/config-overwrite) need explicit user
   sign-off in the session before the call is made.
6. **Output is capped** (~8 KB tail reaches the session) and runtime is bounded
   by the endpoint's 15-minute command timeout — keep output tight and put the
   important lines last.

`smoke.sh` is a harmless end-to-end test of the mechanism.

`configure-balancer-email.sh` points the asset balancer at the same
authenticated submission path `mail-test.sh` uses (mail VM `192.168.56.129:587`
as `support@homeandofficemicro.com`): copies the password on-box from
`SUPPORT_SMTP_PASSWORD` in `/etc/deploy-control/env` into
`/etc/asset-balancer/env`, restarts the service, and sends a test email
through the app. Idempotent.

`deploy-balancer.sh` deploys the asset balancer from the `balancer` branch:
syncs a dedicated checkout (`~/deploy-balancer`) and runs
`asset-balancer/deploy/install.sh` (installs/updates the `asset-balancer`
systemd service on `127.0.0.1:8091`; first run seeds
`/etc/asset-balancer/env`, which then needs SMTP creds added by hand).

`delete-branch.sh` lists (no arg) or deletes (`<branch>` arg) stale `claude/*`
branches on CLAUDE-PROJECTS. It needs `GITHUB_BRANCH_TOKEN` in
`/etc/deploy-control/env` — a fine-grained PAT scoped to **this repo only,
Contents: write**. It refuses the real project branches and the default branch,
and only ever touches `claude/*`.

`send-test-email.sh [recipient]` -- **internal** routing test. Verifies a local
mailbox (RCPT callout via the trusted loopback path) then sends one test email
from the host. Accepts a bare local-part (domain defaults to
`homeandofficemicro.com`) or a full address. On an unknown mailbox it probes
likely spelling variants, lists the valid ones, and does **not** send.

`send-external-test.sh [from_mailbox]` -- **external** routing test. Sends out
through the mail server to Port25's `check-auth@verifier.port25.com` reflector,
which emails an SPF/DKIM/DMARC report back to the From address -- the reply's
inbound delivery via the public IP is the routing test. Read the report in the
From mailbox (defaults to `theodor@homeandofficemicro.com`).

- `service-ctl.sh [stop|start|status]` — stop/start BOTH balancer services
  together (`asset-balancer` + `semi-auto-balancer`, hard whitelist — can never
  touch `deploy-control`). Stop is temporary: units stay enabled, a reboot
  brings them back. While stopped: no polls/alerts/syncs/monitor checks;
  running searches die, ⏸-paused ones survive via checkpoint.

`uts-rows-squash-start.sh` / `uts-rows-squash-status.sh` / `uts-rows-squash.js`
— ONE-OFF, and it CHANGES the interrupted sweep's stored rows (owner
authorisation, 2026-08-24). Rewrites the run's three row files from plain text
into the squashed block form `lib/rowstore.js` writes today, so the run can be
picked up from the interface and finish compressed instead of adding another
fifty gigabytes of text. Every row is carried across as the exact bytes it was
written as — nothing is recomputed and no number is re-serialised. The plain
originals are removed only after the squashed copy has been read back through
the block index and found to hold the same rows with the same last row. It also
reports how far the two promote collections drifted apart at the crash, and
changes nothing about that. Runs detached (tens of minutes); watch it with the
status script. `uts-rows-squash-test.js` proves it against the real
`lib/rowstore.js` on damaged fixtures and must pass before it is run.
