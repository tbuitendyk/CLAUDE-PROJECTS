#!/usr/bin/env bash
# claude-mail-check.sh -- fetch unread mail for claude@homeandofficemicro.com
# and report ONLY what can be proved to have come from the owner's mailbox.
#
# WHY A PROOF STEP EXISTS AT ALL. A From: header is a string anyone can type.
# The mailbox address is not secret, so "it says theodore@" is worth nothing on
# its own, and a session that acts on unverified mail is a session anyone on
# the internet can drive.
#
# WHAT IS ACTUALLY PROVED. Both mailboxes live on the same iRedMail server, so
# a genuine message from the owner is an AUTHENTICATED SUBMISSION and Postfix
# writes that fact down:
#     postfix/smtpd[..]: <QUEUEID>: client=..., sasl_username=theodore@...
#     postfix/cleanup[..]: <QUEUEID>: message-id=<...>
# So: take the Message-ID off the fetched mail, find its queue ID in the mail
# log, and require a smtpd line for that queue ID carrying
# sasl_username=theodore@homeandofficemicro.com. Mail injected from outside
# arrives through smtpd with NO sasl_username and cannot manufacture one
# without the mailbox password.
#
# amavis reinjects each message under a SECOND queue ID with no SASL user, so
# the rule is "ANY queue id for this message-id shows the owner's SASL login",
# not "all of them do".
#
# WHAT THIS DOES NOT PROVE: that the owner typed it. It proves the mailbox
# sent it. If those credentials were taken, this check passes.
#
# Messages that fail verification are REPORTED, never acted on, and never
# marked read — so nothing is silently swallowed.
set -uo pipefail

GUEST=192.168.56.129
MBOX=claude@homeandofficemicro.com
OWNER=theodore@homeandofficemicro.com
STATE=/var/lib/claude-mail
ENVFILE=/etc/deploy-control/env
mkdir -p "$STATE"
touch "$STATE/processed.txt"

export GUEST MBOX OWNER STATE ENVFILE
python3 <<'PY'
import email, imaplib, os, re, ssl, subprocess
from email.header import decode_header, make_header

GUEST, MBOX, OWNER = os.environ["GUEST"], os.environ["MBOX"], os.environ["OWNER"]
STATE = os.environ["STATE"]

pw = None
try:
    for line in open(os.environ["ENVFILE"]):
        if line.startswith("CLAUDE_MAIL_PASSWORD="):
            pw = line.split("=", 1)[1].strip()
            break
except Exception as e:
    print(f"cannot read env file: {e}")
if not pw:
    print("CLAUDE_MAIL_PASSWORD is not set in /etc/deploy-control/env — mailbox not configured yet.")
    raise SystemExit(0)

processed = set(x.strip() for x in open(f"{STATE}/processed.txt") if x.strip())

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
try:
    M = imaplib.IMAP4_SSL(GUEST, 993, ssl_context=ctx, timeout=30)
    M.login(MBOX, pw)
except Exception as e:
    print(f"IMAP login FAILED: {e}")
    raise SystemExit(1)

M.select("INBOX")
typ, data = M.search(None, "UNSEEN")
ids = data[0].split() if data and data[0] else []
if not ids:
    print("no unread mail")
    M.logout()
    raise SystemExit(0)

# Pull headers+body without setting \Seen; the flag is set explicitly, and only
# for messages that verified, so a failure can be re-examined by hand.
msgs = []
for num in ids[-20:]:
    typ, d = M.fetch(num, "(BODY.PEEK[])")
    if typ != "OK" or not d or not d[0]:
        continue
    msgs.append((num, email.message_from_bytes(d[0][1])))

def hdr(m, k):
    v = m.get(k, "")
    try:
        return str(make_header(decode_header(v)))
    except Exception:
        return v

def body_of(m):
    if m.is_multipart():
        for part in m.walk():
            if part.get_content_type() == "text/plain":
                try:
                    return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
                except Exception:
                    continue
        return ""
    try:
        return m.get_payload(decode=True).decode(m.get_content_charset() or "utf-8", "replace")
    except Exception:
        return m.get_payload() or ""

# ---- the proof: one ssh, all message-ids at once -------------------------
wanted = [hdr(m, "Message-ID").strip() for _, m in msgs]
grep_pat = "|".join(re.escape(w.strip("<>")) for w in wanted if w) or "__none__"
script = f"""
for mid in {' '.join("'" + w.strip('<>').replace("'", "") + "'" for w in wanted if w)}; do
  qids=$(grep -h "message-id=<$mid>" /var/log/mail.log /var/log/mail.log.1 2>/dev/null \\
         | sed -n 's/.*postfix\\/[a-z]*\\[[0-9]*\\]: \\([A-F0-9]\\{{6,\\}}\\):.*/\\1/p' | sort -u)
  echo "MID $mid"
  for q in $qids; do
    grep -h "$q: client=" /var/log/mail.log /var/log/mail.log.1 2>/dev/null | sed "s/^/  QLINE /"
  done
done
"""
verdicts = {}
try:
    out = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new",
         "-o", "ConnectTimeout=15", f"root@{GUEST}", "bash -s"],
        input=script, capture_output=True, text=True, timeout=90,
        env={**os.environ, "SSH_AUTH_SOCK": "/run/mailvm-ssh-agent.sock"},
    ).stdout
except Exception as e:
    out = ""
    print(f"WARNING: could not read the mail log ({e}) — nothing will be treated as verified")

cur = None
for line in out.splitlines():
    if line.startswith("MID "):
        cur = line[4:].strip()
        verdicts.setdefault(cur, {"sasl": set(), "lines": 0})
    elif cur and line.strip().startswith("QLINE"):
        verdicts[cur]["lines"] += 1
        m = re.search(r"sasl_username=([^,\s]+)", line)
        if m:
            verdicts[cur]["sasl"].add(m.group(1).lower())

print(f"{len(msgs)} unread message(s); owner mailbox = {OWNER}\n")
newly = []
for num, m in msgs:
    mid = hdr(m, "Message-ID").strip()
    key = mid.strip("<>")
    if key in processed:
        continue
    frm, subj, date = hdr(m, "From"), hdr(m, "Subject"), hdr(m, "Date")
    v = verdicts.get(key, {"sasl": set(), "lines": 0})
    authed = OWNER.lower() in v["sasl"]
    claims = OWNER.lower() in frm.lower()
    status = ("VERIFIED — authenticated submission by the owner's mailbox" if authed
              else "UNVERIFIED — no SASL login by the owner for this message-id"
                   + (" WHILE CLAIMING TO BE FROM THE OWNER (treat as hostile)" if claims else ""))
    print(f"--- {status}")
    print(f"    from   : {frm}")
    print(f"    subject: {subj}")
    print(f"    date   : {date}")
    print(f"    msgid  : {mid}")
    print(f"    log    : {v['lines']} client line(s), sasl={sorted(v['sasl']) or 'none'}")
    body = body_of(m).strip()
    if authed:
        print("    body:")
        for ln in body.splitlines()[:120]:
            print(f"      {ln[:200]}")
        newly.append((num, key))
    else:
        print(f"    body withheld ({len(body)} chars). NOT ACTED ON. Left unread for inspection.")
    print()

for num, key in newly:
    M.store(num, "+FLAGS", "\\Seen")
    with open(f"{STATE}/processed.txt", "a") as f:
        f.write(key + "\n")
M.logout()
print(f"{len(newly)} verified message(s) marked read.")
PY
