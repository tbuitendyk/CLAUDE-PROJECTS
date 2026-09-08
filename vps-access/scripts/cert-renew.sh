#!/usr/bin/env bash
# cert-renew.sh -- REQUESTS CERTIFICATES. Signed off in-session.
#
# Prerequisite: cert-acme-setup.sh must have reported all hostnames 200.
# This re-verifies that itself and refuses to run otherwise.
#
# All four certs currently carry `authenticator = manual`, which is why every
# unattended renewal has failed since issuance:
#   PluginError('An authentication script must be provided with
#                --manual-auth-hook when using the manual plugin
#                non-interactively.')
# Re-issuing with `certonly --webroot --cert-name <same name>` rewrites each
# renewal conf to the webroot authenticator, so `certbot renew` works from
# then on. That is the actual repair -- the new certificates are a side effect.
#
# Order is deliberate: every cert is dry-run first (staging, no rate-limit
# cost). Only if ALL dry-runs pass does anything real get requested, so a
# misconfigured host can't burn Let's Encrypt's 5-per-week duplicate limit.
set -euo pipefail

WEBROOT=/var/www/letsencrypt
declare -A CERTS=(
  [www.buitendyk.ca]="-d www.buitendyk.ca -d buitendyk.ca"
  [kjv.buitendyk.ca]="-d kjv.buitendyk.ca -d bible.buitendyk.ca -d vp.buitendyk.ca"
  [docs.homeandofficemicro.com]="-d docs.homeandofficemicro.com"
  [deploy.buitendyk.ca]="-d deploy.buitendyk.ca"
)
ORDER=(www.buitendyk.ca kjv.buitendyk.ca docs.homeandofficemicro.com deploy.buitendyk.ca)

echo "== 0. re-verify the challenge path =="
printf 'acme-ok\n' > "$WEBROOT/.well-known/acme-challenge/probe"
fail=0
for h in www.buitendyk.ca buitendyk.ca kjv.buitendyk.ca bible.buitendyk.ca \
         vp.buitendyk.ca docs.homeandofficemicro.com deploy.buitendyk.ca; do
  r=$(curl -skL --max-time 25 "http://$h/.well-known/acme-challenge/probe" 2>/dev/null | head -1)
  [ "$r" = "acme-ok" ] || { echo "   $h NOT serving challenge"; fail=1; }
done
[ "$fail" -eq 0 ] || { echo "ABORT -- challenge path broken; nothing requested."; exit 1; }
echo "   all 7 hostnames OK"

echo
echo "== 1. dry runs (staging -- no rate-limit cost) =="
for name in "${ORDER[@]}"; do
  printf '   %-30s ' "$name"
  if certbot certonly --webroot -w "$WEBROOT" --cert-name "$name" ${CERTS[$name]} \
       --non-interactive --agree-tos --dry-run >/tmp/dry.$name.log 2>&1; then
    echo "dry-run OK"
  else
    echo "dry-run FAILED"
    tail -12 "/tmp/dry.$name.log" | sed 's/^/        /'
    fail=1
  fi
done
[ "$fail" -eq 0 ] || { echo; echo "ABORT -- a dry run failed; no real certificate requested."; exit 1; }

echo
echo "== 2. real issuance =="
for name in "${ORDER[@]}"; do
  printf '   %-30s ' "$name"
  if certbot certonly --webroot -w "$WEBROOT" --cert-name "$name" ${CERTS[$name]} \
       --non-interactive --agree-tos >/tmp/real.$name.log 2>&1; then
    echo "issued"
  else
    echo "FAILED"
    tail -15 "/tmp/real.$name.log" | sed 's/^/        /'
    fail=1
  fi
done

echo
echo "== 3. reload nginx =="
if nginx -t >/dev/null 2>&1; then systemctl reload nginx && echo "   reloaded"; else
  nginx -t 2>&1 | tail -3; echo "   NOT reloaded -- config test failed"; fi

echo
echo "== 4. authenticator now set to =="
grep -H "^authenticator" /etc/letsencrypt/renewal/*.conf 2>/dev/null \
  | sed 's|/etc/letsencrypt/renewal/||' | sed 's/^/   /' || true

echo
echo "== 5. new expiry dates =="
for d in /etc/letsencrypt/live/*/; do
  [ -e "$d/cert.pem" ] || continue
  e=$(openssl x509 -enddate -noout -in "$d/cert.pem" 2>/dev/null | cut -d= -f2) || continue
  days=$(( ( $(date -d "$e" +%s) - $(date +%s) ) / 86400 ))
  printf "   %-32s %s  (%s days)\n" "$(basename "$d")" "$e" "$days"
done

echo
echo "== 6. prove unattended renewal now works =="
systemctl reset-failed certbot.service 2>/dev/null || true
if certbot renew --dry-run >/tmp/renewall.log 2>&1; then
  echo "   certbot renew --dry-run: PASS (all certs)"
else
  echo "   certbot renew --dry-run: FAIL"
  grep -iE "error|failed" /tmp/renewall.log | tail -10 | sed 's/^/     /' || true
  fail=1
fi

echo
[ "$fail" -eq 0 ] && echo "DONE -- certificates renewed and auto-renewal repaired." \
                  || { echo "COMPLETED WITH ERRORS -- see above."; exit 1; }
