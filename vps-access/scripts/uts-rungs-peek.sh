#!/usr/bin/env bash
# READ-ONLY: across the WHOLE stage 3 set, what did each half of the
# agreement piece actually do? Groups the every-coin rows into families
# (coin, geometry, rest of the name) and asks: are the eight /8 variants
# identical everywhere? which adjacent /6 rungs are identical, and how
# often? Writes nothing.
set -euo pipefail
cd /opt/ultimate-trading-system
python3 - <<'PY'
import gzip, json, collections

t = json.load(gzip.open('data/stagesets/s3-mtb7gy7e-1-tally.json.gz'))
coins = t['coins']

def split_label(cl):
    parts = str(cl).split(' ', 1)
    agree = parts[0]
    rest = parts[1] if len(parts) > 1 else ''
    if '+' not in agree or not agree.startswith('q'):
        return None
    six, eight = agree[1:].split('+', 1)
    return six, eight, rest

def sig(k):
    return (round(k.get('share') or -999, 12), round(k.get('avgHold') or -999, 6),
            round(k.get('avgTest') or -999, 6), k.get('rows'))

fams = collections.defaultdict(dict)
for k in coins:
    s = split_label(k.get('cellLabel'))
    if not s:
        continue
    six, eight, rest = s
    key = (k.get('trade'), k.get('ctx1') or '', k.get('geometry'), rest)
    fams[key][(six, eight)] = sig(k)

n_fam = 0
eight_all_same = 0
eight_differs = 0
adj6 = collections.Counter()
adj6_total = 0
distinct6 = collections.Counter()
SIXES = ['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']
EIGHTS = ['1/8', '2/8', '3/8', '4/8', '5/8', '6/8', '7/8', '8/8']
for key, cells in fams.items():
    n_fam += 1
    ok8 = True
    for six in SIXES:
        sigs = [cells.get((six, e)) for e in EIGHTS]
        sigs = [x for x in sigs if x is not None]
        if len(sigs) > 1 and len(set(sigs)) > 1:
            ok8 = False
    if ok8:
        eight_all_same += 1
    else:
        eight_differs += 1
    row6 = [cells.get((s, '1/8')) for s in SIXES]
    have = [x for x in row6 if x is not None]
    if len(have) == 6:
        adj6_total += 1
        for i in range(5):
            if row6[i] == row6[i + 1]:
                adj6['%s=%s' % (SIXES[i], SIXES[i + 1])] += 1
        distinct6[len(set(row6))] += 1

print('families (coin x geometry x rest of name): %d' % n_fam)
print('families where ALL eight /8 variants are identical: %d' % eight_all_same)
print('families where ANY /8 variant differs:              %d' % eight_differs)
print('')
print('across the /6 rungs (with +1/8 fixed), of %d full families:' % adj6_total)
for pair in ['1/6=2/6', '2/6=3/6', '3/6=4/6', '4/6=5/6', '5/6=6/6']:
    print('  %s identical in %d families' % (pair, adj6.get(pair, 0)))
print('')
print('how many DISTINCT results the six /6 rungs produce per family:')
for n in sorted(distinct6):
    print('  %d distinct: %d families' % (n, distinct6[n]))

print('')
print('WHICH units pair up (3 distinct) vs not, by coin and geometry:')
paired = collections.Counter()
free = collections.Counter()
for key, cells in fams.items():
    row6 = [cells.get((s, '1/8')) for s in SIXES]
    if len([x for x in row6 if x is not None]) != 6:
        continue
    unit = (key[0], key[2])
    if len(set(row6)) == 3:
        paired[unit] += 1
    else:
        free[unit] += 1
pu = sorted(set(paired))
fu = sorted(set(free))
both = [u for u in pu if u in set(fu)]
print('units that ALWAYS pair: %d' % len([u for u in pu if u not in set(fu)]))
geos = collections.Counter(g for (c, g) in pu if (c, g) not in set(fu))
print('  their geometries: %s' % json.dumps(dict(geos)))
print('  first few: %s' % ', '.join('%s %s' % u for u in pu[:6]))
print('units that never pair: %d' % len([u for u in fu if u not in set(pu)]))
geos2 = collections.Counter(g for (c, g) in fu if (c, g) not in set(pu))
print('  their geometries: %s' % json.dumps(dict(geos2)))
print('units mixed (some families pair, some do not): %d' % len(both))
PY
