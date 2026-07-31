#!/usr/bin/env bash
# deploy-classifier-static.sh -- ship ONLY the web interface files
# (general-classifier/public/: HTML, CSS, JS) to the box WITHOUT touching
# the running service. The node process serves these from disk per request,
# so changes are live on the next page load; the engine — and any
# multi-hour job it is running — is never restarted. Exists because the
# full deploy restarts the service, which would kill a running job mid-run
# (owner, 2026-07-31: "add the running-job notice ... without disruption
# of what's running").
#
# Safe only for public/ — server-side files must NEVER ship this way, or
# the running process and the disk would disagree about what is deployed.
set -euo pipefail
CHECKOUT="$HOME/deploy-general-classifier"
if [[ ! -d "$CHECKOUT/.git" ]]; then
  git clone --branch general-classifier https://github.com/tbuitendyk/CLAUDE-PROJECTS.git "$CHECKOUT"
fi
cd "$CHECKOUT"
git remote set-url origin https://github.com/tbuitendyk/CLAUDE-PROJECTS.git
git fetch origin general-classifier
git checkout -B general-classifier origin/general-classifier
rsync -a --delete "$CHECKOUT/general-classifier/public/" /opt/general-classifier/public/
echo "static UI now at $(git rev-parse --short HEAD): $(grep -o 'app.js?v=[0-9]*' /opt/general-classifier/public/index.html)"
echo "service deliberately NOT restarted; engine health:"
curl -sS --max-time 10 http://127.0.0.1:8093/api/healthz || true
echo
