#!/usr/bin/env bash
# uts-paper-training.sh -- READ-ONLY. What each paper, live or stopped book's
# members were trained on: its Members train choice, the training block and
# agreement it carries, what each recent decision recorded (the stretch it
# trained on, how many periods went to train, test and held, the first and last
# training period, the members' fingerprint), and Construct's own cut from the
# greenlight for comparison. GETs through the service only; no keys, no account
# names. Nothing written, nothing started, nothing sent.
set -uo pipefail
B=http://127.0.0.1:8094
curl -s --max-time 30 "$B/api/live/setups" > /tmp/uts-tr-setups.json
curl -s --max-time 30 "$B/api/live/greenlights" > /tmp/uts-tr-gls.json
python3 - <<'PY'
import json, urllib.request, datetime
def get(u, t=60):
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:8094{u}", timeout=t))
gls = {g.get('id'): g for g in json.load(open('/tmp/uts-tr-gls.json')).get('greenlights', [])}
for s in json.load(open('/tmp/uts-tr-setups.json')).get('setups', []):
    if s.get('state') not in ('paper', 'live', 'stopped'):
        continue
    full = get(f"/api/live/setups/{s['id']}", 30)
    st = get(f"/api/live/setups/{s['id']}/status")
    cfg = full.get('configSnapshot') or {}
    tp = full.get('trainPolicy') or {}
    thr = tp.get('throughMs')
    print(f"\n## {full.get('name')} ({s['id']}) | {s.get('state')} | greenlight {full.get('provenanceRef')}")
    print(f"   members train: {tp.get('mode')}" + (f" at {datetime.datetime.utcfromtimestamp(thr/1000).isoformat()}Z" if thr else ''))
    print(f"   training block: {json.dumps(cfg.get('training'))[:400]}")
    print(f"   agreement: {json.dumps(cfg.get('agreement'))[:300]} | geometry {(cfg.get('branch') or {}).get('geometry')} | members {len(cfg.get('members') or [])}")
    g = gls.get(full.get('provenanceRef')) or {}
    c = g.get('construct') or {}
    print(f"   greenlight: {g.get('name')} | pick {json.dumps(g.get('pick'))[:200]}")
    print(f"   Construct's cut: {json.dumps({k: c.get(k) for k in c if k not in ('hours', 'files', 'prices')})[:700]}")
    for d in (st.get('decisions') or [])[:4]:
        print(f"   decision {d.get('chunk_start')} | {d.get('side')} | made {d.get('utc')} | fp {d.get('members_fp')} | train_ms {d.get('train_ms')}")
        print(f"      trained on: {json.dumps(d.get('trained_on'))}")
PY
