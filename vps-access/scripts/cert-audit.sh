#!/usr/bin/env bash
# cert-audit.sh -- READ-ONLY. Changes nothing.
#
# Run 3 established the real topology:
#   * No :80 server block exists in sites-enabled -- every vhost listens on
#     127.0.0.1:443x ssl behind the SNI stream proxy. Yet port 80 answers 301
#     from the public internet, so SOMETHING serves it. The webroot
#     authenticator needs :80 to serve /.well-known/acme-challenge/, so this
#     has to be identified before anything is changed.
#   * The stream map's `default` sends everything unmatched -- including
#     mail.homeandofficemicro.com and the apex -- to 192.168.56.129:443, a
#     VirtualBox guest. iRedMail runs in a VM, not on this host, which is why
#     no iRedMail cert or vhost exists here.
#   * sites-enabled has TWO symlinks to the same www.buitendyk.ca.conf
#     (the second named .before-svc.20260824-232951), so it loads twice --
#     the source of the "conflicting server name on 127.0.0.1:4432" warnings.
set -euo pipefail

hr(){ echo; echo "===== $* ====="; }

hr "1. what is actually listening on :80 and :443"
ss -ltnp 2>/dev/null | grep -E ":80 |:443 |:4430|:4431|:4432|:4433" | cut -c1-140 || true

hr "2. every server block nginx has, with its listen + server_name"
# From the fully-resolved config, so it catches blocks defined in nginx.conf
# itself or in conf.d -- not just sites-enabled.
nginx -T 2>/dev/null | grep -nE "^\s*(server|listen|server_name|include)\b" \
  | grep -vE "server_tokens|server_names_hash" | cut -c1-120 | head -70 || true

hr "3. which FILES nginx actually loads"
nginx -T 2>&1 | grep -E "^# configuration file" | cut -c1-120 || true

hr "4. is sites-available/default enabled anywhere?"
grep -rn "sites-enabled\|conf.d" /etc/nginx/nginx.conf 2>/dev/null | cut -c1-120 || true
echo "-- default file, listen lines --"
grep -nE "listen|server_name|root|location" /etc/nginx/sites-available/default 2>/dev/null | cut -c1-110 | head -15 || true

hr "5. the duplicate symlink"
ls -l /etc/nginx/sites-enabled/ | awk '{print $9, $10, $11}'
echo "-- both names point at the same target? --"
readlink -f /etc/nginx/sites-enabled/www.buitendyk.ca.conf 2>/dev/null || true
readlink -f "/etc/nginx/sites-enabled/www.buitendyk.ca.conf.before-svc.20260824-232951" 2>/dev/null || true

hr "6. mail VM reachability (read-only probe)"
echo "-- host route to guest --"
ip -4 addr show 2>/dev/null | grep -E "192\.168\.56|inet " | cut -c1-90 | head -8 || true
echo "-- guest 192.168.56.129 ports --"
for p in 80 443; do
  if timeout 4 bash -c "</dev/tcp/192.168.56.129/$p" 2>/dev/null; then echo "  :$p open"; else echo "  :$p closed/filtered"; fi
done
echo "-- cert the guest serves on 443 --"
timeout 8 openssl s_client -connect 192.168.56.129:443 -servername mail.homeandofficemicro.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates 2>/dev/null | sed 's/^/  /' || echo "  (no cert readable)"

hr "7. can the guest be reached over :80 for a webroot challenge?"
timeout 8 curl -sS -o /dev/null -w "  guest :80 -> HTTP %{http_code}\n" \
  --max-time 6 "http://192.168.56.129/.well-known/acme-challenge/probe" 2>&1 | head -3 || true

echo
echo "AUDIT COMPLETE -- nothing was modified."
