#!/usr/bin/env bash
# deploy-balancer.sh -- deploy the asset balancer from the balancer branch.
# Changes: syncs a dedicated checkout (~/deploy-balancer) to origin/balancer
# and runs asset-balancer/deploy/install.sh (apt deps, rsync to
# /opt/asset-balancer preserving data/, npm ci, systemd unit restart on
# 127.0.0.1:8091). Idempotent; /etc/asset-balancer/env is seeded once and
# never clobbered. Runs as root via run-script. Uses its own checkout (like
# deploy-docs.sh) because run-script has already reset the shared
# /root/claude-projects checkout to vps-access.
set -euo pipefail
CHECKOUT="$HOME/deploy-balancer"
if [[ ! -d "$CHECKOUT/.git" ]]; then
  git clone --branch balancer https://github.com/tbuitendyk/CLAUDE-PROJECTS.git "$CHECKOUT"
fi
cd "$CHECKOUT"
git remote set-url origin https://github.com/tbuitendyk/CLAUDE-PROJECTS.git
git fetch origin balancer
git checkout -B balancer origin/balancer
bash asset-balancer/deploy/install.sh
