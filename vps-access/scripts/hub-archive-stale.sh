#!/usr/bin/env bash
# hub-archive-stale.sh -- owner-directed (verified mail 2026-08-12 19:51Z):
# move the permanently-unverifiable stale messages out of claude@ INBOX into
# an Archive folder. Scope: UNSEEN and received BEFORE 2026-08-05 -- exactly
# the Jul 28 - Aug 1 batch whose verification window is gone (mail.log
# rotated). Nothing is deleted; messages are copied to Archive then expunged
# from INBOX. Recoverable from Archive.
set -uo pipefail
python3 <<'PY'
import imaplib, ssl
pw=None
for line in open("/etc/deploy-control/env"):
    if line.startswith("CLAUDE_MAIL_PASSWORD="): pw=line.split("=",1)[1].strip(); break
ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
M=imaplib.IMAP4_SSL("192.168.56.129",993,ssl_context=ctx,timeout=30)
M.login("claude@homeandofficemicro.com",pw)
M.create("Archive")   # no-op if it exists
M.select("INBOX")
typ,data=M.search(None,'(UNSEEN BEFORE 05-Aug-2026)')
ids=data[0].split() if data and data[0] else []
print(f"stale unseen (pre 2026-08-05): {len(ids)}")
moved=0
for num in ids:
    t1,_=M.copy(num,"Archive")
    if t1=="OK":
        M.store(num,"+FLAGS","\\Seen \\Deleted"); moved+=1
M.expunge()
print(f"moved to Archive: {moved}")
typ,data=M.search(None,"UNSEEN")
left=data[0].split() if data and data[0] else []
print(f"INBOX unseen remaining: {len(left)}")
M.logout()
PY
