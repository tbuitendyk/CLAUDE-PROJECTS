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
# GAP-2 (2026-08-11 e2e review) — MESSAGE-ID COLLISION SPOOF. Message-ID is
# attacker-chosen header text, so it is NOT enough that SOME queue id sharing the
# message-id had the owner's SASL and SOME (other) queue id delivered to claude@.
# The rule now binds BOTH to the SAME queue id: one queue id must show the owner's
# sasl_username AND a to=<claude@...> recipient. amavis's second (reinjected,
# SASL-less) queue id is irrelevant to the decision. See claude-mail-recent.sh and
# the shared decision helper mail-verify-parse.py.
#
# WHAT THIS DOES NOT PROVE: that the owner typed it. It proves the mailbox
# sent it. If those credentials were taken, this check passes.
#
# Messages that fail verification are REPORTED, never acted on, and never
# marked read — so nothing is silently swallowed.
set -uo pipefail

# HUB DELEGATION (2026-08-11). When the mail hub is enabled, the hub's cron
# cycle is the ONLY consumer of the mailbox (it runs this script in BYPASS
# mode below and routes verified mail to per-container inboxes). A legacy
# caller -- e.g. the general-classifier session polling this script directly --
# is transparently handed its routed queue instead, so nothing double-consumes
# the mailbox and existing pollers keep working unchanged.
# Protocol: vps-access/HUB-PROTOCOL.md
if [ -f /var/lib/claude-mail/hub/ENABLED ] && [ "${CLAUDE_MAIL_HUB_BYPASS:-0}" != 1 ]; then
  # legacy-route, NOT default-route: legacy callers are the pre-hub pollers
  # (general-classifier), while the default route for unaddressed mail is the
  # hub session itself (vps-access) -- two different things.
  exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hub-fetch.sh" \
    "$(cat /var/lib/claude-mail/hub/legacy-route 2>/dev/null || echo general-classifier)"
fi

GUEST=192.168.56.129
MBOX=claude@homeandofficemicro.com
OWNER=theodore@homeandofficemicro.com
STATE=/var/lib/claude-mail
ENVFILE=/etc/deploy-control/env
mkdir -p "$STATE"
touch "$STATE/processed.txt"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # for mail-verify-parse.py
export GUEST MBOX OWNER STATE ENVFILE HERE
python3 <<'PY'
import email, imaplib, json, os, re, ssl, subprocess
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

# Owner's rule (verified mail, 2026-07-28 20:11Z): within 1200s of the last
# message sent to them, check every minute; otherwise every five. Published as
# a line the watcher reads, so the cadence lives on the box with the rest of
# the protocol instead of being hardcoded into whatever is doing the polling.
import time as _t
try:
    since = _t.time() - int(open(f"{STATE}/last-sent").read().strip())
except Exception:
    since = 1e9
print(f"NEXT-POLL {60 if since < 1200 else 300}"
      + (f"  (last send {int(since)}s ago — inside the 1200s window)" if since < 1200 else ""))

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
#
# TWO REGEX BUGS COST THE FIRST LIVE RUN, both fixed here and both worth
# naming because either one silently turns genuine mail into "hostile":
#   1. This server runs enable_long_queue_ids, so a queue id is
#      4h8mZ21K38z41Gy, not the classic 6-hex-digit form.
#   2. The logging process is postfix/submission/smtpd — TWO slashes — so a
#      pattern expecting postfix/<word>[ never matched a submission line.
# The rule now keys off the fixed text that is actually stable: the token
# immediately before ": message-id=", whatever shape it happens to be.
wanted = [hdr(m, "Message-ID").strip() for _, m in msgs]
# Message-ids go into a shell loop, so allow only characters that cannot
# become shell syntax. Anything else simply fails to verify, which is the
# safe direction.
safe = [w.strip("<>") for w in wanted if w and re.fullmatch(r"[A-Za-z0-9._@+-]+", w.strip("<>"))]
script = "\n".join([
    "for mid in " + " ".join(f"'{x}'" for x in safe) + "; do",
    '  echo "MID $mid"',
    # grep -a: a stray non-ASCII byte in the mail log must not make grep skip the
    # whole file as "binary" and read a genuine SASL-authenticated message as
    # UNVERIFIED (2026-08-11 root cause). -a forces text; it does not relax the
    # check. Kept identical to claude-mail-recent.sh.
    '  qids=$(grep -a -h -F "message-id=<$mid>" /var/log/mail.log /var/log/mail.log.1 2>/dev/null '
    '| sed -n "s/.*\\]: \\([^:]*\\): message-id=.*/\\1/p" | sort -u)',
    # bind sasl_username AND to=<claude@...> to the SAME queue id (GAP-2 anti-spoof),
    # each line tagged with its queue id. Kept identical to claude-mail-recent.sh.
    "  for q in $qids; do",
    '    grep -a -h -F "$q: client=" /var/log/mail.log /var/log/mail.log.1 2>/dev/null | sed "s/^/  QSASL $q /"',
    f'    grep -a -i -h -F "$q: to=<{MBOX}>" /var/log/mail.log /var/log/mail.log.1 2>/dev/null | sed "s/^/  QTO $q /"',  # -i: match the helper's case-insensitive recipient check
    "  done",
    "done",
]) if safe else "true"

out = ""
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

# Shared, unit-tested verdict helper: owner SASL AND claude@ delivery on ONE queue
# id (single source of truth with claude-mail-recent.sh; GAP-2).
verdicts = {}
try:
    parsed = subprocess.run(
        ["python3", os.path.join(os.environ["HERE"], "mail-verify-parse.py"), OWNER, MBOX],
        input=out, capture_output=True, text=True, timeout=30,
    ).stdout
    for mid_key, vv in json.loads(parsed or "{}").items():
        verdicts[mid_key] = {"authed": bool(vv.get("authed")),
                             "sasl": set(vv.get("sasl") or []),
                             "to_claude": bool(vv.get("to_claude")),
                             "boundQid": vv.get("boundQid")}
except Exception as e:
    print(f"WARNING: verdict parse failed ({e}) — nothing will be treated as verified")

print(f"{len(msgs)} unread message(s); owner mailbox = {OWNER}\n")
newly = []
for num, m in msgs:
    mid = hdr(m, "Message-ID").strip()
    key = mid.strip("<>")
    if key in processed:
        continue
    frm, subj, date = hdr(m, "From"), hdr(m, "Subject"), hdr(m, "Date")
    v = verdicts.get(key, {"sasl": set(), "authed": False, "to_claude": False, "boundQid": None})
    authed = bool(v.get("authed"))   # owner SASL AND claude@ delivery on ONE queue id
    claims = OWNER.lower() in frm.lower()
    status = ("VERIFIED — authenticated owner submission delivered to this mailbox" if authed
              else "UNVERIFIED — no single queue id shows the owner's SASL login AND delivery to claude@ for this message-id"
                   + (" WHILE CLAIMING TO BE FROM THE OWNER (treat as hostile)" if claims else ""))
    print(f"--- {status}")
    print(f"    from   : {frm}")
    print(f"    subject: {subj}")
    print(f"    date   : {date}")
    print(f"    msgid  : {mid}")
    print(f"    log    : sasl={sorted(v.get('sasl')) or 'none'}, to_claude={v.get('to_claude')}, boundQid={v.get('boundQid')}")
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
