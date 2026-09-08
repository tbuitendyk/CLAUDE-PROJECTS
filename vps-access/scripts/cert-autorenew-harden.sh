#!/usr/bin/env bash
# cert-autorenew-harden.sh -- INSTALLS A DEPLOY HOOK AND A WATCHDOG TIMER.
# Signed off in-session. Idempotent: safe to re-run.
#
# The certs were moved off authenticator=manual to webroot, so `certbot renew`
# now succeeds. Two gaps remain:
#
#   1. NOTHING RELOADS NGINX. `certonly --webroot` writes new files but does not
#      touch the running server, so at the ~60-day renewal nginx would keep
#      serving the OLD certificate from memory and start serving an EXPIRED one
#      while `certbot certificates` reported everything healthy. A deploy hook
#      fixes this; it runs only when a certificate actually renews.
#
#   2. NOTHING WAS WATCHING. Renewal failed every day for months in silence.
#      The watchdog emails if any cert drops under the threshold, if
#      certbot.service is failed, or -- the case that motivated it -- if the
#      certificate nginx is SERVING is older than the one on disk, which is the
#      exact signature of a renewal that succeeded but never took effect.
set -euo pipefail

THRESHOLD_DAYS=21
RCPT="${RCPT:-theodore@homeandofficemicro.com}"
HOOK=/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
WATCH=/usr/local/sbin/cert-expiry-watch

echo "== 1. deploy hook =="
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > "$HOOK" <<'EOF'
#!/bin/sh
# Installed by cert-autorenew-harden.sh. Runs ONLY when a cert actually renews.
# Without this, certonly --webroot renews the files and nginx keeps serving the
# old certificate until someone reloads by hand.
set -e
if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    logger -t certbot-deploy "reloaded nginx for ${RENEWED_DOMAINS:-unknown}"
else
    logger -t certbot-deploy "NGINX CONFIG TEST FAILED - not reloading"
    exit 1
fi
EOF
chmod 755 "$HOOK"
echo "   installed $HOOK"

echo
echo "== 2. watchdog =="
cat > "$WATCH" <<WEOF
#!/usr/bin/env bash
# Installed by cert-autorenew-harden.sh. Read-only; emails only on a problem.
# Run with --report to print status and always email (used for verification).
set -uo pipefail
THRESHOLD=$THRESHOLD_DAYS
RCPT="\${RCPT:-$RCPT}"
FORCE=0; [ "\${1:-}" = "--report" ] && FORCE=1
problems=""
report=""

# certbot.service state -- this is what sat 'failed' unnoticed for months
if systemctl is-failed --quiet certbot.service; then
  problems="\${problems}- certbot.service is in a FAILED state\n"
fi
if ! systemctl is-active --quiet certbot.timer; then
  problems="\${problems}- certbot.timer is NOT active; renewals will never run\n"
fi

