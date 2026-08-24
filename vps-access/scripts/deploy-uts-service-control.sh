#!/usr/bin/env bash
# deploy-uts-service-control.sh -- installs UTS Service Control: the separate
# always-up process that says what is running on this machine and starts, stops
# and restarts it (owner order, 2026-08-24).
#
# IT DOES NOT TOUCH THE TRADING SERVICE, and that is why it is a separate deploy
# from deploy-uts.sh. Run this FIRST: it puts the control and its nginx route in
# place, so that when the app deploy lands afterwards the new Service tab has
# something to talk to instead of reporting that nothing answered.
#
# Uses its own checkout, because run-script has already reset the shared
# /root/claude-projects checkout to the vps-access branch. Idempotent.
set -euo pipefail
CHECKOUT="$HOME/deploy-uts"
if [[ ! -d "$CHECKOUT/.git" ]]; then
  git clone --branch ultimate-trading-system https://github.com/tbuitendyk/CLAUDE-PROJECTS.git "$CHECKOUT"
fi
cd "$CHECKOUT"
git remote set-url origin https://github.com/tbuitendyk/CLAUDE-PROJECTS.git
git fetch origin ultimate-trading-system
git checkout -B ultimate-trading-system origin/ultimate-trading-system
echo "==> installing from $(git log --oneline -1)"
bash ultimate-trading-system/service-control/install.sh
