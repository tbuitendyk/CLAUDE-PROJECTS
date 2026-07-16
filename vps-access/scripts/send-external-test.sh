#!/usr/bin/env bash
# send-external-test.sh [from_mailbox]   -- EXTERNAL routing test
#
# Send a message OUT through the mail server to a public email reflector
# (Port25's check-auth@verifier.port25.com). The reflector emails a
# deliverability report (SPF / DKIM / DMARC / spam score) BACK to the From
# address -- and that reply must route into THIS box's public IP, exercising
# real inbound routing (DNS MX -> public IP -> :25 -> mail VM). You then read
# the report in the From mailbox (manual check).
#
# From defaults to theodor@homeandofficemicro.com (a real mailbox that receives
# the report). Pass a mailbox as the argument to override.
set -uo pipefail
export FROMBOX="${1:-theodor@homeandofficemicro.com}"
python3 <<'PY'
import os, sys, smtplib
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from datetime import datetime, timezone

frm = os.environ["FROMBOX"].strip()
if "@" not in frm:
    frm += "@homeandofficemicro.com"
reflector = "check-auth@verifier.port25.com"   # public deliverability reflector
relay = ("127.0.0.1", 25)                       # trusted loopback -> Postfix relays outbound
host = os.uname().nodename
ts   = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

m = EmailMessage()
m["From"] = frm
m["To"] = reflector
m["Reply-To"] = frm
m["Subject"] = f"VPS external routing test {ts}"
m["Date"] = formatdate(localtime=True)
m["Message-ID"] = make_msgid(domain=host)
m.set_content(f"Round-trip routing test from {host} at {ts}.\n"
              f"The reflector's report should return to {frm} via the public IP.\n")

try:
    s = smtplib.SMTP(relay[0], relay[1], timeout=30)
    s.ehlo()
    code, resp = s.mail(frm)
    if code >= 400:
        print(f"MAIL FROM <{frm}> refused: {code} {resp.decode(errors='replace')}", file=sys.stderr)
        sys.exit(1)
    code, resp = s.rcpt(reflector)
    if code >= 400:
        print(f"RCPT <{reflector}> refused: {code} {resp.decode(errors='replace')} "
              f"(outbound relay blocked from the loopback path?)", file=sys.stderr)
        sys.exit(1)
    dcode, dresp = s.data(m.as_string())
    s.quit()
    print(f"SENT to reflector {reflector} (from {frm}): {dcode} {dresp.decode(errors='replace')}")
    print(f"Now watch the {frm} inbox: Port25 should reply with an SPF/DKIM/DMARC report")
    print("within a minute or two -- its arrival via your public IP IS the inbound-routing test.")
    print("(No report after a few minutes = the reflector is down or inbound routing failed;")
    print(" fall back to a round-trip via an account you control.)")
except Exception as e:
    print(f"external test failed: {e}", file=sys.stderr)
    sys.exit(1)
PY
