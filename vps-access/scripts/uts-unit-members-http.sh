#!/usr/bin/env bash
# uts-unit-members-http.sh -- READ-ONLY. The members request exactly as the
# Boards screen sends it, through the service's own port: its status and the
# first of what it answers. Changes nothing.
#   usage: uts-unit-members-http.sh <record set id>
set -uo pipefail
ID="${1:-s1-muf05gm7-9}"
for u in 0 NaN undefined; do
  echo "== unit $u"
  curl -s -o /tmp/uts-mem.json -w 'HTTP %{http_code}\n' "http://127.0.0.1:8094/api/stageset/${ID}/unit/${u}/members"
  head -c 300 /tmp/uts-mem.json; echo
done
grep -n "unit/.*/members" /var/log/nginx/access.log 2>/dev/null | tail -5 || true
journalctl -u ultimate-trading-system --since "3 hours ago" --no-pager 2>/dev/null | grep -i "members" | tail -5 || true
