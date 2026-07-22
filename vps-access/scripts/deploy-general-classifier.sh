#!/usr/bin/env bash
# deploy-general-classifier.sh -- deploy the General Classifier from the
# general-classifier branch (Node service + web UI on 127.0.0.1:8093; public
# face is the /classifier/ nginx location on the website branch, which ships
# separately via deploy-website).
# Changes: syncs a dedicated checkout (~/deploy-general-classifier) to
# origin/general-classifier and runs general-classifier/deploy/install.sh
# (Node deps, rsync to /opt/general-classifier preserving data/ -- the
# Binance month cache -- npm ci, systemd unit restart). Idempotent;
# /etc/general-classifier/env is seeded once and never clobbered. Runs as
# root via run-script. Uses its own checkout because run-script has already
# reset the shared /root/claude-projects checkout to vps-access.
set -euo pipefail
CHECKOUT="$HOME/deploy-general-classifier"
if [[ ! -d "$CHECKOUT/.git" ]]; then
  git clone --branch general-classifier https://github.com/tbuitendyk/CLAUDE-PROJECTS.git "$CHECKOUT"
fi
cd "$CHECKOUT"
git remote set-url origin https://github.com/tbuitendyk/CLAUDE-PROJECTS.git
git fetch origin general-classifier
git checkout -B general-classifier origin/general-classifier
bash general-classifier/deploy/install.sh
