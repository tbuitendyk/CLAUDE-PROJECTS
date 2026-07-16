#!/usr/bin/env bash
# mail-test.sh [recipient]
#
# Runs BOTH mail tests each time. Sender = support@homeandofficemicro.com.
#
#   INTERNAL: submit DIRECTLY to the real mail server (Postfix in HOMSMAIL03 at
#             192.168.56.129:25 -- NOT the host's local Exim on 127.0.0.1) for
#             local delivery to <recipient>. Verification is real here: unknown
#             addresses get a hard 550. First contact is usually greylisted
#             (4xx) -- the script retries to ride out the window.
#   EXTERNAL: deliver from the host to Port25's reflector; its SPF/DKIM/DMARC
#             report returns to support@ via the public IP -- the inbound
#             routing test. Needs the host's outbound :25 open.
#
# Recipient: bare local-part (domain defaults to homeandofficemicro.com) or a
# full address; default theodore@homeandofficemicro.com.
set -uo pipefail
export RCPT_ARG="${1:-theodore}"
python3 <<'PY'
import os, time, smtplib
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from datetime import datetime, timezone

DOMAIN  = "homeandofficemicro.com"
SENDER  = "support@homeandofficemicro.com"
MAILVM  = "192.168.56.129"                       # real Postfix (host-only iface)
REFLECT = "check-auth@verifier.port25.com"       # public deliverability reflector
arg  = os.environ["RCPT_ARG"].strip()
rcpt = arg if "@" in arg else f"{arg}@{DOMAIN}"
host = os.uname().nodename
ts   = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

def build(to, subj, body):
    m = EmailMessage()
    m["From"] = f"VPS Mail Test <{SENDER}>"; m["To"] = to; m["Reply-To"] = SENDER
    m["Subject"] = subj; m["Date"] = formatdate(localtime=True)
    m["Message-ID"] = make_msgid(domain=host); m.set_content(body)
    return m

# ---------- INTERNAL ----------
print(f"=== INTERNAL: direct to mail server (Postfix @ {MAILVM}:25) ===")
delivered = False
for attempt in range(1, 5):
    try:
        s = smtplib.SMTP(MAILVM, 25, timeout=25); s.ehlo()
        c, r = s.mail(SENDER)
        if c >= 400:
            print(f"  MAIL FROM <{SENDER}> refused: {c} {r.decode(errors='replace')}"); s.close(); break
        c, r = s.rcpt(rcpt); rt = r.decode(errors='replace')
        if c in (250, 251):
            dc, dr = s.data(build(rcpt, f"VPS internal test {ts}",
                     f"Internal test: host {host} -> Postfix {MAILVM} -> {rcpt}\n{ts}\n").as_string())
            print(f"  DELIVERED to <{rcpt}>: {dc} {dr.decode(errors='replace')}"); delivered = True; s.quit(); break
        if 500 <= c < 600:
            print(f"  REJECTED <{rcpt}>: {c} {rt}  (real Postfix rejection -- bad address/sender)"); s.quit(); break
        print(f"  attempt {attempt}: greylisted <{rcpt}> {c} {rt}"); s.quit()
        if attempt < 4:
            print("    waiting 90s for the greylist window ..."); time.sleep(90)
    except Exception as e:
        print(f"  internal error: {e}"); break
if not delivered:
    print("  (not delivered this run -- if greylisted, re-run shortly; the triplet ages out and passes)")

# ---------- EXTERNAL ----------
print("=== EXTERNAL: reflector bounce (routing to public IP) ===")
refhost = REFLECT.split("@", 1)[1]
try:
    s = smtplib.SMTP(refhost, 25, timeout=30); s.ehlo(host)
    c, r = s.mail(SENDER)
    if c >= 400:
        print(f"  MAIL refused by reflector: {c} {r.decode(errors='replace')}")
    else:
        c, r = s.rcpt(REFLECT)
        if c >= 400:
            print(f"  RCPT refused: {c} {r.decode(errors='replace')}")
        else:
            dc, dr = s.data(build(REFLECT, f"VPS external routing test {ts}",
                     f"Round-trip routing test from {host} at {ts}.\nReport returns to {SENDER} via the public IP.\n").as_string())
            print(f"  SENT to {REFLECT}: {dc} {dr.decode(errors='replace')}")
            print(f"  -> watch the {SENDER} inbox for Port25's SPF/DKIM/DMARC report (arrives via your public IP).")
    try: s.quit()
    except Exception: pass
except Exception as e:
    print(f"  external error: {e}  (outbound :25 from the host may be blocked -- would then need the mail server's authenticated relay)")
PY
