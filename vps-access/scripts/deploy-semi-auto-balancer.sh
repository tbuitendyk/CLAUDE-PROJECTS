#!/usr/bin/env bash
# deploy-semi-auto-balancer.sh -- deploy the semi-auto balancer from the
# semi-auto-balancer branch (the successor system; the old balancer stays
# frozen on 8091 while this runs in parallel on 127.0.0.1:8092).
# Changes: syncs a dedicated checkout (~/deploy-semi-auto-balancer) to
# origin/semi-auto-balancer and runs semi-auto-balancer/deploy/install.sh
# (apt deps, rsync to /opt/semi-auto-balancer preserving data/, npm ci,
# systemd unit restart). Idempotent; /etc/semi-auto-balancer/env is seeded
# once and never clobbered. Runs as root via run-script. Uses its own
# checkout because run-script has already reset the shared
# /root/claude-projects checkout to vps-access.
set -euo pipefail
CHECKOUT="$HOME/deploy-semi-auto-balancer"
if [[ ! -d "$CHECKOUT/.git" ]]; then
  git clone --branch semi-auto-balancer https://github.com/tbuitendyk/CLAUDE-PROJECTS.git "$CHECKOUT"
fi
cd "$CHECKOUT"
git remote set-url origin https://github.com/tbuitendyk/CLAUDE-PROJECTS.git
git fetch origin semi-auto-balancer
git checkout -B semi-auto-balancer origin/semi-auto-balancer
bash semi-auto-balancer/deploy/install.sh
