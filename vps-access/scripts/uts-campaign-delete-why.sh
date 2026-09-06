#!/usr/bin/env bash
# uts-campaign-delete-why.sh -- READ-ONLY. Asks the box exactly what the delete
# control asks it, and prints the answer. Deletes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
N='UPDATED ON R3.46.0 - Five coins - all singles - deep sweep'
echo "== GET /api/campaign-contents =="
curl -sS -o /tmp/cc.json -w 'HTTP %{http_code}\n' --max-time 25 --get --data-urlencode "name=$N" "$B/api/campaign-contents"
head -c 2500 /tmp/cc.json; echo; echo
echo "== the campaign list the box serves =="
curl -sS --max-time 25 "$B/api/campaigns" 2>/dev/null | head -c 1200; echo
