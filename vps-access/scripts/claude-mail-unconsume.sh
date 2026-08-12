#!/usr/bin/env bash
# claude-mail-unconsume.sh -- restore the last N consumed messages (default 5)
# to UNREAD and drop them from processed.txt, so the classifier's own poller
# picks them up as if never touched. Used after a diagnostic run of
# claude-mail-check.sh consumed messages meant for the classifier's loop.
set -uo pipefail
N="${1:-5}"
export N
python3 <<'PY'
import imaplib, os, ssl
STATE="/var/lib/claude-mail"; ENV="/etc/deploy-control/env"
N=int(os.environ.get("N","5"))
pw=None
for line in open(ENV):
    if line.startswith("CLAUDE_MAIL_PASSWORD="): pw=line.split("=",1)[1].strip(); break
assert pw, "no CLAUDE_MAIL_PASSWORD"
lines=[l.strip() for l in open(f"{STATE}/processed.txt") if l.strip()]
keys=lines[-N:]
print(f"restoring {len(keys)} message(s) to unread:")
ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
M=imaplib.IMAP4_SSL("192.168.56.129",993,ssl_context=ctx,timeout=30)
M.login("claude@homeandofficemicro.com",pw); M.select("INBOX")
ok=0
for k in keys:
    typ,d=M.search(None,'HEADER','Message-ID',f'<{k}>')
    ids=d[0].split() if d and d[0] else []
    for num in ids:
        M.store(num,"-FLAGS","\\Seen"); ok+=1
    print(f"  {'OK ' if ids else 'MISSING '} <{k}>")
M.logout()
keep=lines[:-N] if N<=len(lines) else []
open(f"{STATE}/processed.txt","w").write("".join(x+"\n" for x in keep))
print(f"{ok} message(s) marked unread; processed.txt trimmed by {len(keys)} entries.")
PY
echo "== host-side pollers audit (was truncated last run) =="
grep -rsl 'claude-mail' /etc/cron.d /etc/cron.hourly /etc/cron.daily /var/spool/cron 2>/dev/null | sed 's/^/  /' || echo "  (no cron entries -- polling is session-driven, confirmed)"
