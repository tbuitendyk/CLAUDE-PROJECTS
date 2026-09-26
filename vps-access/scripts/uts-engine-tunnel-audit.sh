#!/usr/bin/env bash
# uts-engine-tunnel-audit.sh -- READ-ONLY. Does anything still use the old SSH
# tunnel to the trading engine? (owner, 2026-09-26: "confirm that nothing on the
# server needs the old tunnel code"). Nothing here changes anything: it reads the
# service's own records and asks both machines what is running and listening.
#   * every engine record and how it is reached (never its token's fingerprint);
#   * every engine checklist's template;
#   * the tunnel's unit on this machine, and anything listening on its port;
#   * on the trading box: whether the engine listens on any port, and the NAMES
#     of its settings (never their values).
# The old order program is not looked at beyond what uts-engine-deploy.sh already
# checks; its own path (the mx-1 box it is carried to) is not the engine's tunnel.
set -uo pipefail
DATA=/opt/ultimate-trading-system/data/live
BOX=admin@ec2-78-13-103-81.mx-central-1.compute.amazonaws.com
KEY=/root/.ssh/aws-mex-deb13-new.pem

echo "== engine records =="
python3 - "$DATA/targets.json" <<'PY'
import json, sys
try: d = json.load(open(sys.argv[1]))
except Exception as e: print('  no records file:', e); d = {}
engines = [t for t in d.values() if isinstance(t, dict) and t.get('kind') == 'engine']
for t in engines: print(f"  {t.get('id')} | link {t.get('link')} | release {t.get('release')} | tunnel fields {[k for k in ('host','user','enginePort','localPort') if k in t]}")
others = [t.get('id') for t in d.values() if isinstance(t, dict) and t.get('kind') != 'engine']
print(f"  engines: {len(engines)} | reached through the tunnel: {sum(1 for t in engines if t.get('link') != 'calls-out')} | other targets in the file: {others}")
PY

echo "== engine checklists =="
python3 - "$DATA/engine-setups" <<'PY'
import json, os, sys
d = sys.argv[1]
names = sorted(f for f in os.listdir(d) if f.endswith('.json')) if os.path.isdir(d) else []
for f in names:
    r = json.load(open(os.path.join(d, f)))
    print(f"  {r.get('name')} | template {r.get('templateVersion')} | engine {r.get('engineId')}")
print(f"  checklists: {len(names)} | on template 1: {sum(1 for f in names if json.load(open(os.path.join(d, f))).get('templateVersion') == 1)}")
PY
echo "  old sign-in key folder: $([ -e "$DATA/engine-keys" ] && echo "present ($(ls "$DATA/engine-keys" | wc -l) entries)" || echo absent)"

echo "== the tunnel on this machine =="
echo "  unit file: $([ -e /etc/systemd/system/uts-engine-link.service ] && echo present || echo absent) | state: $(systemctl is-active uts-engine-link 2>/dev/null || true)"
echo "  listening on 18095: $(ss -ltn 2>/dev/null | awk '{print $4}' | grep -c ':18095$')"
echo "  mirror folders: $(ls "$DATA/engine" 2>/dev/null | tr '\n' ' ')"

echo "== the engine on the trading box =="
ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new "$BOX" 'bash -s' <<'R'
echo "  service: $(systemctl is-active uts-engine)"
echo "  ports the engine listens on: $(sudo ss -ltnp 2>/dev/null | grep -c 'node')"
echo "  its settings name: $(sudo python3 -c "import json; print(sorted(json.load(open('/var/lib/uts-engine/config.json')).keys()))")"
echo "  its password file: $(sudo test -f /var/lib/uts-engine/link.json && echo present || echo absent) | linked: $(sudo python3 -c "import json; print(json.load(open('/var/lib/uts-engine/link-status.json')).get('linked'))" 2>/dev/null)"
R
