#!/usr/bin/env bash
# uts-gl-picture.sh -- READ-ONLY. Greenlight's own request for one held or
# reserve set (default: the newest whose name holds "HALF LIFE TABLE (cmp)"
# and ends "#3"), exactly as the screen sends it, and what came back: the
# refusal, the survivor by depth, the picture's stretch lines, and the one
# survivor's $ / no tuning $ / tuned $ per stretch -- with a count across
# every survivor of where $ and no tuning $ part. One GET; nothing written.
set -uo pipefail
PHRASE="${1:-HALF LIFE TABLE (cmp)}"
SUFFIX="${2:-#3}"
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data/stagesets
ID=$(sudo -u uts python3 - "$D" "$PHRASE" "$SUFFIX" <<'PY'
import json, glob, os, sys
D, phrase, suffix = sys.argv[1], sys.argv[2], sys.argv[3]
best = None
for f in glob.glob(os.path.join(D, 's4-*.json')):
    try: d = json.load(open(f))
    except Exception: continue
    n = str(d.get('name') or '')
    if d.get('kind') in ('held', 'reserve') and phrase in n and n.endswith(suffix):
        if best is None or str(d.get('createdAt')) > str(best.get('createdAt')): best = d
print(best['id'] if best else '')
PY
)
[ -n "$ID" ] || { echo "no held or reserve set whose name holds \"$PHRASE\" and ends \"$SUFFIX\""; exit 0; }
echo "set: $ID"
curl -sf --max-time 170 "$B/api/live/greenlight/stage4/$ID" -o /tmp/uts-glp.json || { echo "no answer from the service in 170 s"; exit 0; }
python3 - <<'PY'
import json
d = json.load(open('/tmp/uts-glp.json'))
print('refused:', d.get('refused'))
print('by depth:', json.dumps(d.get('depthPick')))
p = d.get('picture') or {}
print('picture why:', p.get('why'))
for k in p.get('stretches') or []:
    x = (p.get('rule') or {}).get(k) or {}
    print('  %-8s $ a setting %s | trades %s | read %s | clear all four %s of %s | why %s' % (k, x.get('money'), x.get('trades'), x.get('of'), x.get('clearing'), x.get('survivors'), x.get('why')))
print('tunings on the rule:', json.dumps((p.get('rule') or {}).get('tunings')))
label = (d.get('depthPick') or {}).get('label')
svs = p.get('survivors') or []
sv = next((s for s in svs if s.get('label') == label), None)
if sv:
    print('\none survivor (by depth):', label)
    print('  tunings:', json.dumps(sv.get('tunings')))
    t = sv.get('tuned') or {}
    for k in p.get('stretches') or []:
        c = sv.get(k) or {}
        w = (t.get('windows') or {}).get(k) or {}
        print('  %-8s $ %s | trades %s | clears %s | no tuning $ %s | tuned $ %s | stopped %s of %s | clips a trade %s | trades in the capture %s' % (
            k, c.get('money'), c.get('trades'), c.get('clears'), w.get('flatUsd'), w.get('tunedUsd'), w.get('stopped'), w.get('priced'), w.get('clipsPerTrade'), w.get('trades')))
print('\nacross all %d survivors, per stretch: the sum of $, the sum of no tuning $, and how many part by a cent or more' % len(svs))
for k in p.get('stretches') or []:
    a = b = 0.0; n = part = both = 0
    for s in svs:
        c = (s.get(k) or {}).get('money'); w = (((s.get('tuned') or {}).get('windows') or {}).get(k) or {}).get('flatUsd')
        if c is not None and w is not None:
            both += 1; a += c; b += w
            if abs(c - w) >= 0.01: part += 1
    print('  %-8s with both %d | sum $ %.2f | sum no tuning $ %.2f | part by a cent or more %d' % (k, both, a, b, part))
PY
