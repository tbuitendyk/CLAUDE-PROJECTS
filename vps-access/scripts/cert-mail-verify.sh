#!/usr/bin/env bash
# cert-mail-verify.sh -- verifies the mail cert reached EVERY service, and
# extends the host watchdog to cover the mail hostnames.
#
# HTTPS was already confirmed good externally. This checks the part that
# matters to mail clients: Postfix and Dovecot present the new certificate on
# SMTP/IMAP/POP too. They read /etc/ssl/certs/iRedMail.crt, now a symlink to
# the Let's Encrypt fullchain, but a service that failed to reload would still
# be serving the old self-signed cert in memory -- exactly the failure mode the
# deploy hook exists to prevent, so it is worth proving rather than assuming.
#
# Probes run INSIDE the guest against localhost: the mail ports are not
# necessarily reachable from the host, and what the daemon serves is the
# question anyway.
#
# The host watchdog only walks the host's /etc/letsencrypt/live, so the mail
# cert (which lives in the guest) would be invisible to it. Rather than teach
# it to SSH, this adds the two mail hostnames to its network-based check --
# that works wherever the cert actually lives.
set -euo pipefail

G=192.168.56.129
K=/root/.ssh/id_mailcert
S="ssh -i $K -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@$G"

echo "== 1. what each mail service presents (probed inside the guest) =="
$S 'bash -s' <<'REMOTE'
set -uo pipefail
check(){
  port=$1; proto=${2:-}
  if [ -n "$proto" ]; then
    o=$(echo | timeout 10 openssl s_client -starttls "$proto" -connect 127.0.0.1:$port 2>/dev/null)
  else
    o=$(echo | timeout 10 openssl s_client -connect 127.0.0.1:$port 2>/dev/null)
  fi
  cn=$(echo "$o" | openssl x509 -noout -subject 2>/dev/null | sed 's/.*CN *= *//' | cut -d, -f1)
  na=$(echo "$o" | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  iss=$(echo "$o" | openssl x509 -noout -issuer 2>/dev/null | sed 's/.*CN *= *//' | cut -d, -f1)
  printf "   %-5s %-14s CN=%-32s issuer=%-14s %s\n" "$port" "${proto:-implicit}" "${cn:-unreadable}" "${iss:-?}" "${na:-}"
}
check 25  smtp
check 587 smtp
check 465
check 143 imap
check 993
check 995
echo
echo "   -- symlink targets --"
ls -l /etc/ssl/certs/iRedMail.crt /etc/ssl/private/iRedMail.key | sed 's/^/   /'
echo "   -- cert on disk --"
openssl x509 -noout -subject -enddate -ext subjectAltName -in /etc/letsencrypt/live/mail.homeandofficemicro.com/fullchain.pem 2>/dev/null | sed 's/^/   /'
REMOTE

echo
echo "== 2. extend the host watchdog to cover the mail hostnames =="
W=/usr/local/sbin/cert-expiry-watch
if grep -q "MAIL_HOSTS" "$W" 2>/dev/null; then
  echo "   already extended"
else
  cp -a "$W" "$W.bak.$(date +%Y%m%d-%H%M%S)"
  # Insert a network-based check for hostnames whose cert does not live on this
  # host, just before the report is printed.
  python3 - "$W" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
block = '''
# Hostnames whose certificate lives elsewhere (the mail guest), so there is no
# /etc/letsencrypt/live entry here to walk. Checked over the network instead.
MAIL_HOSTS="mail.homeandofficemicro.com homeandofficemicro.com"
for h in $MAIL_HOSTS; do
  se=$(echo | timeout 15 openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null \\
        | openssl x509 -enddate -noout 2>/dev/null | cut -d= -f2)
  if [ -z "$se" ]; then
    problems="${problems}- $h: could not read its certificate\\n"
    report="${report}  $(printf '%-32s UNREACHABLE' "$h")\\n"
    continue
  fi
  sd=$(( ( $(date -d "$se" +%s) - $(date +%s) ) / 86400 ))
  report="${report}  $(printf '%-32s served=%sd (remote)' "$h" "$sd")\\n"
  if [ "$sd" -lt "$THRESHOLD" ]; then
    problems="${problems}- $h expires in $sd days\\n"
  fi
done

'''
anchor = 'printf "cert status:\\n$report"'
if anchor in s:
    s = s.replace(anchor, block + anchor, 1)
    open(p, 'w').write(s)
    print("   inserted mail-host check")
else:
    print("   ANCHOR NOT FOUND - watchdog left unchanged")
PY
fi
chmod 755 "$W"

echo
echo "== 3. watchdog run with mail included =="
"$W" --report 2>&1 | sed 's/^/   /'

echo
echo "DONE."
