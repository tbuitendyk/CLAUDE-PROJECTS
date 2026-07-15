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
3. **Idempotent** wherever possible — safe to run twice.
4. `set -euo pipefail` at the top; fail loudly, not silently.
5. **State intent in the header comment**: read-only vs. what it changes.
   Destructive steps (delete/uninstall/config-overwrite) need explicit user
   sign-off in the session before the call is made.
6. **Output is capped** (~8 KB tail reaches the session) and runtime is bounded
   by the endpoint's 15-minute command timeout — keep output tight and put the
   important lines last.

`smoke.sh` is a harmless end-to-end test of the mechanism.
