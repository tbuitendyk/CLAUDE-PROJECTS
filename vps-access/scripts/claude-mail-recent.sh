#!/usr/bin/env bash
# claude-mail-recent.sh -- READ-ONLY twin of claude-mail-check.sh: shows the
# most recent messages and their verification verdicts WITHOUT marking
# anything read and WITHOUT recording anything as processed.
#
# WHY BOTH EXIST. The watcher polls on a timer and only sees the lines it
# greps for; if the polling call also consumes messages, the bodies are
# destroyed by the very act of noticing them — which is exactly what happened
# the first time. So: the watcher runs THIS one (detect, change nothing), and
# claude-mail-check.sh is run deliberately when the messages are actually
# going to be read and acted on.
#
# Verification logic is inherited from that script unchanged.
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
# message-id had the owner's SASL and SOME (other) queue id delivered to claude@:
# an attacker reuses a Message-ID the owner legitimately submitted elsewhere and
# sends their own mail to claude@ under it, and the pooled facts "verify" a message
# claude@ never received from the owner. The rule now binds BOTH facts to the SAME
# queue id: one queue id must show the owner's sasl_username AND a to=<claude@...>
# recipient. A genuine owner->claude message is an authenticated submission
# addressed to claude@, so its submission queue id carries both; amavis's second
# (reinjected, SASL-less) queue id is irrelevant to the decision.
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
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # for mail-verify-parse.py
mkdir -p "$STATE"
touch "$STATE/processed.txt"

export GUEST MBOX OWNER STATE ENVFILE HERE
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
typ, data = M.search(None, "ALL")
ids = data[0].split() if data and data[0] else []
if not ids:
    print("mailbox is empty")
    M.logout()
    raise SystemExit(0)

# Pull headers+body without setting \Seen; the flag is set explicitly, and only
# for messages that verified, so a failure can be re-examined by hand.
msgs = []
for num in ids[-8:]:
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

def _html_to_text(h):
    # crude but dependency-free: drop scripts/styles, turn breaks into newlines,
    # strip tags, unescape entities. Enough to READ a phone-sent HTML mail.
    import re as _re, html as _html
    h = _re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", h)
    h = _re.sub(r"(?i)<br\s*/?>", "\n", h)
    h = _re.sub(r"(?i)</(p|div|tr|li|h[1-6])>", "\n", h)
    h = _re.sub(r"(?s)<[^>]+>", "", h)
    h = _html.unescape(h)
    return _re.sub(r"\n[ \t]*\n\s*\n+", "\n\n", h).strip()

def body_of(m):
    if m.is_multipart():
        html = None
        for part in m.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                try:
                    return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
                except Exception:
                    continue
            elif ct == "text/html" and html is None:
                try:
                    html = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
                except Exception:
                    html = None
        # a phone client (Bluemail) often sends HTML-only; fall back to it so a
        # genuine owner message is READABLE rather than an empty body (2026-08-11).
        return _html_to_text(html) if html else ""
    try:
        raw = m.get_payload(decode=True).decode(m.get_content_charset() or "utf-8", "replace")
    except Exception:
        return m.get_payload() or ""
    return _html_to_text(raw) if m.get_content_type() == "text/html" else raw

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
# grep -a (--text): the mail log can carry a stray non-ASCII byte (an accented
# display name, an IDN hostname in a client= line). Without -a, grep declares the
# whole file "binary" and SILENTLY skips it — finding no queue id and reading a
# genuinely SASL-authenticated owner message as UNVERIFIED (2026-08-11: a real
# phone submission that DID carry sasl_username=theodore was rejected this way).
# -a forces text processing; it does NOT relax the check — the real sasl line
# must still be present for the message-id's queue id.
# Per message-id, per QUEUE-ID: collect the client= lines (for sasl_username) AND
# the to=<claude@...> envelope-recipient lines, each TAGGED with its queue id, so
# the verdict can require BOTH on the SAME queue id (GAP-2 anti-spoof). amavis
# reinjects under a second queue id, but the AUTHENTICATED SUBMISSION queue id
# carries both the owner's SASL login and the claude@ recipient, so binding on it
# is exactly right.
script = "\n".join([
    "for mid in " + " ".join(f"'{x}'" for x in safe) + "; do",
    '  echo "MID $mid"',
    '  qids=$(grep -a -h -F "message-id=<$mid>" /var/log/mail.log /var/log/mail.log.1 2>/dev/null '
    '| sed -n "s/.*\\]: \\([^:]*\\): message-id=.*/\\1/p" | sort -u)',
    "  for q in $qids; do",
    '    grep -a -h -F "$q: client=" /var/log/mail.log /var/log/mail.log.1 2>/dev/null | sed "s/^/  QSASL $q /"',
    f'    grep -a -h -F "$q: to=<{MBOX}>" /var/log/mail.log /var/log/mail.log.1 2>/dev/null | sed "s/^/  QTO $q /"',
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

# Decide verdicts in the shared, unit-tested helper (single source of truth). It
# binds the owner's SASL and the claude@ delivery to the SAME queue id (GAP-2).
verdicts = {}
try:
    parsed = subprocess.run(
        ["python3", os.path.join(os.environ["HERE"], "mail-verify-parse.py"), OWNER, MBOX],
        input=out, capture_output=True, text=True, timeout=30,
    ).stdout
    import json as _json
    for mid_key, vv in _json.loads(parsed or "{}").items():
        verdicts[mid_key] = {"authed": bool(vv.get("authed")),
                             "sasl": set(vv.get("sasl") or []),
                             "to_claude": bool(vv.get("to_claude")),
                             "boundQid": vv.get("boundQid"),
                             "lines": len(vv.get("sasl") or [])}
except Exception as e:
    print(f"WARNING: verdict parse failed ({e}) — nothing will be treated as verified")

print(f"{len(msgs)} unread message(s); owner mailbox = {OWNER}\n")
newly = []
for num, m in msgs:
    mid = hdr(m, "Message-ID").strip()
    key = mid.strip("<>")
    frm, subj, date = hdr(m, "From"), hdr(m, "Subject"), hdr(m, "Date")
    v = verdicts.get(key, {"sasl": set(), "lines": 0, "authed": False, "to_claude": False, "boundQid": None})
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
        newly.append((num, key))  # counted, but never flagged below
    else:
        print(f"    body withheld ({len(body)} chars). NOT ACTED ON. Left unread for inspection.")
    print()

M.logout()
print(f"{len(newly)} verified message(s) shown. NOTHING was marked read or recorded — "
      f"this is the read-only view.")
PY
