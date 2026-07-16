#!/usr/bin/env bash
# configure-balancer-email.sh -- point the asset balancer at the same
# authenticated submission path mail-test.sh uses (mail VM 192.168.56.129:587
# as support@homeandofficemicro.com, self-signed cert tolerated).
#
# Changes: rewrites the SMTP_* / ALERT_EMAIL_FROM keys in
# /etc/asset-balancer/env -- the password is copied on-box from
# SUPPORT_SMTP_PASSWORD in /etc/deploy-control/env and never leaves the VPS --
# then restarts the asset-balancer service and sends a test email through the
# service's own /api/test-email endpoint (loopback; the app has no
# APP_PASSWORD, its public face is gated by nginx Basic Auth instead).
# Idempotent: safe to re-run; only those keys are touched.
set -euo pipefail
python3 - <<'PY'
import subprocess, sys, time, urllib.request, urllib.error

SRC = "/etc/deploy-control/env"
DST = "/etc/asset-balancer/env"

pw = None
with open(SRC) as f:
    for line in f:
        if line.startswith("SUPPORT_SMTP_PASSWORD="):
            pw = line.split("=", 1)[1].strip()
if not pw:
    sys.exit(f"SUPPORT_SMTP_PASSWORD not set in {SRC} -- add it (root), then re-run.")

want = {
    "SMTP_HOST": "192.168.56.129",
    "SMTP_PORT": "587",
    "SMTP_SECURE": "false",
    "SMTP_ALLOW_SELF_SIGNED": "true",
    "SMTP_USER": "support@homeandofficemicro.com",
    "SMTP_PASS": pw,
    "ALERT_EMAIL_FROM": "Asset Balancer <support@homeandofficemicro.com>",
    "ALERT_EMAIL_TO": "theodore@buitendyk.ca",
}
with open(DST) as f:
    lines = f.read().splitlines()
seen, out = set(), []
for ln in lines:
    key = ln.split("=", 1)[0] if ("=" in ln and not ln.lstrip().startswith("#")) else None
    if key in want:
        out.append(f"{key}={want[key]}")
        seen.add(key)
    else:
        out.append(ln)
for k, v in want.items():
    if k not in seen:
        out.append(f"{k}={v}")
with open(DST, "w") as f:
    f.write("\n".join(out) + "\n")
print(f"updated {DST}: SMTP_* -> authenticated submission as support@ (pw from deploy-control env)")

subprocess.run(["chown", "root:balancer", DST], check=True)
subprocess.run(["chmod", "640", DST], check=True)
subprocess.run(["systemctl", "restart", "asset-balancer"], check=True)
time.sleep(2)

with urllib.request.urlopen("http://127.0.0.1:8091/api/session", timeout=10) as r:
    print("session:", r.read().decode())

req = urllib.request.Request("http://127.0.0.1:8091/api/test-email", method="POST")
try:
    with urllib.request.urlopen(req, timeout=90) as r:
        print("test-email:", r.read().decode())
        print("-> check the ALERT_EMAIL_TO inbox for '[Asset Balancer] Test email'.")
except urllib.error.HTTPError as e:
    print("test-email FAILED:", e.read().decode())
    sys.exit(1)
PY
