#!/usr/bin/env bash
# vps-run.sh <script-name.sh> — the ONE sanctioned door to the VPS deploy
# API. Exists so the permission allowlist can pre-approve exactly this,
# pinned to this endpoint, instead of a broad curl rule that could reach
# anywhere. Scripts must be committed on the vps-access branch; the API
# forwards no arguments and no environment.
set -euo pipefail
# An optional second argument is forwarded as the endpoint's `arg`, which the
# endpoint has accepted all along (branch- or email-shaped, no spaces): a
# read-only script that reports on one coin at a time needs it, because the
# endpoint hands a session 8 KB of output.
[ $# -eq 1 ] || [ $# -eq 2 ] || { echo "usage: vps-run.sh <script.sh> [arg]"; exit 1; }
case "$1" in *[!A-Za-z0-9._-]*) echo "bad script name"; exit 1;; esac
ARG="${2:-}"
case "$ARG" in *[!A-Za-z0-9._/@+-]*) echo "bad arg"; exit 1;; esac
if [ -n "$ARG" ]; then BODY="{\"action\":\"run-script\",\"script\":\"$1\",\"arg\":\"$ARG\"}"; else BODY="{\"action\":\"run-script\",\"script\":\"$1\"}"; fi
exec curl -sS --max-time 590 -X POST https://deploy.buitendyk.ca/run \
  -H "Authorization: Bearer $DEPLOY_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$BODY"
