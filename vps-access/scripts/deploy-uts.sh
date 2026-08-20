#!/usr/bin/env bash
# deploy-uts.sh -- deploy the Ultimate Trading System from the
# ultimate-trading-system branch (Node service + web UI on 127.0.0.1:8094;
# public face is the /uts/ nginx location on the website branch, which ships
# separately via deploy-website).
#
# THIS DOES NOT TOUCH THE PREVIOUS GENERATION. The older app keeps running from
# /opt/general-classifier as unit `general-classifier` on 8093, holding the
# owner's live trading and paper books. This deploy installs alongside it under
# its own directory, user, unit, env file and port; the installer it calls
# carries a guard that refuses to run if those ever collide, and asserts the old
# unit is still active before it reports success.
#
# Uses its own checkout because run-script has already reset the shared
# /root/claude-projects checkout to vps-access. Idempotent.
set -euo pipefail
CHECKOUT="$HOME/deploy-uts"
if [[ ! -d "$CHECKOUT/.git" ]]; then
  git clone --branch ultimate-trading-system https://github.com/tbuitendyk/CLAUDE-PROJECTS.git "$CHECKOUT"
fi
cd "$CHECKOUT"
git remote set-url origin https://github.com/tbuitendyk/CLAUDE-PROJECTS.git
git fetch origin ultimate-trading-system
git checkout -B ultimate-trading-system origin/ultimate-trading-system
echo "==> deploying $(git log --oneline -1)"
bash ultimate-trading-system/deploy/install.sh
