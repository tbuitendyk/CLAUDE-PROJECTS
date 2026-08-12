#!/usr/bin/env bash
# classifier-nginx-diag.sh -- read-only: print the /classifier/ location block
# and probe the real vhost (SNI via --resolve). 401-without-auth is expected;
# what matters is which vhost answers and any cache headers.
set -uo pipefail
CONF=/etc/nginx/sites-available/www.buitendyk.ca.conf
echo "== /classifier/ block in $CONF =="
sed -n '155,200p' "$CONF"
echo "== probe with proper SNI (auth not supplied; expect 401) =="
curl -skI --max-time 10 --resolve www.buitendyk.ca:443:127.0.0.1 https://www.buitendyk.ca/classifier/help-bracket.html | head -12
