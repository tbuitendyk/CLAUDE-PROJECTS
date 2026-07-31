#!/usr/bin/env bash
# vps-run.sh <script-name.sh> — the ONE sanctioned door to the VPS deploy
# API. Exists so the permission allowlist can pre-approve exactly this,
# pinned to this endpoint, instead of a broad curl rule that could reach
# anywhere. Scripts must be committed on the vps-access branch; the API
# forwards no arguments and no environment.
set -euo pipefail
[ $# -eq 1 ] || { echo "usage: vps-run.sh <script.sh>"; exit 1; }
case "$1" in *[!A-Za-z0-9._-]*) echo "bad script name"; exit 1;; esac
exec curl -sS --max-time 590 -X POST https://deploy.buitendyk.ca/run \
  -H "Authorization: Bearer $DEPLOY_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"run-script\",\"script\":\"$1\"}"
