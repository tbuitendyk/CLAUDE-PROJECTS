#!/usr/bin/env bash
# cert-audit.sh -- READ-ONLY. Changes nothing.
#
# Four Let's Encrypt certs on this box have lapsed (kjv Aug 13, docs Aug 17,
# www Sep 5, deploy Sep 8). Run 1 established that certbot.timer is enabled and
# firing daily but certbot.service is in a `failed` state -- so renewal is being
# attempted and failing, not skipped. This run gets the reason.
#
# Every pipeline is guarded with `|| true`: under `set -euo pipefail` a grep
# that matches nothing returns 1 and aborts the whole audit, which is what
# truncated run 1 at section 3.
set -euo pipefail

hr(){ echo; echo "===== $* ====="; }

hr "1. why certbot.service failed"
systemctl status certbot.service --no-pager -l 2>&1 | tail -20 || true
echo "-- last journal --"
journalctl -u certbot.service --no-pager -n 25 2>&1 | tail -25 || true

hr "2. renewal confs: authenticator per cert"
for f in /etc/letsencrypt/renewal/*.conf; do
  [ -e "$f" ] || { echo "  (none)"; break; }
  echo "--- $(basename "$f")"
  grep -E "^(authenticator|installer|webroot_path|server)[[:space:]]*=" "$f" 2>/dev/null | sed 's/^/    /' || true
  awk '/webroot_map/{f=1;next} f&&NF{print "    map: "$0}' "$f" 2>/dev/null | head -3 || true
done

hr "3. last letsencrypt.log errors"
grep -iE "error|failed|problem|timeout|401|403|404|urn:ietf" /var/log/letsencrypt/letsencrypt.log 2>/dev/null \
  | tail -22 | cut -c1-200 || echo "  (nothing matched)"

hr "4. acme-challenge anywhere in nginx?"
grep -rl "acme-challenge" /etc/nginx/ 2>/dev/null | head -10 || echo "  NONE in /etc/nginx"
echo "-- webroot dirs --"
ls -ld /var/www/letsencrypt /var/www/html /var/www/certbot 2>/dev/null || true

hr "5. :80 server blocks -- server_name + how they redirect"
# Flatten: print each `listen 80` vhost's server_name and any return/rewrite,
# noting whether the redirect sits at server level (fatal for ACME) or inside
# a location (fine).
nginx -T 2>/dev/null | awk '
  /server[[:space:]]*\{/            { inb=1; d=0; buf=""; loc=0 }
  inb                                { buf=buf $0 "\n" }
  inb && /location/                  { loc=1 }
  inb && /return[[:space:]]+30/      { if(!loc) srv_ret=1; else loc_ret=1 }
  inb && /\}/                        { d--; if(d<=0 && buf!=""){
                                          if (buf ~ /listen[[:space:]]+(\[::\]:)?80[;[:space:]]/) {
                                            sn="?"; if (match(buf,/server_name[^;]*/)) sn=substr(buf,RSTART+12,RLENGTH-12)
                                            printf "  %-46s srv_return=%s loc_return=%s acme=%s\n", sn, (srv_ret?"YES(FATAL)":"no"), (loc_ret?"yes":"no"), (buf ~ /acme-challenge/ ? "yes":"NO")
                                          }
                                          inb=0; srv_ret=0; loc_ret=0
                                       } }
  inb && /\{/                        { d++ }
' 2>/dev/null || echo "  (parse failed)"

hr "6. nginx conf files in play"
ls -1 /etc/nginx/sites-enabled/ 2>/dev/null || true

hr "7. live cert expiry"
for d in /etc/letsencrypt/live/*/; do
  [ -e "$d/cert.pem" ] || continue
  e=$(openssl x509 -enddate -noout -in "$d/cert.pem" 2>/dev/null | cut -d= -f2) || continue
  printf "  %-34s %s\n" "$(basename "$d")" "$e"
done

echo
echo "AUDIT COMPLETE -- nothing was modified."
