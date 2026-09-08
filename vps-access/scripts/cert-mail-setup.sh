#!/usr/bin/env bash
# cert-mail-setup.sh -- CHANGES THE MAIL GUEST. Signed off in-session.
# Idempotent. Installs certbot + the ACME challenge path. Requests NO cert.
#
# Topology recap: the guest owns public :80 (VBoxNetNAT forward) and public
# :443 (the host stream map's `default` route) for mail.homeandofficemicro.com
# and the apex. Its :80 block is `server_name _; return 301 https://...` at
# SERVER level, and nginx runs server-context rewrites before location
# selection -- so a location added there is unreachable. Rather than
# restructure iRedMail's shipped config, this uses the same approach proven on
# the host: let the :80 redirect bounce the challenge to :443 (it preserves
# host and path) and answer it from the :443 vhost. Let's Encrypt follows up
# to 10 redirects and does not validate certificates on the way, so the
# guest's self-signed cert does not block it.
#
# Also hardens the automation key with a from= restriction, which was left off
# the line the operator pasted to avoid quoting corruption.
set -euo pipefail

G=192.168.56.129
K=/root/.ssh/id_mailcert
S="ssh -i $K -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@$G"
PUB=$(cut -d' ' -f1,2 "$K.pub")

echo "== 0. access =="
$S 'echo "   in as $(id -un)@$(hostname -f)"'

echo
echo "== 1. harden the automation key (from= restriction) =="
$S "PUB='$PUB'; AK=/root/.ssh/authorized_keys
 cp -a \$AK \$AK.bak.\$(date +%Y%m%d-%H%M%S)
 if grep -q 'from=\"192.168.56.1\".*mailcert-automation' \$AK; then
   echo '   already restricted'
 else
   # rewrite only our automation line, leave every other key untouched
   awk -v pub=\"\$PUB\" '
     index(\$0, pub) && \$0 !~ /^from=/ { print \"from=\\\"192.168.56.1\\\" \" \$0; next }
     { print }' \$AK > \$AK.new && mv \$AK.new \$AK
   chmod 600 \$AK
   echo '   restricted to 192.168.56.1'
 fi
 grep -c mailcert-automation \$AK | sed 's/^/   automation key lines: /'"

echo
echo "== 2. certbot in the guest =="
$S 'if command -v certbot >/dev/null 2>&1; then
      echo "   already installed: $(certbot --version 2>&1)"
    else
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq >/dev/null 2>&1
      apt-get install -y -qq --no-install-recommends certbot >/dev/null 2>&1
      echo "   installed: $(certbot --version 2>&1)"
    fi'

echo
echo "== 3. webroot =="
$S 'install -d -m 755 /var/www/letsencrypt/.well-known/acme-challenge
    printf "mail-acme-ok\n" > /var/www/letsencrypt/.well-known/acme-challenge/probe
    chmod 644 /var/www/letsencrypt/.well-known/acme-challenge/probe
    chown -R www-data:www-data /var/www/letsencrypt 2>/dev/null || true
    echo "   /var/www/letsencrypt ready"'

echo
echo "== 4. acme snippet + include in the :443 vhost =="
$S 'install -d -m 755 /etc/nginx/snippets
cat > /etc/nginx/snippets/acme-challenge.conf <<'"'"'EOF'"'"'
# ACME HTTP-01 challenge. The :80 block returns 301 at server level, so the
# challenge arrives here on :443 after the redirect -- LE follows redirects and
# does not validate certs on the way, so the self-signed cert is not a problem.
location ^~ /.well-known/acme-challenge/ {
    auth_basic off;
    allow all;
    default_type "text/plain";
    root /var/www/letsencrypt;
    try_files $uri =404;
    access_log off;
}
EOF
echo "   wrote /etc/nginx/snippets/acme-challenge.conf"

BK=/root/mail-cert-backup/$(date +%Y%m%d-%H%M%S); mkdir -p "$BK"
for f in /etc/nginx/sites-enabled/00-default-ssl.conf /etc/nginx/sites-enabled/00-default.conf; do
  [ -f "$f" ] || continue
  cp -a "$f" "$BK/$(basename "$f")"
  if grep -q "acme-challenge.conf" "$f"; then
    echo "   $(basename "$f"): already included"
  else
    awk "{ print; if (\$1==\"server_name\") { match(\$0,/^[[:space:]]*/)
             printf \"%sinclude /etc/nginx/snippets/acme-challenge.conf;\n\", substr(\$0,1,RLENGTH) } }" \
        "$f" > "$f.new" && mv "$f.new" "$f"
    echo "   $(basename "$f"): added $(grep -c acme-challenge.conf "$f") include(s)"
  fi
done
echo "   backups in $BK"'

echo
echo "== 5. nginx -t and reload (rollback on failure) =="
$S 'if nginx -t 2>&1 | tail -2; then
      systemctl reload nginx && echo "   reloaded"
    else
      echo "   !! nginx -t FAILED -- restoring"
      BK=$(ls -1d /root/mail-cert-backup/* | tail -1)
      cp -a "$BK"/*.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
      nginx -t 2>&1 | tail -2
      exit 1
    fi'

echo
echo "== 6. end-to-end probe over the REAL public URL =="
sleep 5
fail=0
for h in mail.homeandofficemicro.com homeandofficemicro.com; do
  ok=0
  for a in 1 2 3 4; do
    r=$(curl -skL --max-time 25 "http://$h/.well-known/acme-challenge/probe" 2>/dev/null | head -1)
    [ "$r" = "mail-acme-ok" ] && { ok=1; break; }
    sleep 3
  done
  if [ "$ok" = 1 ]; then printf "   %-32s OK\n" "$h"
  else printf "   %-32s FAIL (got: %.30s)\n" "$h" "${r:-nothing}"; fail=1; fi
done

echo
[ "$fail" -eq 0 ] && echo "READY -- challenge path works. Safe to run cert-mail-issue.sh." \
                  || { echo "NOT READY -- no certificate requested."; exit 1; }
