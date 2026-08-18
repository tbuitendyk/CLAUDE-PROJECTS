#!/usr/bin/env bash
# classifier-ui-probe.sh -- READ-ONLY: report whether this box can run a real
# browser against the deployed classifier, and what it would need.
set -uo pipefail
echo "== node =="; node -v 2>/dev/null || echo "  (no node)"
echo "== playwright / puppeteer present? =="
for d in /usr/lib/node_modules /usr/local/lib/node_modules /opt/node22/lib/node_modules; do
  [ -d "$d" ] && ls "$d" 2>/dev/null | tr '\n' ' ' | sed "s|^|  $d: |" && echo
done
echo "== a chromium binary anywhere obvious? =="
for b in chromium chromium-browser google-chrome google-chrome-stable; do
  command -v "$b" >/dev/null 2>&1 && echo "  found: $(command -v $b)"
done
ls /opt/pw-browsers 2>/dev/null | sed 's/^/  \/opt\/pw-browsers: /' || echo "  (no /opt/pw-browsers)"
echo "== deployed app reachable locally? =="
curl -sS -m 8 -o /dev/null -w "  127.0.0.1:8093/api/healthz -> HTTP %{http_code}\n" http://127.0.0.1:8093/api/healthz
curl -sS -m 8 -o /dev/null -w "  127.0.0.1:8093/trading.html -> HTTP %{http_code}\n" http://127.0.0.1:8093/trading.html
echo "(read-only)"
