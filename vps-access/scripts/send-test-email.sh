#!/usr/bin/env bash
# send-test-email.sh -- send ONE test email to a local mailbox through the mail
# VM's SMTP, from the VPS host, and report the server's response. Read-mostly:
# it delivers a single message to the user's own mailbox, nothing else.
#
# The iRedMail VM is reachable from the host on its host-only interface
# (192.168.56.129) and via the NAT forward; we try a few targets in order.
set -uo pipefail

TO="theodor@homeandofficemicro.com"
FROM="vps-test@homeandofficemicro.com"
TARGETS=("192.168.56.129:25" "127.0.0.1:25" "10.0.2.129:25")

HOST="$(hostname -f 2>/dev/null || hostname)"
TS="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
MSG="$(mktemp)"; SEND="$(mktemp)"
trap 'rm -f "$MSG" "$SEND"' EXIT

cat > "$MSG" <<EOF
From: VPS Deploy Test <$FROM>
To: $TO
Subject: VPS test email -- $TS
Date: $(date -R)
Message-ID: <vps-test-$(date +%s).$$@$HOST>
Content-Type: text/plain; charset=utf-8

This is a test message sent from the VPS host ($HOST) through the mail server,
to confirm mail delivery is working after the recent fixes.

Sent (UTC): $TS
EOF

sent=0
for t in "${TARGETS[@]}"; do
  echo "== trying smtp://$t =="
  cp "$MSG" "$SEND"
  out="$(curl --silent --show-error --connect-timeout 10 --max-time 45 \
        --url "smtp://$t" --mail-from "$FROM" --mail-rcpt "$TO" \
        --upload-file "$SEND" 2>&1)"
  rc=$?
  [ -n "$out" ] && echo "$out"
  if [ $rc -eq 0 ]; then
    echo "SENT: accepted by $t for <$TO>"
    sent=1
    break
  fi
  echo "  no (curl rc=$rc)"
done

[ "$sent" = 1 ] || { echo "ALL SMTP TARGETS FAILED -- mail not sent" >&2; exit 1; }
