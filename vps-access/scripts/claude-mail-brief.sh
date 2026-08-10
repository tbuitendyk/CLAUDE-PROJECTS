#!/usr/bin/env bash
# claude-mail-brief.sh -- HEADERS-ONLY change detector for the mail watcher.
#
# NOT A VERIFICATION TOOL. It performs NO SASL proof, reads NO mail log, and
# prints NO bodies. Its single job is to answer "has the mailbox changed?" in
# a few hundred bytes. Anything that decides whether to ACT on a message must
# still go through claude-mail-recent.sh (read-only, verifies) or
# claude-mail-check.sh (consumes, verifies). Treating this script's output as
# permission to act would be exactly the failure the verification step exists
# to prevent.
#
# WHY IT EXISTS (2026-08-10). The watcher fingerprinted the output of
# claude-mail-recent.sh, which prints up to 120 body lines for each of the last
# eight messages. The deploy endpoint returns only the LAST 8000 characters of
# stdout, so the fingerprint was computed over a truncated tail: the window
# slid whenever any body changed length, producing "mailbox changed" alarms
# with no new mail, and — far worse — a genuinely new message could sit ABOVE
# the cut and never be seen at all. A watcher that can miss the thing it
# watches for is not a watcher.
#
# Output is one line per message, newest last, plus a count. Read-only: uses
# BODY.PEEK for headers so nothing is marked \Seen.
set -uo pipefail

GUEST=192.168.56.129
MBOX=claude@homeandofficemicro.com
ENVFILE=/etc/deploy-control/env
export GUEST MBOX ENVFILE

python3 <<'PY'
import email, imaplib, os, ssl
from email.header import decode_header, make_header

GUEST, MBOX = os.environ["GUEST"], os.environ["MBOX"]

pw = None
try:
    for line in open(os.environ["ENVFILE"]):
        if line.startswith("CLAUDE_MAIL_PASSWORD="):
            pw = line.split("=", 1)[1].strip()
            break
except Exception as e:
    print(f"BRIEF-ERROR cannot read env file: {e}")
    raise SystemExit(1)
if not pw:
    print("BRIEF-ERROR CLAUDE_MAIL_PASSWORD not set")
    raise SystemExit(1)

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
try:
    M = imaplib.IMAP4_SSL(GUEST, 993, ssl_context=ctx, timeout=30)
    M.login(MBOX, pw)
except Exception as e:
    # The guest reboots daily at 09:00 UTC (QC 84). One failure is "unknown",
    # not "down" -- the caller decides, and the watcher requires two in a row.
    print(f"BRIEF-ERROR IMAP login FAILED: {e}")
    raise SystemExit(1)

M.select("INBOX")
typ, data = M.search(None, "ALL")
ids = data[0].split() if data and data[0] else []

def hdr(m, k):
    v = m.get(k, "")
    try:
        return str(make_header(decode_header(v)))
    except Exception:
        return v

rows = []
for num in ids:
    typ, d = M.fetch(num, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID DATE FROM SUBJECT)])")
    if typ != "OK" or not d or not d[0]:
        continue
    m = email.message_from_bytes(d[0][1])
    rows.append((
        hdr(m, "Message-ID").strip(),
        hdr(m, "Date").strip(),
        hdr(m, "From").strip()[:60],
        hdr(m, "Subject").strip()[:70],
    ))
M.logout()

print(f"BRIEF-COUNT {len(rows)}")
for mid, date, frm, subj in rows:
    print(f"BRIEF-MSG {mid} | {date} | {frm} | {subj}")
print("BRIEF-OK (headers only; NOT verified; not marked read)")
PY
