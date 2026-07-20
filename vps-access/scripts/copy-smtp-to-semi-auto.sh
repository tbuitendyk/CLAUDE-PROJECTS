#!/usr/bin/env bash
# copy-smtp-to-semi-auto.sh -- duplicate the OLD balancer's working email
# configuration into the semi-auto balancer, entirely ON THE BOX. Reads the
# SMTP + alert-address keys from /etc/asset-balancer/env (the frozen app that
# demonstrably sends mail) and writes them into /etc/semi-auto-balancer/env,
# then restarts the unit and reports whether the mailer came up configured.
# SECRETS NEVER LEAVE THE HOST: this script prints key NAMES only, never
# values. A timestamped backup of the target env is kept beside it.
set -euo pipefail
SRC="/etc/asset-balancer/env"
DST="/etc/semi-auto-balancer/env"
KEYS=(SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_ALLOW_SELF_SIGNED SMTP_USER SMTP_PASS ALERT_EMAIL_FROM ALERT_EMAIL_TO)

[[ -f "$SRC" ]] || { echo "source $SRC not found — is the old balancer installed?"; exit 1; }
[[ -f "$DST" ]] || { echo "target $DST not found — deploy the semi-auto balancer first"; exit 1; }

cp "$DST" "${DST}.bak-$(date +%Y%m%d%H%M%S)"

copied=()
missing=()
for key in "${KEYS[@]}"; do
  line=$(grep -E "^${key}=" "$SRC" | tail -n 1 || true)
  if [[ -z "$line" ]]; then
    missing+=("$key")
    continue
  fi
  # Replace any existing assignment in the target, then append the source's.
  sed -i "/^${key}=/d" "$DST"
  printf '%s\n' "$line" >> "$DST"
  copied+=("$key")
done

echo "copied from old balancer env: ${copied[*]:-none}"
[[ ${#missing[@]} -gt 0 ]] && echo "absent in source (left as-is): ${missing[*]}"

echo "== restarting semi-auto-balancer =="
systemctl restart semi-auto-balancer
for i in $(seq 1 20); do
  sleep 1
  if curl -sf http://127.0.0.1:8092/api/session >/dev/null 2>&1; then break; fi
done
curl -sS -m 10 http://127.0.0.1:8092/api/session | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('emailConfigured:', d.get('emailConfigured'))"

echo "== sending a test email through the new transport =="
if [[ -x /usr/bin/node && -f /opt/semi-auto-balancer/scripts/test-email.js ]]; then
  # Parse the env file the way systemd does (no shell expansion — passwords
  # may contain $ or spaces) and run the app's own test-email script with it.
  python3 - "$DST" <<'PY' && echo "test email: SENT" || echo "test email: FAILED (see above)"
import os, subprocess, sys
env = dict(os.environ)
for line in open(sys.argv[1]):
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    k, v = line.split('=', 1)
    env[k.strip()] = v.strip()
os.chdir('/opt/semi-auto-balancer')
sys.exit(subprocess.run(['node', 'scripts/test-email.js'], env=env).returncode)
PY
else
  echo "test-email script not found — check the pill in the UI instead"
fi
