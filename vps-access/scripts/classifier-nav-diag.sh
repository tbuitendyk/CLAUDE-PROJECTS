#!/usr/bin/env bash
# classifier-nav-diag.sh -- why does the bracket-guide topbar not display?
# Read-only: checks (1) the file on disk under /opt, (2) what the node service
# actually serves on 127.0.0.1:8093, (3) the deploy checkout rev. No restarts.
set -uo pipefail
echo "== deploy checkout rev =="
git -C "$HOME/deploy-general-classifier" rev-parse --short HEAD 2>/dev/null || echo "no checkout"
echo "== /opt file on disk =="
F=/opt/general-classifier/public/help-bracket.html
if [ -f "$F" ]; then
  echo "  mtime: $(stat -c %y "$F")"
  grep -c 'class="topbar"' "$F" | sed 's/^/  topbar occurrences: /'
  head -c 200 "$F" | tr -d '\n' | sed 's/^/  head: /'; echo
else
  echo "  MISSING: $F"
fi
echo "== served by the node service (127.0.0.1:8093) =="
for P in /help-bracket.html /public/help-bracket.html /classifier/help-bracket.html; do
  CODE=$(curl -s -o /tmp/nav-diag-page -w '%{http_code}' --max-time 10 "http://127.0.0.1:8093$P")
  HIT=$(grep -c 'class="topbar"' /tmp/nav-diag-page 2>/dev/null || true)
  SIZE=$(wc -c < /tmp/nav-diag-page 2>/dev/null || echo 0)
  echo "  GET $P -> $CODE, ${SIZE}b, topbar hits: $HIT"
done
echo "== how server.js serves statics =="
grep -n -m4 -E "static|public|sendFile" /opt/general-classifier/server.js | head -6
rm -f /tmp/nav-diag-page