for d in /etc/letsencrypt/live/*/; do
  [ -e "\$d/cert.pem" ] || continue
  name=\$(basename "\$d")
  fe=\$(openssl x509 -enddate -noout -in "\$d/cert.pem" 2>/dev/null | cut -d= -f2) || continue
  fdays=\$(( ( \$(date -d "\$fe" +%s) - \$(date +%s) ) / 86400 ))
  # what nginx is actually SERVING for this name, via the public path
  se=\$(echo | timeout 15 openssl s_client -servername "\$name" -connect "\$name:443" 2>/dev/null \\
        | openssl x509 -enddate -noout 2>/dev/null | cut -d= -f2)
  if [ -n "\$se" ]; then
    sdays=\$(( ( \$(date -d "\$se" +%s) - \$(date +%s) ) / 86400 ))
  else
    sdays="?"
  fi
  report="\${report}  \$(printf '%-32s disk=%sd served=%sd' "\$name" "\$fdays" "\$sdays")\n"
  if [ "\$fdays" -lt "\$THRESHOLD" ]; then
    problems="\${problems}- \$name expires in \$fdays days (on disk)\n"
  fi
  # served older than disk => renewed but nginx never reloaded
  if [ "\$sdays" != "?" ] && [ "\$sdays" -lt "\$((fdays - 1))" ]; then
    problems="\${problems}- \$name: nginx is SERVING a cert \$sdays days out while disk has \$fdays -- reload did not happen\n"
  fi
done

printf "cert status:\n\$report"
if [ -z "\$problems" ] && [ "\$FORCE" -eq 0 ]; then
  echo "all good; no mail sent"; exit 0
fi
[ -n "\$problems" ] || problems="- (none; --report run)\n"
printf "PROBLEMS:\n\$problems"

SUBJ="[buitendyk.ca] TLS certificate warning"
[ -z "\$problems" ] && SUBJ="[buitendyk.ca] TLS certificate report"
export MAIL_SUBJ="\$SUBJ" MAIL_RCPT="\$RCPT"
export MAIL_BODY="\$(printf "Certificate watchdog on \$(hostname -f)\n\nPROBLEMS:\n\$problems\nSTATUS:\n\$report\nChecked: \$(date -u)\n")"
python3 <<'PY'
import os, ssl, smtplib
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
SENDER="support@homeandofficemicro.com"; MAILVM="192.168.56.129"; ENV="/etc/deploy-control/env"
pw=None
try:
    for line in open(ENV):
        line=line.strip()
        if line.startswith("SUPPORT_SMTP_PASSWORD"):
            pw=line.split("=",1)[1].strip().strip('"').strip("'")
except Exception as e:
    print("cannot read env:", e)
if not pw:
    print("no SUPPORT_SMTP_PASSWORD; cannot send mail"); raise SystemExit(0)
m=EmailMessage()
m["From"]=SENDER; m["To"]=os.environ["MAIL_RCPT"]; m["Subject"]=os.environ["MAIL_SUBJ"]
m["Date"]=formatdate(localtime=True); m["Message-ID"]=make_msgid(domain="homeandofficemicro.com")
m.set_content(os.environ["MAIL_BODY"])
ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
try:
    with smtplib.SMTP(MAILVM,587,timeout=30) as s:
        s.starttls(context=ctx); s.login(SENDER,pw); s.send_message(m)
    print("mail sent via 587 to", os.environ["MAIL_RCPT"])
except Exception as e1:
    try:
        with smtplib.SMTP_SSL(MAILVM,465,context=ctx,timeout=30) as s:
            s.login(SENDER,pw); s.send_message(m)
        print("mail sent via 465 to", os.environ["MAIL_RCPT"])
    except Exception as e2:
        print("mail FAILED:",e1,"|",e2)
PY
WEOF
chmod 755 "$WATCH"
echo "   installed $WATCH (threshold ${THRESHOLD_DAYS}d, rcpt $RCPT)"

echo
echo "== 3. daily timer =="
cat > /etc/systemd/system/cert-expiry-watch.service <<EOF
[Unit]
Description=TLS certificate expiry / renewal watchdog
After=network-online.target
[Service]
Type=oneshot
ExecStart=$WATCH
EOF
cat > /etc/systemd/system/cert-expiry-watch.timer <<'EOF'
[Unit]
Description=Daily TLS certificate watchdog
[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now cert-expiry-watch.timer >/dev/null 2>&1
echo "   $(systemctl is-enabled cert-expiry-watch.timer) / $(systemctl is-active cert-expiry-watch.timer)"

echo
echo "== 4. verify =="
echo "-- hook is executable and seen by certbot --"
ls -l "$HOOK" | sed 's/^/   /'
echo "-- certbot.timer --"
systemctl is-enabled certbot.timer 2>/dev/null | sed 's/^/   enabled: /'
systemctl is-active  certbot.timer 2>/dev/null | sed 's/^/   active:  /'
systemctl list-timers cert-expiry-watch.timer --no-pager 2>/dev/null | sed -n '2p' | sed 's/^/   /'
echo
echo "-- watchdog dry pass (prints status; emails because of --report) --"
"$WATCH" --report 2>&1 | sed 's/^/   /'

echo
echo "DONE -- deploy hook + daily watchdog installed."
