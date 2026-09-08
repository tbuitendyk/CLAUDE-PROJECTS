#!/usr/bin/env bash
# cert-mail-issue.sh -- ISSUES THE MAIL CERT AND SWITCHES iRedMail ONTO IT.
# Signed off in-session. Idempotent. Run cert-mail-setup.sh first.
#
# Replaces iRedMail's stock self-signed cert (C=CN/GuangDong, valid to 2033)
# with a real Let's Encrypt one for mail.homeandofficemicro.com and the apex
# homeandofficemicro.com -- the apex is included because the host's SNI stream
# map routes it here via `default`.
#
# www.homeandofficemicro.com is deliberately EXCLUDED: it has no DNS A record,
# and one unresolvable name fails the entire issuance.
#
# Rather than edit ssl.tmpl, Postfix and Dovecot separately -- which an
# iRedMail upgrade can overwrite -- this points iRedMail's expected paths at
# the Let's Encrypt files with symlinks, upstream's own recommendation. All
# three services already read /etc/ssl/certs/iRedMail.crt and
# /etc/ssl/private/iRedMail.key, so one pair of symlinks moves everything.
set -euo pipefail

G=192.168.56.129
K=/root/.ssh/id_mailcert
S="ssh -i $K -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@$G"

echo "== 0. re-verify challenge path =="
fail=0
for h in mail.homeandofficemicro.com homeandofficemicro.com; do
  r=$(curl -skL --max-time 25 "http://$h/.well-known/acme-challenge/probe" 2>/dev/null | head -1)
  [ "$r" = "mail-acme-ok" ] || { echo "   $h NOT serving challenge"; fail=1; }
done
[ "$fail" -eq 0 ] || { echo "ABORT -- nothing requested."; exit 1; }
echo "   both hostnames OK"

echo
echo "== 1-5. issue + install (inside the guest) =="
$S 'bash -s' <<'REMOTE'
set -euo pipefail
NAME=mail.homeandofficemicro.com
WR=/var/www/letsencrypt
LIVE=/etc/letsencrypt/live/$NAME

echo "-- dry run (staging, no rate-limit cost) --"
if certbot certonly --webroot -w "$WR" --cert-name "$NAME" \
     -d mail.homeandofficemicro.com -d homeandofficemicro.com \
     --non-interactive --agree-tos --register-unsafely-without-email \
     --dry-run >/tmp/mail-dry.log 2>&1; then
  echo "   dry-run OK"
else
  echo "   dry-run FAILED"; tail -15 /tmp/mail-dry.log | sed 's/^/     /'; exit 1
fi

echo "-- real issuance --"
if certbot certonly --webroot -w "$WR" --cert-name "$NAME" \
     -d mail.homeandofficemicro.com -d homeandofficemicro.com \
     --non-interactive --agree-tos --register-unsafely-without-email \
     >/tmp/mail-real.log 2>&1; then
  echo "   issued"
else
  echo "   issuance FAILED"; tail -15 /tmp/mail-real.log | sed 's/^/     /'; exit 1
fi

echo "-- permissions so Postfix/Dovecot can read the key --"
chmod 0755 /etc/letsencrypt/live /etc/letsencrypt/archive
echo "   chmod 0755 on live/ and archive/"

echo "-- back up the stock cert, then symlink iRedMail's paths --"
BK=/root/mail-cert-backup/certs-$(date +%Y%m%d-%H%M%S); mkdir -p "$BK"
for f in /etc/ssl/certs/iRedMail.crt /etc/ssl/private/iRedMail.key; do
  [ -L "$f" ] || cp -a "$f" "$BK/" 2>/dev/null || true
done
ln -sfn "$LIVE/fullchain.pem" /etc/ssl/certs/iRedMail.crt
ln -sfn "$LIVE/privkey.pem"   /etc/ssl/private/iRedMail.key
ls -l /etc/ssl/certs/iRedMail.crt /etc/ssl/private/iRedMail.key | sed 's/^/   /'
echo "   originals in $BK"

echo "-- renewal deploy hook (nginx + postfix + dovecot) --"
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-mail.sh <<'HOOK'
#!/bin/sh
# Without this, renewal writes new files and the running services keep serving
# the old certificate until someone restarts them by hand.
set -e
chmod 0755 /etc/letsencrypt/live /etc/letsencrypt/archive 2>/dev/null || true
if nginx -t >/dev/null 2>&1; then systemctl reload nginx; fi
systemctl restart postfix dovecot 2>/dev/null || true
logger -t certbot-deploy "reloaded mail services for ${RENEWED_DOMAINS:-unknown}"
HOOK
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-mail.sh
echo "   hook installed"

echo "-- make sure unattended renewal is armed --"
systemctl enable --now certbot.timer >/dev/null 2>&1 || true
echo "   certbot.timer: $(systemctl is-enabled certbot.timer 2>/dev/null)/$(systemctl is-active certbot.timer 2>/dev/null)"

echo "-- apply now --"
nginx -t >/dev/null 2>&1 && systemctl reload nginx && echo "   nginx reloaded"
systemctl restart postfix dovecot && echo "   postfix + dovecot restarted"

echo "-- prove unattended renewal works --"
if certbot renew --dry-run >/tmp/mail-renew.log 2>&1; then
  echo "   certbot renew --dry-run: PASS"
else
  echo "   certbot renew --dry-run: FAIL"; grep -iE "error|failed" /tmp/mail-renew.log | tail -8 | sed 's/^/     /'
fi
REMOTE

echo
echo "== 6. external verification =="
sleep 5
for h in mail.homeandofficemicro.com homeandofficemicro.com; do
  out=$(echo | timeout 25 openssl s_client -servername "$h" -connect "$h:443" 2>&1)
  cn=$(echo "$out" | openssl x509 -noout -subject 2>/dev/null | sed 's/.*CN *= *//' | cut -d, -f1)
  na=$(echo "$out" | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  vr=$(echo "$out" | grep -m1 "Verify return code" | sed 's/.*code: //')
  printf "   %-32s CN=%-30s %-22s %s\n" "$h" "${cn:-?}" "${na:-?}" "${vr:-?}"
done

echo
echo "== 7. SMTP/IMAP now on the same cert? =="
for spec in "25:smtp" "587:smtp" "993:"; do
  p=${spec%%:*}; proto=${spec##*:}
  if [ -n "$proto" ]; then
    o=$(echo | timeout 12 openssl s_client -starttls "$proto" -connect 192.168.56.129:$p 2>/dev/null)
  else
    o=$(echo | timeout 12 openssl s_client -connect 192.168.56.129:$p 2>/dev/null)
  fi
  cn=$(echo "$o" | openssl x509 -noout -subject 2>/dev/null | sed 's/.*CN *= *//' | cut -d, -f1)
  printf "   port %-4s CN=%s\n" "$p" "${cn:-unreadable}"
done

echo
echo "DONE."
