#!/usr/bin/env bash
# send-report.sh -- email a version-controlled report as PLAIN TEXT.
#
# Usage:  run-script send-report.sh <report-name>
#         reads vps-access/reports/<report-name>.txt
#
# The FIRST line of the file is the subject; everything after is the body.
# Reports live in git so every email sent is auditable after the fact — the
# body is findings, never secrets. The SMTP password is read from
# /etc/deploy-control/env (same path mail-test.sh uses), never the repo.
#
# The claude-deploy helper installed on this box does NOT forward the endpoint's
# optional argument to the script, so `run-script send-report.sh <name>` arrives
# here with no $1. With no argument this reads reports/NEXT, a one-line file
# naming the report to send. That file is version-controlled like everything
# else, so which report went out stays auditable — no mtime guessing.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${1:-}"
if [ -z "$NAME" ] && [ -f "$HERE/reports/NEXT" ]; then
  NAME="$(tr -d ' \t\r\n' < "$HERE/reports/NEXT")"
fi
[ -n "$NAME" ] || { echo "usage: send-report.sh <report-name>  (or set reports/NEXT)"; exit 1; }
FILE="$HERE/reports/${NAME}.txt"
[ -f "$FILE" ] || { echo "no such report: $FILE"; exit 1; }
export REPORT_FILE="$FILE"
export RCPT="${RCPT:-theodore@homeandofficemicro.com}"
python3 <<'PY'
import os, ssl, smtplib
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

SENDER = "support@homeandofficemicro.com"
MAILVM = "192.168.56.129"
ENVFILE = "/etc/deploy-control/env"
rcpt = os.environ["RCPT"]

raw = open(os.environ["REPORT_FILE"], encoding="utf-8").read().split("\n")
subject = raw[0].strip() or "Classifier report"
body = "\n".join(raw[1:]).lstrip("\n")

pw = None
try:
    for line in open(ENVFILE):
        if line.startswith("SUPPORT_SMTP_PASSWORD="):
            pw = line.split("=", 1)[1].strip(); break
except Exception as e:
    print(f"  cannot read {ENVFILE}: {e}")
if not pw:
    print("  SUPPORT_SMTP_PASSWORD missing — cannot send"); raise SystemExit(2)

m = EmailMessage()
m["From"] = f"Classifier <{SENDER}>"
m["To"] = rcpt
m["Reply-To"] = SENDER
m["Subject"] = subject
m["Date"] = formatdate(localtime=True)
m["Message-ID"] = make_msgid(domain=os.uname().nodename)
m.set_content(body)          # plain text only, by design

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
errs = []
for label, mode in (("587/STARTTLS", "starttls"), ("465/SMTPS", "ssl")):
    try:
        if mode == "starttls":
            s = smtplib.SMTP(MAILVM, 587, timeout=25); s.ehlo(); s.starttls(context=ctx); s.ehlo()
        else:
            s = smtplib.SMTP_SSL(MAILVM, 465, timeout=25, context=ctx); s.ehlo()
        s.login(SENDER, pw); s.send_message(m); s.quit()
        print(f"  SENT via {label} to <{rcpt}>: {subject}")
        break
    except Exception as e:
        errs.append(f"{label}: {e}")
else:
    print("  FAILED on both ports: " + " | ".join(errs)); raise SystemExit(3)
PY
