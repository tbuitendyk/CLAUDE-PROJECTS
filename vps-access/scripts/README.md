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
