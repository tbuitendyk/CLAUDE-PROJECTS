#!/usr/bin/env bash
# mail-test.sh -- run both mail tests: authenticated internal send + external Port25 routing.
# Usage: mail-test.sh [recipient]
#
# Runs BOTH mail tests each time. Sender = support@homeandofficemicro.com.
#
#   INTERNAL: AUTHENTICATED submission to the real mail server (Postfix in
#             HOMSMAIL03 at 192.168.56.129, submission 587/465) as support@,
#             delivering to <recipient>. Auth is required: the server refuses to
#             send AS a local user without it (anti-spoofing). The password is
#             read from SUPPORT_SMTP_PASSWORD in /etc/deploy-control/env -- NEVER
#             the repo. Real verification: unknown recipients get a hard 5xx.
#   EXTERNAL: deliver from the host to Port25's reflector; its SPF/DKIM/DMARC
#             report returns to support@ via the public IP -- the inbound test.
#
# Recipient: bare local-part (domain defaults to homeandofficemicro.com) or a
# full address; default theodore@homeandofficemicro.com.
set -uo pipefail
export RCPT_ARG="${1:-theodore}"
python3 <<'PY'
import os, ssl, smtplib
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from datetime import datetime, timezone

DOMAIN  = "homeandofficemicro.com"
SENDER  = "support@homeandofficemicro.com"
MAILVM  = "192.168.56.129"
REFLECT = "check-auth@verifier.port25.com"
ENVFILE = "/etc/deploy-control/env"
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

def read_pw():
    try:
        with open(ENVFILE) as f:
            for line in f:
                if line.startswith("SUPPORT_SMTP_PASSWORD="):
                    return line.split("=", 1)[1].strip()
    except Exception as e:
        print(f"  could not read {ENVFILE}: {e}")
    return None

# ---------- INTERNAL (authenticated submission) ----------
print(f"=== INTERNAL: authenticated submission as {SENDER} -> {rcpt} ===")
pw = read_pw()
if not pw:
    print(f"  SUPPORT_SMTP_PASSWORD not set in {ENVFILE} -- add it (root), then re-run.")
else:
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    msg = build(rcpt, f"VPS internal test {ts}",
                f"Authenticated internal test: {SENDER} -> {rcpt} via {MAILVM}\n{ts}\n")
    errs = []
    for label, opener in (("587/STARTTLS", "starttls"), ("465/SMTPS", "ssl")):
        try:
            if opener == "starttls":
                s = smtplib.SMTP(MAILVM, 587, timeout=25); s.ehlo(); s.starttls(context=ctx); s.ehlo()
            else:
                s = smtplib.SMTP_SSL(MAILVM, 465, timeout=25, context=ctx); s.ehlo()
            s.login(SENDER, pw)
            s.send_message(msg)
            s.quit()
            print(f"  DELIVERED (authenticated via {label}) to <{rcpt}>")
            break
        except smtplib.SMTPAuthenticationError as e:
            print(f"  AUTH FAILED for {SENDER} on {label}: {e}"); break
        except Exception as e:
            errs.append(f"{label}: {e}")
    else:
        print("  submission failed on both ports: " + " | ".join(errs))

# ---------- EXTERNAL (reflector bounce) ----------
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
            print(f"  -> watch the {SENDER} inbox for Port25's report (arrives via your public IP).")
    try: s.quit()
    except Exception: pass
except Exception as e:
    print(f"  external error: {e}")
PY
