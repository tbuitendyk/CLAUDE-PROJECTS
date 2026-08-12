#!/usr/bin/env bash
# hub-debug-unseen.sh -- READ-ONLY: why does the hub cycle route nothing while
# INBOX has unseen mail? Lists every UNSEEN message (PEEK -- flags untouched)
# with its message-id, and whether that id is in processed.txt. No changes.
set -uo pipefail
echo "== processed.txt tail (last 8) =="
tail -8 /var/lib/claude-mail/processed.txt 2>/dev/null | sed 's/^/  /'
echo "== UNSEEN messages in claude@ INBOX (peek only) =="
python3 <<'PY'
import email, imaplib, ssl
from email.header import decode_header, make_header
pw=None
for line in open("/etc/deploy-control/env"):
    if line.startswith("CLAUDE_MAIL_PASSWORD="): pw=line.split("=",1)[1].strip(); break
processed=set(x.strip() for x in open("/var/lib/claude-mail/processed.txt") if x.strip())
ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
M=imaplib.IMAP4_SSL("192.168.56.129",993,ssl_context=ctx,timeout=30)
M.login("claude@homeandofficemicro.com",pw); M.select("INBOX", readonly=True)
typ,data=M.search(None,"UNSEEN")
ids=data[0].split() if data and data[0] else []
print(f"UNSEEN count: {len(ids)}")
def hdr(m,k):
    try: return str(make_header(decode_header(m.get(k,""))))
    except Exception: return m.get(k,"")
for num in ids[-20:]:
    typ,d=M.fetch(num,"(BODY.PEEK[HEADER])")
    if typ!="OK" or not d or not d[0]: continue
    m=email.message_from_bytes(d[0][1])
    mid=hdr(m,"Message-ID").strip(); key=mid.strip("<>")
    print(f"  #{num.decode()}: {hdr(m,'Date')[:22]} | {hdr(m,'From')[:40]} | {hdr(m,'Subject')[:50]}")
    print(f"      msgid={mid[:70]}  in_processed={key in processed}")
M.logout()
PY
