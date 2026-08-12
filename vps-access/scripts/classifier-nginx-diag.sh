#!/usr/bin/env bash
# classifier-nginx-diag.sh -- read-only: how does nginx actually serve
# /classifier/ on www.buitendyk.ca? Prints the location block(s), any
# proxy_cache/alias/root directives, and response headers from localhost.
set -uo pipefail
echo "== classifier mentions in nginx config =="
grep -rn -i "classifier" /etc/nginx/ 2>/dev/null | grep -v '\.bak' | head -20
echo
echo "== the location block(s) =="
for f in $(grep -rl -i "classifier" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | sort -u); do
  echo "--- $f ---"
  awk '/location[^{]*classifier/{flag=1} flag{print} flag&&/^[[:space:]]*}/{if (--depth<=0 && started) {flag=0;started=0}} /location[^{]*classifier/{depth=1;started=1}' "$f" 2>/dev/null | head -30
done
echo
echo "== cache/expires directives anywhere in those files =="
for f in $(grep -rl -i "classifier" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | sort -u); do
  grep -n -E "proxy_cache|expires|add_header.*Cache|proxy_ignore_headers" "$f" | head -10
done
echo
echo "== headers via nginx (localhost, Host spoofed; 401 expected without auth) =="
curl -skI --max-time 10 -H "Host: www.buitendyk.ca" https://127.0.0.1/classifier/help-bracket.html | head -15
