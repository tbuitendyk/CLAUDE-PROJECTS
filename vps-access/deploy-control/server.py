#!/usr/bin/env python3
"""deploy-control: a minimal, scoped HTTPS-frontable control endpoint.

Why this exists
---------------
Claude Code cloud sessions run behind an HTTP/HTTPS-only egress proxy -- raw
SSH (port 22) is dropped at the TCP layer, so the `ssh vps` approach can't work
from a cloud session. This service is the HTTPS equivalent: it maps an
authenticated POST to the SAME locked-down `claude-deploy` helper (and its
sudoers gating) that the SSH path would have used.

Security posture
----------------
* Binds to 127.0.0.1 only -- never directly exposed. nginx terminates TLS on
  deploy.buitendyk.ca and reverse-proxies to it (adding rate limiting).
* Bearer-token auth, constant-time compared. The token is the single secret;
  it lives in /etc/deploy-control/env (root:claude-deploy 640) on the box and
  as the DEPLOY_API_TOKEN env var on the Claude Code environment.
* Runs as the unprivileged `claude-deploy` user. The ONLY elevated thing it can
  do is `sudo -n /usr/local/sbin/claude-deploy <action>`, whose seven fixed
  actions and sudoers rule were installed by setup-claude-access.sh. It cannot
  run arbitrary commands: `action` is whitelist-checked, and the `sync` branch
  and `run-script` name are regex-validated before the helper (which validates
  again) ever sees them. run-script executes only version-controlled scripts
  from vps-access/scripts/ -- never inline commands from the request.

Request / response
------------------
  POST /run   {"action": "status"}                      -> run an action
              {"action": "sync", "branch": "claude/x"}  -> sync requires branch
              {"action": "run-script", "script": "x.sh"} -> repo script by name
              {"action": "run-script", "script": "x.sh", "arg": "y"} -> ...with one arg
  GET  /healthz                                          -> {"ok": true} (no auth)

  200/500 JSON: {ok, action, exit_code, stdout, stderr}
  4xx  JSON:    {ok: false, error: "..."}
"""
from __future__ import annotations

import hmac
import json
import os
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HELPER = "/usr/local/sbin/claude-deploy"
ACTIONS = {"status", "sync", "deploy-website", "deploy-dubber", "restart-dubber",
           "maint-report", "run-script"}
# Mirrors the guard inside the helper: a defensible branch name, nothing that
# could smuggle extra tokens onto the command line.
BRANCH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
# Stricter than BRANCH_RE: no slashes, so a name can only select a file inside
# the helper's fixed scripts directory (the helper re-validates too).
SCRIPT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
# Optional single argument to a script: branch-name-shaped (slashes allowed),
# no shell metacharacters/spaces. Passed positionally as $1, never interpreted
# as a command. The helper re-validates.
ARG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
MAX_BODY = 4096
# Deploys (apt, rsync, service restarts) can run a while; give them room but
# still bound it so a wedged command can't pin a worker forever.
COMMAND_TIMEOUT = 900

TOKEN = os.environ.get("DEPLOY_CONTROL_TOKEN", "")
PORT = int(os.environ.get("DEPLOY_CONTROL_PORT", "8090"))


class Handler(BaseHTTPRequestHandler):
    server_version = "deploy-control/1.0"
    protocol_version = "HTTP/1.1"

    # --- helpers -----------------------------------------------------------
    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return False
        presented = header[len("Bearer "):].strip()
        # TOKEN is guaranteed non-empty (main() refuses to start otherwise).
        return hmac.compare_digest(presented, TOKEN)

    # --- routes ------------------------------------------------------------
    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/healthz":
            self._send(200, {"ok": True})
        else:
            self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:
        # Read (and thereby drain) the request body FIRST, so every early
        # return below leaves the keep-alive connection correctly framed. The
        # body is small by construction (nginx caps it at 16k; we cap here too).
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length > MAX_BODY:
            self.close_connection = True
            self._send(413, {"ok": False, "error": "request body too large"})
            return
        raw = self.rfile.read(length) if length else b"{}"

        if self.path.split("?", 1)[0] != "/run":
            self._send(404, {"ok": False, "error": "not found"})
            return
        if not self._authorized():
            self._send(401, {"ok": False, "error": "unauthorized"})
            return

        try:
            data = json.loads(raw or b"{}")
        except ValueError:
            self._send(400, {"ok": False, "error": "invalid JSON body"})
            return

        action = str(data.get("action", ""))
        if action not in ACTIONS:
            self._send(400, {"ok": False, "error": f"action must be one of {sorted(ACTIONS)}"})
            return

        cmd = ["sudo", "-n", HELPER, action]
        if action == "sync":
            branch = str(data.get("branch", ""))
            if not BRANCH_RE.match(branch):
                self._send(400, {"ok": False, "error": "sync requires a valid 'branch'"})
                return
            cmd.append(branch)
        elif action == "run-script":
            script = str(data.get("script", ""))
            if not SCRIPT_RE.match(script):
                self._send(400, {"ok": False, "error": "run-script requires a valid 'script'"})
                return
            cmd.append(script)
            arg = str(data.get("arg", ""))
            if arg:
                if not ARG_RE.match(arg):
                    self._send(400, {"ok": False, "error": "run-script 'arg' is invalid"})
                    return
                cmd.append(arg)

        sys.stderr.write(f"deploy-control: running {action}"
                         + (f" {cmd[-1]}" if action in ("sync", "run-script") else "") + "\n")
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=COMMAND_TIMEOUT)
        except subprocess.TimeoutExpired:
            self._send(504, {"ok": False, "action": action, "error": "command timed out"})
            return
        except Exception as exc:  # noqa: BLE001 -- surface anything as JSON, never 500-html
            self._send(500, {"ok": False, "action": action, "error": str(exc)})
            return

        self._send(200 if proc.returncode == 0 else 500, {
            "ok": proc.returncode == 0,
            "action": action,
            "exit_code": proc.returncode,
            # Cap output so a chatty deploy can't return megabytes.
            "stdout": proc.stdout[-8000:],
            "stderr": proc.stderr[-8000:],
        })

    # Quieter, single-line logging to journald (via stderr).
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("deploy-control: " + (fmt % args) + "\n")


def main() -> None:
    if not TOKEN:
        sys.exit("DEPLOY_CONTROL_TOKEN is not set; refusing to start.")
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    sys.stderr.write(f"deploy-control: listening on 127.0.0.1:{PORT}\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
