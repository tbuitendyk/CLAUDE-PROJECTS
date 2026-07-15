#!/usr/bin/env bash
# Adds a `delete-branch` action to the deploy-control endpoint.
#
# When called with {"action":"delete-branch","owner":"X","repo":"Y","branch":"Z"}
# the service uses the GitHub REST API to delete refs/heads/Z. Owner is
# constrained to "tbuitendyk" and branch names are regex-validated (same
# posture as the existing `sync` action).
#
# NOTE: this patches /opt/deploy-control/server.py IN PLACE. The upstream copy
# lives on the CLAUDE-PROJECTS `vps-access` branch. Any future `sync vps-access`
# followed by `bash vps-access/install-deploy-control.sh` will overwrite the
# patch. The durable fix is a PR to CLAUDE-PROJECTS/vps-access; this script is
# the interim.
#
# Run as root on the VPS. Idempotent (re-running just re-patches).

set -euo pipefail

SERVER_PY=/opt/deploy-control/server.py
ENV_FILE=/etc/deploy-control/env
BACKUP="${SERVER_PY}.bak.$(date +%Y%m%d-%H%M%S)"

if [[ $EUID -ne 0 ]]; then echo "run as root" >&2; exit 1; fi
[[ -f "$SERVER_PY" ]] || { echo "not found: $SERVER_PY" >&2; exit 1; }
[[ -f "$ENV_FILE"  ]] || { echo "not found: $ENV_FILE"  >&2; exit 1; }

# ---------- 1. GitHub PAT ---------------------------------------------------
if ! grep -q '^GITHUB_ADMIN_TOKEN=' "$ENV_FILE"; then
    echo
    echo "Need a GitHub fine-grained PAT with 'Contents: write' on the repos"
    echo "you want to be able to delete branches on (e.g. all tbuitendyk repos)."
    echo "Create one at https://github.com/settings/tokens?type=beta"
    echo
    read -rsp "Paste PAT (input hidden): " PAT; echo
    [[ -n "$PAT" ]] || { echo "empty token, aborting" >&2; exit 1; }
    printf 'GITHUB_ADMIN_TOKEN=%s\n' "$PAT" >> "$ENV_FILE"
    chown root:claude-deploy "$ENV_FILE"
    chmod 640 "$ENV_FILE"
    echo "stored GITHUB_ADMIN_TOKEN in $ENV_FILE"
else
    echo "GITHUB_ADMIN_TOKEN already present in $ENV_FILE — leaving it"
fi

# ---------- 2. Patch server.py ---------------------------------------------
cp -a "$SERVER_PY" "$BACKUP"
echo "backed up server.py -> $BACKUP"

python3 - "$SERVER_PY" <<'PY'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()

# a) whitelist
new_actions = '{"status", "sync", "deploy-website", "deploy-dubber", "restart-dubber", "maint-report", "delete-branch"}'
src2, n = re.subn(
    r'ACTIONS\s*=\s*\{[^}]*\}',
    f'ACTIONS = {new_actions}',
    src, count=1)
if n != 1:
    sys.exit("could not locate ACTIONS set")

# b) constants (owner + repo allowlist + branch regex reuse)
if "OWNER_ALLOWED" not in src2:
    src2 = src2.replace(
        "BRANCH_RE = re.compile",
        "OWNER_ALLOWED = {'tbuitendyk'}\nREPO_RE   = re.compile(r'^[A-Za-z0-9._-]+$')\nBRANCH_RE = re.compile",
        1)

# c) imports — need urllib.request for the API call
if "import urllib.request" not in src2:
    src2 = src2.replace("import subprocess", "import subprocess\nimport urllib.error\nimport urllib.request", 1)

# d) dispatch: intercept BEFORE the "cmd = [sudo, ...]" line
handler = '''\
        if action == "delete-branch":
            owner  = str(data.get("owner",  "")).strip()
            repo   = str(data.get("repo",   "")).strip()
            branch = str(data.get("branch", "")).strip()
            if owner not in OWNER_ALLOWED:
                self._send(400, {"ok": False, "error": f"owner must be one of {sorted(OWNER_ALLOWED)}"})
                return
            if not REPO_RE.match(repo):
                self._send(400, {"ok": False, "error": "invalid repo"})
                return
            if not BRANCH_RE.match(branch):
                self._send(400, {"ok": False, "error": "invalid branch"})
                return
            gh_token = os.environ.get("GITHUB_ADMIN_TOKEN", "")
            if not gh_token:
                self._send(500, {"ok": False, "error": "GITHUB_ADMIN_TOKEN not configured"})
                return
            url = f"https://api.github.com/repos/{owner}/{repo}/git/refs/heads/{branch}"
            req = urllib.request.Request(url, method="DELETE", headers={
                "Authorization": f"Bearer {gh_token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "deploy-control/1.1",
            })
            sys.stderr.write(f"deploy-control: DELETE {owner}/{repo}#{branch}\\n")
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    self._send(200, {"ok": True, "action": action, "exit_code": 0,
                                     "stdout": f"deleted {owner}/{repo}#{branch} ({resp.status})",
                                     "stderr": ""})
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "replace")
                self._send(500, {"ok": False, "action": action, "exit_code": e.code,
                                 "stdout": "", "stderr": body})
            except Exception as exc:
                self._send(500, {"ok": False, "action": action, "error": str(exc)})
            return

'''

# Inject the handler right before `cmd = ["sudo", "-n", HELPER, action]`
marker = '        cmd = ["sudo", "-n", HELPER, action]'
if marker not in src2:
    sys.exit("could not locate dispatch marker")
src2 = src2.replace(marker, handler + marker, 1)

p.write_text(src2)
print("patch applied to", p)
PY

# ---------- 3. Sanity-check + restart --------------------------------------
python3 -c "import py_compile,sys; py_compile.compile('$SERVER_PY', doraise=True)"
systemctl restart deploy-control.service
sleep 1
systemctl --no-pager --lines=5 status deploy-control.service | head -20

# ---------- 4. Show quick usage --------------------------------------------
cat <<'USAGE'

--- patched. Test with:
curl -fsS -X POST https://deploy.buitendyk.ca/run \
  -H "Authorization: Bearer $DEPLOY_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"delete-branch","owner":"tbuitendyk","repo":"claude-4-publish-to-homs-web","branch":"claude/add-ssl-roundcube-PojUv"}'
USAGE
