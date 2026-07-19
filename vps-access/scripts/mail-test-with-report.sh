#!/usr/bin/env bash
# mail-test-with-report.sh -- send a test to one address, email its mail.log delivery trace to another.
# Usage: mail-test-with-report.sh <sendto>/<reportto>   (bare local-part -> @homeandofficemicro.com, or full address)
#
# Sends a test email to <sendto> via authenticated submission as support@ to the
# real mail server (192.168.56.129:587), captures the queue-id, SSHes into the
# mail VM (using the mailvm ssh-agent) to pull /var/log/mail.log lines for that
# message, and emails the collected trace to <reportto>.
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

time.sleep(7)  # let the server process + log

midcore=mid.strip('<>')
pats=[p for p in (qid, midcore) if p]
grep_args="".join(f" -e '{p}'" for p in pats)
remote=f"grep -F{grep_args} /var/log/mail.log | tail -40 || echo '(no matching lines yet)'"
res=subprocess.run(["ssh","-o","BatchMode=yes","-o","StrictHostKeyChecking=accept-new",
     "-o","ConnectTimeout=8",f"root@{MAILVM}",remote], capture_output=True,text=True,timeout=30)
trace=res.stdout.strip() or "(no matching mail.log lines found)"
if res.returncode!=0 and res.stderr.strip(): trace+=f"\n[ssh error] {res.stderr.strip()}"
print("=== trace (first 900 chars) ===\n"+trace[:900])

body=(f"Delivery report -- test message to <{sendto}>\n"
      f"Sent (UTC): {ts}\nMessage-ID: {mid}\nQueue-ID: {qid}\nSubmit response: {dresp}\n\n"
      f"--- /var/log/mail.log on the mail VM ({MAILVM}) ---\n{trace}\n")
_,_,r2=submit(reportto, f"Mail delivery report: {sendto}", body)
print(f"report emailed to <{reportto}>: {r2.splitlines()[0] if r2 else ''}")
PY
