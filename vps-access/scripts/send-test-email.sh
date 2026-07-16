#!/usr/bin/env bash
# send-test-email.sh [recipient]
#
# Verify a mailbox exists (SMTP RCPT callout -- no message on a failed target),
# then send ONE test email through the mail VM's SMTP from the VPS host. If the
# server says the mailbox is unknown, it does NOT send and reports the spelling
# is wrong. Recipient defaults to theodor@homeandofficemicro.com; pass an
# address as the argument to override (needs the widened arg regex to be live).
set -uo pipefail
export RCPT="${1:-theodor@homeandofficemicro.com}"
python3 <<'PY'
import os, sys, smtplib
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from datetime import datetime, timezone

rcpt    = os.environ["RCPT"]
sender  = "vps-test@homeandofficemicro.com"
targets = [("192.168.56.129", 25), ("127.0.0.1", 25), ("10.0.2.129", 25)]
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
for h, p in targets:
    try:
        s = smtplib.SMTP(h, p, timeout=20)
    except Exception as e:
        print(f"  {h}:{p} unreachable: {e}")
        continue
    try:
        s.ehlo()
        code, resp = s.mail(sender)
        if code >= 400:
            print(f"  {h}:{p}: MAIL FROM refused {code} {resp.decode(errors='replace')}")
            s.close(); continue
        code, resp = s.rcpt(rcpt)
        text = resp.decode(errors='replace')
        if code in (250, 251):
            print(f"  VERIFIED: <{rcpt}> is a valid mailbox ({code} via {h}:{p})")
            dcode, dresp = s.data(message().as_string())
            s.quit()
            print(f"SENT: test email accepted for <{rcpt}> ({dcode} {dresp.decode(errors='replace')})")
            sys.exit(0)
        if 500 <= code < 600:
            print(f"  UNKNOWN MAILBOX: {h}:{p} rejected <{rcpt}> -> {code} {text}")
            print("NOT SENT: that address does not exist on the server -- check the spelling.")
            s.close(); sys.exit(2)
        print(f"  {h}:{p}: deferred {code} {text} (greylist?) -- trying next target")
        s.close()
    except Exception as e:
        print(f"  {h}:{p}: error {e}")
        try: s.close()
        except Exception: pass

print("Could not verify or send on any SMTP target.", file=sys.stderr)
sys.exit(1)
PY
