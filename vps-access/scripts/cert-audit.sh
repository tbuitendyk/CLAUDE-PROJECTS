#!/usr/bin/env bash
# cert-audit.sh -- READ-ONLY. Changes nothing.
#
# Run 2 found the actual root cause: all four renewal confs carry
#   authenticator = manual
# so every unattended renewal dies with "An authentication script must be
# provided with --manual-auth-hook when using the manual plugin
# non-interactively" -- certbot fails before it ever makes an HTTP request.
# The certs were issued by hand with `certbot --manual` and were never going
# to renew on their own.
#
# The fix is to move them to the webroot authenticator, which needs the ACME
# challenge path served over :80 -- and `acme-challenge` currently appears
# nowhere in /etc/nginx. This run dumps the real :80 vhost structure so the
# challenge location can be placed correctly the first time.
set -euo pipefail

hr(){ echo; echo "===== $* ====="; }

hr "1. sites-enabled inventory"
ls -l /etc/nginx/sites-enabled/ 2>/dev/null || true
echo "NOTE: nginx loads EVERY file in sites-enabled regardless of extension,"
echo "      so a .before-svc.* backup there is live config, not an inert copy."

hr "2. every 'listen' line, by file"
for f in /etc/nginx/sites-enabled/*; do
  [ -f "$f" ] || continue
  echo "--- $(basename "$f")"
  grep -nE "listen|server_name" "$f" 2>/dev/null | cut -c1-120 | head -18 || true
done

hr "3. redirects and auth, by file"
for f in /etc/nginx/sites-enabled/*; do
  [ -f "$f" ] || continue
  echo "--- $(basename "$f")"
  grep -nE "return[[:space:]]+30|rewrite|auth_basic|root[[:space:]]|location" "$f" 2>/dev/null \
    | cut -c1-120 | head -18 || true
done

hr "4. the :80 vhost(s) verbatim (first 60 lines of each file containing listen 80)"
for f in /etc/nginx/sites-enabled/*; do
  [ -f "$f" ] || continue
  if grep -qE "listen[[:space:]]+(\[::\]:)?80[;[:space:]]" "$f" 2>/dev/null; then
    echo "--- $(basename "$f") ---"
    sed -n '1,60p' "$f" | grep -vE "^\s*#" | grep -vE "^\s*$" | cut -c1-130 || true
  fi
done

hr "5. SNI stream map on 443"
awk '/stream[[:space:]]*\{/,0' /etc/nginx/nginx.conf 2>/dev/null \
  | grep -E "map|ssl_preread|buitendyk|homeandofficemicro|127\.0\.0\.1:|listen|default" \
  | cut -c1-120 | head -30 || echo "  (no stream block in nginx.conf)"

hr "6. does anything already serve /var/www/html on :80?"
grep -rn "/var/www/html" /etc/nginx/ 2>/dev/null | cut -c1-140 | head -10 || echo "  none"

hr "7. mail: is iRedMail's nginx separate?"
ls -l /etc/nginx/sites-enabled/ 2>/dev/null | grep -iE "mail|iredmail" || echo "  no mail vhost in sites-enabled"
ls -l /etc/ssl/certs/iRedMail.crt /etc/ssl/private/iRedMail.key 2>/dev/null || echo "  (no iRedMail cert files at default paths)"
grep -rn "ssl_certificate" /etc/nginx/templates/ssl.tmpl 2>/dev/null | cut -c1-120 || echo "  (no /etc/nginx/templates/ssl.tmpl)"

echo
echo "AUDIT COMPLETE -- nothing was modified."
