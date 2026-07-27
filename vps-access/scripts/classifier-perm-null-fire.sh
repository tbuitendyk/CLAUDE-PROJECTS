#!/usr/bin/env bash
# classifier-perm-null-fire.sh -- re-fire a permutation screen's null test
# over its SAVED selection (asset/members/rungs persist on the doc).
# Usage: run-script classifier-perm-null-fire.sh <docId>@<shifts>
#   e.g. "permscreen-20260727-0401@1000"
set -euo pipefail
ARG="${1:-}"
if [[ "$ARG" != *@* ]]; then
  echo "usage: run-script classifier-perm-null-fire.sh <docId>@<shifts>" >&2
  exit 1
fi
ID="${ARG%@*}"
SHIFTS="${ARG##*@}"
curl -sS -X POST "http://127.0.0.1:8093/api/permscreen/${ID}/null" \
  -H "Content-Type: application/json" \
  -d "{\"shifts\":${SHIFTS}}"
echo
