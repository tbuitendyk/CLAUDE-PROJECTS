#!/usr/bin/env bash
# READ-ONLY: what the agreement piece of a setting's name actually did in the
# owner's stage 3 tables. Reads the tally file and the set documents; writes
# nothing, restarts nothing.
set -euo pipefail
cd /opt/ultimate-trading-system
python3 - <<'PY'
import gzip, json, glob, collections

print('== the chain documents ==')
for f in sorted(glob.glob('data/stagesets/s*-*.json')):
    try:
        d = json.load(open(f))
    except Exception:
        continue
    if not isinstance(d, dict) or 'stage' not in d:
        continue
    pr = d.get('params') or {}
    plan = d.get('plan') or {}
    print('%s  %s  stage %s  sizes=%s  universe=%s coins  units=%s' % (
        d.get('id'), d.get('name'), d.get('stage'),
        json.dumps(pr.get('sizes')), len(pr.get('universe') or []), plan.get('units')))

t = json.load(gzip.open('data/stagesets/s3-mtb7gy7e-1-tally.json.gz'))
coins = t['coins']
ranked = t['ranked']
print('')
print('== what was actually priced ==')
ctx = [k for k in coins if k.get('ctx1')]
print('every-coin rows: %d;  rows whose coin is read alongside another: %d' % (len(coins), len(ctx)))
for k in ctx[:3]:
    print('  example: %s | %s + %s' % (k.get('cellLabel'), k.get('trade'), k.get('ctx1')))

mem = collections.Counter((r.get('quorum'), r.get('members')) for r in ranked)
print('')
print('quorum/members recorded on ranked rows:')
for (q, m), n in sorted(mem.items(), key=lambda x: (str(x[0][1]), str(x[0][0]))):
    print('  %s of %s members  x %d settings' % (q, m, n))

pre = sorted(set(str(r.get('label', '')).split(' ')[0] for r in ranked))
print('')
print('distinct agreement pieces in the ranked names: %d' % len(pre))
print('  ' + ' '.join(pre))

print('')
print('== same coin, same /6 half, varying /8 half — do the numbers move? ==')
fam = collections.defaultdict(list)
for k in coins:
    cl = str(k.get('cellLabel', ''))
    parts = cl.split(' ', 1)
    agree = parts[0]
    rest = parts[1] if len(parts) > 1 else ''
    if '+' in agree:
        six, eight = agree.split('+', 1)
        key = (k.get('trade'), k.get('ctx1') or '', k.get('geometry'), six, rest)
        fam[key].append((eight, k.get('share'), k.get('avgHold'), k.get('avgTest'), k.get('avgTrades'), k.get('rows')))
shown = 0
for key, v in sorted(fam.items()):
    if len(v) > 1 and shown < 2:
        shown += 1
        print('%s %s | %s | %s ... %s' % (key[0], ('+ ' + key[1]) if key[1] else '(on its own)', key[2], key[3], key[4]))
        for e in sorted(v):
            print('  +%s  share=%s  avgHold=%s  avgTest=%s  avgTrades=%s  rows=%s' % e)
if not shown:
    print('no coin has more than one /8 variant of the same /6 half in this set')

print('')
print('== and the other way: same /8 half, varying /6 ==')
fam2 = collections.defaultdict(list)
for k in coins:
    cl = str(k.get('cellLabel', ''))
    parts = cl.split(' ', 1)
    agree = parts[0]
    rest = parts[1] if len(parts) > 1 else ''
    if '+' in agree:
        six, eight = agree.split('+', 1)
        key = (k.get('trade'), k.get('ctx1') or '', k.get('geometry'), eight, rest)
        fam2[key].append((six, k.get('share'), k.get('avgHold')))
shown = 0
for key, v in sorted(fam2.items()):
    if len(v) > 1 and shown < 1:
        shown += 1
        print('%s %s | %s | +%s ... %s' % (key[0], ('+ ' + key[1]) if key[1] else '(on its own)', key[2], key[3], key[4]))
        for e in sorted(v):
            print('  %s  share=%s  avgHold=%s' % e)
PY
