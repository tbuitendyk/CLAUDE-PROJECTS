#!/usr/bin/env bash
# send-test-email.sh [recipient]   -- INTERNAL routing test
#
# Verify a local mailbox exists (SMTP RCPT callout on the trusted loopback path)
# then send ONE test email through the mail VM's SMTP from the VPS host.
# Accepts a bare local-part (domain defaults to homeandofficemicro.com) OR a
# full address. If the mailbox is UNKNOWN, it probes a few likely spelling
# variants, lists the valid ones, and does NOT send -- so you can pick the right
# one and re-run. Default recipient: theodor (i.e. theodor@homeandofficemicro.com).
set -uo pipefail
export ARG="${1:-theodor}"
python3 <<'PY'
import os, re, sys, smtplib
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from datetime import datetime, timezone

DOMAIN_DEFAULT = "homeandofficemicro.com"
arg = os.environ["ARG"].strip()
local, domain = (arg.split("@", 1) if "@" in arg else (arg, DOMAIN_DEFAULT))
rcpt   = f"{local}@{domain}"
sender = f"vps-test@{DOMAIN_DEFAULT}"
targets = [("127.0.0.1", 25), ("192.168.56.129", 25), ("10.0.2.129", 25)]
host = os.uname().nodename
ts   = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

def variants(local):
    lc = local.lower()
    toks = [t for t in re.split(r"[._+-]+", lc) if t]
    out = []
    def add(x):
        if x and 1 < len(x) <= 64 and x not in out:
            out.append(x)
    add(lc)
    add(re.sub(r"[._+-]+", "", lc))
    if len(toks) >= 2:
        add(toks[0]); add(toks[-1])
        add(toks[0][0] + toks[-1]); add(toks[0][0] + "." + toks[-1])
        add(toks[0] + "." + toks[-1])
    else:
        for n in range(4, len(lc)):     # shortenings
            add(lc[:n])
        add(lc + "e")                   # e.g. theodor -> theodore
    return out[:7]

s = None
for h, p in targets:
    try:
        s = smtplib.SMTP(h, p, timeout=20); s.ehlo(); host_used = (h, p); break
    except Exception as e:
        print(f"  {h}:{p} unreachable: {e}")
if s is None:
    print("No SMTP target reachable.", file=sys.stderr); sys.exit(1)
h, p = host_used

print(f"verifying <{rcpt}> via {h}:{p}")
s.mail(sender)
code, resp = s.rcpt(rcpt)
text = resp.decode(errors="replace")

if code in (250, 251):
    m = EmailMessage()
    m["From"] = f"VPS Deploy Test <{sender}>"; m["To"] = rcpt
    m["Subject"] = f"VPS internal test -- {ts}"; m["Date"] = formatdate(localtime=True)
    m["Message-ID"] = make_msgid(domain=host)
    m.set_content(f"Internal routing test from the VPS host ({host}) via {h}:{p}.\nSent (UTC): {ts}\n")
    dcode, dresp = s.data(m.as_string()); s.quit()
    print(f"VERIFIED + SENT: <{rcpt}> ({dcode} {dresp.decode(errors='replace')})")
    sys.exit(0)

print(f"not a deliverable mailbox: <{rcpt}> -> {code} {text}")
s.rset()
cands = [c for c in variants(local) if f"{c}@{domain}" != rcpt]
print(f"probing {len(cands)} likely spelling(s) on @{domain} ...")
valid = []
for c in cands:
    addr = f"{c}@{domain}"
    s.mail(sender)
    cc, cr = s.rcpt(addr); s.rset()
    ok = cc in (250, 251)
    print(f"  {'VALID  ' if ok else 'unknown'} {addr} ({cc})")
    if ok:
        valid.append(addr)
s.quit()
print()
if valid:
    print("Valid mailbox(es) found -- tell me which to test and I'll send to it:")
    for v in valid:
        print(f"  - {v}")
else:
    print("No valid variant found -- give me the exact address or a better hint.")
sys.exit(2)
PY
