#!/usr/bin/env bash
# send-test-email.sh [recipient]
#
# Verify a mailbox exists (SMTP RCPT callout) then send ONE test email through
# the mail VM's SMTP from the VPS host. Tries the trusted loopback path first
# (127.0.0.1 -> NAT -> guest, which is in the mail server's mynetworks); the
# host-only iface (192.168.56.129) applies sender restrictions so it's a
# fallback. Only reports "unknown mailbox" when the server rejects the
# RECIPIENT specifically. Recipient is $1 (default theodor@homeandofficemicro.com).
set -uo pipefail
export RCPT="${1:-theodor@homeandofficemicro.com}"
python3 <<'PY'
import os, sys, smtplib
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from datetime import datetime, timezone

rcpt    = os.environ["RCPT"]
sender  = "vps-test@homeandofficemicro.com"
targets = [("127.0.0.1", 25), ("192.168.56.129", 25), ("10.0.2.129", 25)]
ts      = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
host    = os.uname().nodename

def message():
    m = EmailMessage()
    m["From"] = f"VPS Deploy Test <{sender}>"
    m["To"] = rcpt
    m["Subject"] = f"VPS test email -- {ts}"
    m["Date"] = formatdate(localtime=True)
    m["Message-ID"] = make_msgid(domain=host)
    m.set_content(f"Test message from the VPS host ({host}) through the mail server.\n\nSent (UTC): {ts}\n")
    return m

print(f"recipient to verify: {rcpt}")
notes = []
for h, p in targets:
    try:
        s = smtplib.SMTP(h, p, timeout=20)
    except Exception as e:
        notes.append(f"{h}:{p} unreachable: {e}"); continue
    try:
        s.ehlo()
        code, resp = s.mail(sender)
        if code >= 400:
            notes.append(f"{h}:{p} MAIL FROM<{sender}> -> {code} {resp.decode(errors='replace')}")
            s.close(); continue
        code, resp = s.rcpt(rcpt)
        text = resp.decode(errors='replace')
        if code in (250, 251):
            print(f"VERIFIED: <{rcpt}> is a valid mailbox ({code} via {h}:{p})")
            dcode, dresp = s.data(message().as_string()); s.quit()
            print(f"SENT: test email accepted for <{rcpt}> ({dcode} {dresp.decode(errors='replace')})")
            sys.exit(0)
        notes.append(f"{h}:{p} RCPT<{rcpt}> -> {code} {text}")
        s.close()
        # Only a RECIPIENT-specific 5xx means bad spelling.
        low = text.lower()
        if 500 <= code < 600 and "recipient address rejected" in low:
            print(f"NOT SENT: <{rcpt}> is an unknown mailbox -- check the spelling.")
            print("server said:", text)
            sys.exit(2)
    except Exception as e:
        notes.append(f"{h}:{p} error {e}")
        try: s.close()
        except Exception: pass

print("NOT SENT -- no SMTP target accepted the message. Server responses:", file=sys.stderr)
for n in notes:
    print("  " + n, file=sys.stderr)
sys.exit(1)
PY
