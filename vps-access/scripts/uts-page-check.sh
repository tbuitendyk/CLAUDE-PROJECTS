#!/usr/bin/env bash
# uts-page-check.sh -- READ-ONLY. Does the Construct page come back, and how
# fast, asked of the service directly and then through nginx the way a browser
# asks. Fetches nothing that streams the recorded rows, so it cannot itself be
# the thing that blocks the box. Changes nothing.
set -uo pipefail
echo "== straight at the service on 127.0.0.1:8094 =="
for P in /construct.html /api/batches /api/jobs; do
  printf '  %-18s -> ' "$P"
  curl -s -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 20 "http://127.0.0.1:8094$P" || echo 'no answer in 20s'
done
echo "== through nginx, the way the browser asks =="
for U in https://buitendyk.ca/uts/construct.html https://buitendyk.ca/uts/api/batches; do
  printf '  %-42s -> ' "${U#https://buitendyk.ca}"
  curl -s -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 30 "$U" || echo 'no answer in 30s'
done
echo "== nginx read timeout for this app =="
grep -rhoE 'proxy_read_timeout[^;]*;' /etc/nginx/sites-enabled/ 2>/dev/null | sort -u | sed 's/^/  /'
grep -rl '8094' /etc/nginx/sites-enabled/ 2>/dev/null | sed 's/^/  configured in: /'
