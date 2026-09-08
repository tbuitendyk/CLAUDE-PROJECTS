#!/usr/bin/env bash
# cert-audit.sh -- READ-ONLY. Changes nothing.
#
# Four Let's Encrypt certs on this box lapsed in 2026 (kjv Aug 13, docs Aug 17,
# www Sep 5, deploy Sep 8), so renewal has been failing for months rather than
# a one-off slipping. This dumps the state needed to fix it properly: what
# certbot manages, which authenticator each cert uses, whether the renewal
# timer runs, the real failure from the logs, and how the :80 vhosts handle the
# ACME challenge path.
#
# Output is capped ~8 KB by the endpoint, so each section is trimmed and the
# most decisive ones (renewal confs, log errors, ACME handling) come last.
set -euo pipefail

echo "===== 1. certbot inventory ====="
certbot certificates 2>&1 | grep -vE "^\s*$" | head -50 || echo "certbot not installed?"

echo
echo "===== 2. renewal timer ====="
systemctl list-timers --all 2>/dev/null | grep -iE "certbot|NEXT" | head -5 || true
for u in certbot.timer certbot.service snap.certbot.renew.timer; do
  s=$(systemctl is-enabled "$u" 2>/dev/null || echo "-")
  a=$(systemctl is-active "$u" 2>/dev/null || echo "-")
  echo "  $u enabled=$s active=$a"
done
echo "-- cron --"
ls -1 /etc/cron.d/ 2>/dev/null | grep -i certbot || echo "  (no certbot cron.d entry)"

echo
echo "===== 3. nginx :80 handling of ACME (the decisive bit) ====="
# server-level `return 301` runs before location selection and swallows the
# challenge; a location-level one does not. Show which each :80 block uses.
nginx -T 2>/dev/null | awk '
  /^[[:space:]]*server[[:space:]]*\{/ { depth=1; buf=""; inblock=1 }
  inblock {
    buf = buf $0 "\n"
    n=gsub(/\{/,"{"); m=gsub(/\}/,"}")
    depth += n - m
    if (depth <= 0) {
      if (buf ~ /listen[^;]*80[^0-9]/ || buf ~ /listen[[:space:]]+80;/) print buf "----8<----"
      inblock=0
    }
  }
' | grep -nE "server_name|listen|return 30|rewrite|acme-challenge|auth_basic|root |include |----8<----" | head -60

echo
echo "===== 4. webroots / acme snippet present? ====="
ls -ld /var/www/letsencrypt /var/www/html /var/www/certbot 2>/dev/null || true
grep -rl "acme-challenge" /etc/nginx/ 2>/dev/null | head -10 || echo "  NO acme-challenge block anywhere in /etc/nginx"

echo
echo "===== 5. SNI stream map (443) ====="
nginx -T 2>/dev/null | grep -A25 "ssl_preread_server_name" | grep -E "buitendyk|homeandofficemicro|deploy|127\.0\.0\.1|map|\}" | head -25

echo
echo "===== 6. renewal confs: authenticator per cert ====="
for f in /etc/letsencrypt/renewal/*.conf; do
  [ -e "$f" ] || { echo "  (none)"; break; }
  echo "--- $(basename "$f")"
  grep -E "^(authenticator|webroot_path|installer|server)\s*=" "$f" 2>/dev/null | sed 's/^/    /'
  awk '/\[\[webroot_map\]\]/{f=1;next} f&&NF{print "    map: "$0}' "$f" 2>/dev/null | head -4
done

echo
echo "===== 7. last renewal failures ====="
grep -iE "error|failed|problem|urn:ietf" /var/log/letsencrypt/letsencrypt.log 2>/dev/null | tail -20 \
  || echo "  (no letsencrypt.log or no errors in it)"

echo
echo "===== 8. live expiry summary ====="
for d in /etc/letsencrypt/live/*/; do
  [ -e "$d/cert.pem" ] || continue
  n=$(basename "$d")
  e=$(openssl x509 -enddate -noout -in "$d/cert.pem" 2>/dev/null | cut -d= -f2)
  days=$(( ( $(date -d "$e" +%s) - $(date +%s) ) / 86400 ))
  printf "  %-34s %s  (%s days)\n" "$n" "$e" "$days"
done

echo
echo "AUDIT COMPLETE -- nothing was modified."
