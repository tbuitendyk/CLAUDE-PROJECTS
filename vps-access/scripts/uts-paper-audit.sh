#!/usr/bin/env bash
# uts-paper-audit.sh -- READ-ONLY. Where the books on Trade stand, and whether
# the machinery under them is doing its job: the service, each paper, live or
# stopped book's decisions (newest first, when each was made), its positions and
# money, the engine link as the book sees it, the reproduce-check, the decision
# producer's last runs, and the service's recent errors. GETs through the
# service and reads files only; prints no keys and no account names. Nothing
# written, nothing started, nothing sent.
set -uo pipefail
B=http://127.0.0.1:8094
cd /opt/ultimate-trading-system || exit 1
echo "== service =="
systemctl show -p ActiveState,SubState,NRestarts,ActiveEnterTimestamp ultimate-trading-system.service --no-pager | sed 's/^/  /'
echo "  release $(python3 -c "import json;print(json.load(open('package.json'))['version'])")"
echo "  now $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "== timers on this machine that mention the trading system =="
systemctl list-timers --all --no-pager 2>/dev/null | grep -i -E 'uts|mirror|trading' | sed 's/^/  /' || echo "  none"
echo "== reproduce-check (data/live/mirror.json) =="
python3 - <<'PY'
import json, os, datetime
f = 'data/live/mirror.json'
if not os.path.exists(f):
    print('  never written')
else:
    print('  file written', datetime.datetime.utcfromtimestamp(os.path.getmtime(f)).isoformat() + 'Z')
    try:
        d = json.load(open(f))
        print(f"  run {d.get('utc')} | setups {d.get('setups')} | breaks {d.get('breaks')} | errors {d.get('errors')}")
        for r in d.get('results', []):
            print(f"   {r.get('setup_id')} ok {r.get('ok')} checked {r.get('checked')} breaks {r.get('breaks')} pending {r.get('pending')} error {r.get('error')}")
    except Exception as e:
        print('  unreadable:', e)
PY
echo "== the decision producer's runs (data/live/engine-produce.jsonl) =="
python3 - <<'PY'
import json
try:
    lines = open('data/live/engine-produce.jsonl').read().strip().split('\n')
except Exception as e:
    print('  none:', e); lines = []
print(f"  lines {len(lines)}")
recent = []
for l in lines[-3000:]:
    try: recent.append(json.loads(l))
    except Exception: pass
bad = [j for j in recent if j.get('ok') is False]
print(f"  failed runs among the last {len(recent)}: {len(bad)}" + (f" (first {recent[0].get('at')})" if recent else ''))
for j in recent[-3:]:
    print(f"  {j.get('at')} ok {j.get('ok')} | out: {str(j.get('out', ''))[-400:]!r} | err: {str(j.get('err', ''))[-200:]!r}")
for j in bad[-4:]:
    print(f"  FAILED {j.get('at')} | err: {str(j.get('err', ''))[-300:]!r} | cancelled {str(j.get('cancelled'))[:200]}")
# the runs that did something, not the ones that found nothing to do
acts = [j for j in recent if j.get('out') and ('sent' in str(j.get('out')).lower() or 'decid' in str(j.get('out')).lower())]
print(f"  runs whose output says sent or decided, among the last {len(recent)}: {len(acts)}")
for j in acts[-6:]:
    print(f"   {j.get('at')} | {str(j.get('out'))[-300:]!r}")
PY
echo "== books =="
curl -s --max-time 30 "$B/api/live/setups" > /tmp/uts-audit-setups.json
python3 - <<'PY'
import json, urllib.request
d = json.load(open('/tmp/uts-audit-setups.json'))
rows = d.get('setups', [])
print(f"books on the box: {len(rows)}")
for s in rows:
    print(f"- {s.get('id')} | {s.get('name')} | state {s.get('state')} | pair {s.get('tradedPair')} | target {s.get('executionTargetRef')}")
def get(u, t=60):
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:8094{u}", timeout=t))
for s in rows:
    if s.get('state') not in ('paper', 'live', 'stopped'):
        continue
    sid = s['id']
    try:
        st = get(f"/api/live/setups/{sid}/status")
        full = get(f"/api/live/setups/{sid}", 30)
    except Exception as e:
        print(f"\n## {sid}: unreadable: {e}")
        continue
    print(f"\n## {st.get('name')} ({sid}) | state {st.get('state')} | run since {st.get('runEpochUtc')} | greenlight {full.get('provenanceRef')}")
    print(f"   members train {full.get('trainPolicy')} | clip {st.get('clipUsd')} | stop % {st.get('stopPct')} | fee a leg {st.get('feePerLeg')} (inherited {st.get('feeInherited')})")
    print(f"   journal present {st.get('journalPresent')} dropped {st.get('journalDropped')} unterminated {st.get('journalUnterminated')} | unreadable figures {st.get('unreadableFigures')}")
    print(f"   mark {st.get('markPrice')} at {st.get('markUtc')} | paper realized {st.get('paperRealizedPnl')} unrealized {st.get('paperUnrealizedPnl')} | real realized {st.get('realizedPnl')}")
    print(f"   halted {st.get('halted')} {st.get('haltReason') or ''}")
    eng = st.get('engine') or {}
    print(f"   engine {eng.get('name')} | link {json.dumps(eng.get('link'))[:240]} | last health {json.dumps(eng.get('lastHealth'))[:300]}")
    print(f"   reproduce-check {json.dumps(st.get('mirror'))[:400]}")
    print(f"   pending {json.dumps(st.get('pending'))[:400]}")
    print(f"   next {json.dumps(st.get('liveStatus'))[:400]}")
    decs = st.get('decisions') or []
    print(f"   decisions shown {len(decs)} (newest first):")
    for x in decs[:14]:
        print(f"     {x.get('chunk_start')} acts {x.get('entry_utc')} | {x.get('side')} | {x.get('fate')} | price {x.get('decision_price')} | quorum {x.get('quorum')} | fp {str(x.get('members_fp'))[:12]}{' | MEMBERS CHANGED' if x.get('membersChanged') else ''} | made {x.get('utc')}")
    ops = st.get('openPositions') or []
    print(f"   open positions {len(ops)}:")
    for p in ops:
        print(f"     {json.dumps(p)[:500]}")
    cl = st.get('closedRecent') or []
    print(f"   closed, newest first, {len(cl)} shown:")
    for c in cl[:12]:
        print(f"     {json.dumps(c)[:500]}")
    print("   the engine's plans:")
    for p in (eng.get('plans') or [])[:10]:
        print(f"     {json.dumps(p)[:500]}")
    tc = eng.get('trailChecks') or []
    print(f"   trail checks kept {len(tc)}; newest: {json.dumps(tc[:2])[:500]}")
    print(f"   incidents {json.dumps((st.get('incidents') or [])[:6])[:800]}")
    print(f"   fidelity {json.dumps(st.get('fidelity'))}")
PY
echo "== service errors, last 36 hours (requests filtered) =="
journalctl -u ultimate-trading-system.service --since "36 hours ago" --no-pager -o short-iso 2>/dev/null \
  | grep -v -E "GET /|POST /|healthz" | grep -i -E "error|fail|refus|exception|warn|unhandled" | tail -40 | cut -c1-300
echo "== restarts of the service, last 36 hours =="
journalctl -u ultimate-trading-system.service --since "36 hours ago" --no-pager -o short-iso 2>/dev/null | grep -E "Started|Stopped|Main process exited" | tail -20 | cut -c1-200
