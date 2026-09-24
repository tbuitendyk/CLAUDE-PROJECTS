#!/usr/bin/env bash
# uts-set-sizing.sh -- READ-ONLY. The conviction sizing and stops STORED on
# every Stage 4 record set whose name holds a phrase (default "HALF LIFE TABLE
# (cmp)"), as its own document holds them in stopChoices -- grouped where many
# survivors carry the same one -- and, for every held or reserve set read from
# it, what that set froze at its press and what its tuned block worked out.
# Reads the set files only: nothing written, nothing asked of the service.
set -uo pipefail
PHRASE="${1:-HALF LIFE TABLE (cmp)}"
D=/opt/ultimate-trading-system/data/stagesets
sudo -u uts python3 - "$D" "$PHRASE" <<'PY'
import json, glob, os, sys, collections
D, phrase = sys.argv[1], sys.argv[2]
docs = {}
for f in glob.glob(os.path.join(D, 's4-*.json')):
    try:
        d = json.load(open(f))
    except Exception:
        continue
    docs[d.get('id')] = d
def grouped(choices, what):
    g = collections.OrderedDict()
    for L, c in (choices or {}).items():
        v = (c or {}).get(what) if what == 'sizing' else ((c or {}).get('stopPct') if 'stopPct' in (c or {}) else None)
        k = json.dumps(v, sort_keys=True)
        g.setdefault(k, []).append(L)
    return g
rules = [d for d in docs.values() if phrase in str(d.get('name') or '')]
print('sets whose name holds "%s": %d' % (phrase, len(rules)))
for r in rules:
    ch = r.get('stopChoices') or {}
    der = r.get('derived') or {}
    print('\n== %s (%s)' % (r.get('name'), r.get('id')))
    print('   kind %s | release %s | half-life: %s | survivors %d | survivors with a choice on record %d | capture %s' % (
        r.get('kind') or 'funnel', r.get('release'), json.dumps({k: der.get(k) for k in ('kind', 'complete', 'from', 'run')}) if der else 'no',
        len(r.get('survivors') or []), len(ch), 'yes' if r.get('capture') else 'no'))
    for what in ('sizing', 'stop'):
        for k, labels in grouped(ch, what).items():
            print('   %s %s  <- %d survivor(s), e.g. %s' % (what, k, len(labels), '; '.join(labels[:2])))
    judged = [d for d in docs.values() if (d.get('from') or {}).get('id') == r.get('id') and d.get('kind') in ('held', 'reserve')]
    for j in sorted(judged, key=lambda x: (str(x.get('kind')), x.get('number') or 0)):
        jc = j.get('stopChoices') or {}
        b = j.get('block') or {}
        t = b.get('tuned') or {}
        print('\n   %s set: %s (%s) pressed %s under release %s' % (j.get('kind'), j.get('name'), j.get('id'), str(b.get('at') or '')[:16], j.get('release')))
        print('     choices frozen at its press: %d survivor(s); the same as the rule holds now: %s' % (len(jc), jc == ch))
        for what in ('sizing', 'stop'):
            for k, labels in grouped(jc, what).items():
                print('     %s %s  <- %d survivor(s)' % (what, k, len(labels)))
        rows = t.get('rows') or []
        print('     tuned block: window %s | survivors %s | with a tuning %s | worked out %s | read into the money %s | why: %s' % (
            t.get('window'), t.get('of'), t.get('withATuning'), t.get('priced'), t.get('readInto'), t.get('why')))
        if rows:
            tot = lambda f: round(sum((x.get(f) or 0) for x in rows), 2)
            print('     over the %d worked out: plain %s | flat %s | with the stop %s | with the sizing %s' % (len(rows), tot('plainUsd'), tot('flatUsd'), tot('stopUsd'), tot('tunedUsd')))
            for x in rows[:5]:
                print('       - %s: plain %s flat %s stop %s sized %s, %s clips a trade over %s trades' % (x.get('label'), x.get('plainUsd'), x.get('flatUsd'), x.get('stopUsd'), x.get('tunedUsd'), x.get('clipsPerTrade'), x.get('trades')))
PY
