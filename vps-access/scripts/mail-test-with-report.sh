#!/usr/bin/env bash
# mail-test-with-report.sh -- send a test to one address, email its mail.log delivery trace to another.
# Usage: mail-test-with-report.sh <sendto>/<reportto>   (bare local-part -> @homeandofficemicro.com, or full address)
#
# Sends a test via authenticated submission as support@ to the real mail server
# (192.168.56.129:587), captures the queue-id, then SSHes into the mail VM (via
# the mailvm ssh-agent) and follows /var/log/mail.log for that message -- through
# the Amavis reinjection -- until a terminal status, and emails the trace to <reportto>.
set -uo pipefail
export ARG="${1:-}"
export SSH_AUTH_SOCK=/run/mailvm-ssh-agent.sock
python3 <<'PY'
import os, re, ssl, smtplib, subprocess, time
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from datetime import datetime, timezone

DOMAIN="homeandofficemicro.com"; SENDER="support@homeandofficemicro.com"
MAILVM="192.168.56.129"; ENVFILE="/etc/deploy-control/env"
arg=os.environ["ARG"].strip()
if "/" not in arg:
    print("usage: mail-test-with-report.sh <sendto>/<reportto>"); raise SystemExit(1)
a,b=arg.split("/",1)
full=lambda x: x if "@" in x else f"{x}@{DOMAIN}"
sendto=full(a.strip()); reportto=full(b.strip())
host=os.uname().nodename
ts=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

pw=None
with open(ENVFILE) as f:
    for line in f:
        if line.startswith("SUPPORT_SMTP_PASSWORD="): pw=line.split("=",1)[1].strip(); break
if not pw: print("SUPPORT_SMTP_PASSWORD not set in "+ENVFILE); raise SystemExit(1)

def submit(to, subj, body):
    ctx=ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
    m=EmailMessage(); mid=make_msgid(domain=host)
    m["From"]=f"VPS Mail Test <{SENDER}>"; m["To"]=to; m["Reply-To"]=SENDER
    m["Subject"]=subj; m["Date"]=formatdate(localtime=True); m["Message-ID"]=mid
    m.set_content(body)
    s=smtplib.SMTP(MAILVM,587,timeout=25); s.ehlo(); s.starttls(context=ctx); s.ehlo(); s.login(SENDER,pw)
    s.mail(SENDER); code,resp=s.rcpt(to)
    if code>=400:
        s.quit(); return mid, None, f"RCPT refused {code} {resp.decode(errors='replace')}"
    code,resp=s.data(m.as_string()); s.quit()
    r=resp.decode(errors='replace')
    mo=re.search(r'queued as (\S+)', r)
    return mid, (mo.group(1) if mo else None), f"{code} {r}"

print(f"sending test to <{sendto}> (from {SENDER}) ...")
mid,qid,dresp=submit(sendto, f"VPS delivery test {ts}", f"Delivery test to {sendto} at {ts}.\n")
print(f"  submit: {dresp}")
print(f"  message-id={mid}  queue-id={qid}")

# Follow the log: seed with the queue-id + message-id, pull every line for those
# AND for any queue-ids they hand off to ('queued as X'), until a terminal status.
REMOTE=r'''
mid="$1"; shift; seeds="$*"
ids="$seeds"
for _ in 1 2 3; do
  more=$(grep -F $(for x in $ids "$mid"; do echo -n " -e $x"; done) /var/log/mail.log 2>/dev/null \
         | grep -oE 'queued as [0-9A-Za-z]+' | awk '{print $3}' | sort -u | tr '\n' ' ')
  ids="$ids $more"
done
grep -F $(for x in $(echo "$ids" | tr ' ' '\n' | sort -u) "$mid"; do echo -n " -e $x"; done) /var/log/mail.log 2>/dev/null | tail -60
'''
midcore=mid.strip('<>')
seed=qid or "NOQID"

def final_delivery(t):
    # the REAL delivery line = a status= line whose relay is NOT the Amavis
    # loopback (:10024/10025/10026). That excludes the content-filter handoff.
    for ln in t.splitlines():
        if re.search(r'status=(sent|deferred|bounced|expired)', ln) and not re.search(r':1002[456]\b', ln):
            return ln.strip()
    return None

trace=""; err=""; final=None
for _ in range(8):  # up to ~32s -- external relay + remote response can lag
    time.sleep(4)
    res=subprocess.run(["ssh","-o","BatchMode=yes","-o","StrictHostKeyChecking=accept-new",
         "-o","ConnectTimeout=8",f"root@{MAILVM}","bash","-s",midcore,seed],
        input=REMOTE, capture_output=True, text=True, timeout=30)
    trace=res.stdout.strip(); err=res.stderr.strip()
    final=final_delivery(trace)
    if final: break
if not trace: trace="(no matching mail.log lines found)"
if err: trace += f"\n[ssh stderr] {err}"
outcome=final or "(no final delivery line captured within the poll window -- external relay may be slow/greylisted; re-run to see the outcome)"
print("=== FINAL DELIVERY ===\n"+outcome)
print("=== trace (first 600 chars) ===\n"+trace[:600])

body=(f"Delivery report -- test message to <{sendto}>\n"
      f"Sent (UTC): {ts}\nMessage-ID: {mid}\nQueue-ID: {qid}\nSubmit response: {dresp}\n\n"
      f"FINAL DELIVERY:\n{outcome}\n\n"
      f"--- full /var/log/mail.log trace (mail VM {MAILVM}) ---\n{trace}\n")
_,_,r2=submit(reportto, f"Mail delivery report: {sendto}", body)
print(f"report emailed to <{reportto}>: {(r2 or '').splitlines()[0] if r2 else ''}")
PY
