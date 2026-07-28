#!/usr/bin/env bash
# claude-mail-send.sh -- send mail AS claude@homeandofficemicro.com to the
# owner. Reads vps-access/outbox/<name>.txt, where <name> comes from
# outbox/NEXT (the installed claude-deploy helper does not forward arguments,
# and a password or a subject line has no business in a URL anyway).
#
# FILE FORMAT, enforced rather than hoped for:
#   line 1  the subject
#   line 2  must start with "tl;dr" (case-insensitive) — the owner asked for
#           one at the top of every email, so a message without one is a bug
#           in the message, not a preference to be ignored. Refused here so it
#           cannot be forgotten at 4am.
#   rest    the body
#
# Every message sent lives in git first, so the record of what was said is the
# repository, not a mailbox that can be tidied.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="${1:-}"
if [ -z "$NAME" ] && [ -f "$HERE/outbox/NEXT" ]; then
  NAME="$(tr -d ' \t\r\n' < "$HERE/outbox/NEXT")"
fi
[ -n "$NAME" ] || { echo "usage: claude-mail-send.sh <name>  (or set outbox/NEXT)"; exit 1; }
FILE="$HERE/outbox/${NAME}.txt"
[ -f "$FILE" ] || { echo "no such message: $FILE"; exit 1; }

if ! sed -n '2p' "$FILE" | grep -qi '^tl;dr'; then
  echo "REFUSED: line 2 of ${NAME}.txt must start with 'tl;dr'."
  echo "  line 1 is the subject; line 2 is the summary the owner asked for."
  exit 2
fi

export MSG_FILE="$FILE"
python3 <<'PY'
import os, ssl, smtplib, time
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

SENDER = "claude@homeandofficemicro.com"
RCPT = "theodore@homeandofficemicro.com"
MAILVM = "192.168.56.129"
ENVFILE = "/etc/deploy-control/env"

raw = open(os.environ["MSG_FILE"], encoding="utf-8").read().split("\n")
subject = raw[0].strip() or "Classifier"
body = "\n".join(raw[1:]).lstrip("\n")

pw = None
try:
    for line in open(ENVFILE):
        if line.startswith("CLAUDE_MAIL_PASSWORD="):
            pw = line.split("=", 1)[1].strip()
            break
except Exception as e:
    print(f"  cannot read {ENVFILE}: {e}")
if not pw:
    print("  CLAUDE_MAIL_PASSWORD not set in /etc/deploy-control/env — cannot send")
    raise SystemExit(2)

m = EmailMessage()
m["From"] = f"Claude <{SENDER}>"
m["To"] = RCPT
m["Reply-To"] = SENDER
m["Subject"] = subject
m["Date"] = formatdate(localtime=True)
m["Message-ID"] = make_msgid(domain="homeandofficemicro.com")
m.set_content(body)   # plain text only, by design

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
errs = []
for label, mode in (("587/STARTTLS", "starttls"), ("465/SMTPS", "ssl")):
    try:
        if mode == "starttls":
            s = smtplib.SMTP(MAILVM, 587, timeout=30); s.ehlo(); s.starttls(context=ctx); s.ehlo()
        else:
            s = smtplib.SMTP_SSL(MAILVM, 465, timeout=30, context=ctx); s.ehlo()
        s.login(SENDER, pw); s.send_message(m); s.quit()
        print(f"  SENT via {label} to <{RCPT}>: {subject}")
        print(f"  message-id: {m['Message-ID']}")
        # Owner's rule: for 1200s after a send, the inbox is polled every
        # minute instead of every five. Stamped here rather than tracked by
        # the caller so the cadence survives a restarted watcher.
        try:
            os.makedirs("/var/lib/claude-mail", exist_ok=True)
            with open("/var/lib/claude-mail/last-sent", "w") as f:
                f.write(str(int(time.time())))
        except Exception as e:
            print(f"  (could not stamp last-sent: {e})")
        break
    except Exception as e:
        errs.append(f"{label}: {e}")
else:
    print("  FAILED on both ports: " + " | ".join(errs)); raise SystemExit(3)
PY
