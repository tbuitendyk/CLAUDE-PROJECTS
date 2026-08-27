#!/usr/bin/env bash
# uts-stages-smoke.sh -- deploy smoke for the three-stage system. SELF-
# ADVANCING: each invocation looks at what exists and takes the next step —
# fire stage 1 (two real coins, daily-1d), then stage 2, then stage 3, then
# print the tables. Small on purpose; the record sets it leaves behind are
# real, honestly described, and the first thing Boards3 shows.
set -uo pipefail
B=http://127.0.0.1:8094
DESC="deploy smoke 2026-08-27"
python3 - "$B" "$DESC" <<'PY'
import json, sys, time, urllib.request

B, DESC = sys.argv[1], sys.argv[2]
def get(p):
    return json.load(urllib.request.urlopen(B + p, timeout=30))
def post(p, body):
    req = urllib.request.Request(B + p, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'}, method='POST')
    try:
        return json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode() or '{}')

st = get('/api/stagesets')
sets = [s for s in st.get('sets', []) if s.get('desc') == DESC]
by = {}
for s in sets:
    by.setdefault(s['stage'], []).append(s)
running = st.get('running')
if running:
    row = next((s for s in st.get('sets', []) if s['id'] == running), None)
    print('RUNNING:', row and row.get('name'), '-', row and row.get('progress'))
    sys.exit(0)

def fresh(stage):
    return next((s for s in by.get(stage, []) if s['status'] == 'done'), None)

s1, s2, s3 = fresh(1), fresh(2), fresh(3)
if not s1:
    got = post('/api/stage1', {
        'universe': ['LTCUSDT', 'XRPUSDT'], 'sizes': {'singles': True},
        'geometry': 'daily-1d', 'windowLayout': 'split70', 'allLoaded': True,
        'nullN': 9, 'desc': DESC,
    })
    print('fired stage 1:', json.dumps(got))
    sys.exit(0)
if not s2:
    got = post('/api/stage2', {'from': s1['id'], 'orderBy': 'beat', 'carry': 0, 'desc': DESC})
    print('fired stage 2 on', s1['name'], ':', json.dumps(got))
    sys.exit(0)
if not s3:
    got = post('/api/stage3', {
        'from': s2['id'], 'fee': 0.00125, 'nullN': 9, 'desc': DESC,
        'decision': 'argmax', 'band': 'auto', 'weekdaysOnly': False, 'permuteDecision': True,
        'cell': {'entry': 'breakout', 'gate': 'directional', 'dMult': 1.5, 'tHours': 65,
                 'quorumSingles': 2, 'quorumContexts': 3},
        'cellPermute': {'tHours': True},
    })
    print('fired stage 3 on', s2['name'], ':', json.dumps(got))
    sys.exit(0)

print('ALL THREE DONE — the tables:')
t1 = get('/api/stageset/%s/stage1?from=0&n=10' % s1['id'])
for r in t1['rows']:
    print('  S1 rank %s: %-8s score %.2f beat %s/%s lead %s' % (r['rank'], r['trade'], r['score'], r['beat'], r['pairs'], r['lead'] and round(r['lead'], 2)))
t2 = get('/api/stageset/%s/stage2?from=0&n=10' % s2['id'])
for r in t2['rows']:
    print('  S2 carried %s: %-8s members %s (%s logreg + %s boost) score3 %.2f all %.2f helped %+.2f' % (
        r['carriedRank'], r['trade'], r['members'], r['logreg'], r['boost'], r['score3'], r['scoreAll'], r['helped']))
rk = get('/api/stageset/%s/ranked?from=0&n=3' % s3['id'])
print('  S3 ranked: %s settings; top row: %s %s t%sh q%s/%s — coins %s, in the money %s, avg held-back %s, beat %s/%s' % (
    rk['total'], rk['rows'][0]['decision'], rk['rows'][0]['entry'], rk['rows'][0]['tHours'],
    rk['rows'][0]['quorum'], rk['rows'][0]['members'], rk['rows'][0]['coins'], rk['rows'][0]['coinsInMoney'],
    rk['rows'][0]['avgHold'] and round(rk['rows'][0]['avgHold'], 2), rk['rows'][0]['beat'], rk['rows'][0]['pairs']))
cs = get('/api/stageset/%s/coins?sort=share&limit=3' % s3['id'])
for r in cs['rows']:
    print('  S3 coin: %-22s %-8s share %s beat %s/%s rows %s' % (r['cellLabel'], r['trade'],
        r['share'] is not None and round(r['share'] * 100, 1), r['beat'], r['pairs'], r['rows']))
ch = get('/api/stageset/%s' % s3['id'])
print('  chain:', ' -> '.join('%s(%s)' % (c['name'], c['status']) for c in ch['chain']))
PY
