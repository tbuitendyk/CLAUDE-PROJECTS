#!/usr/bin/env bash
# uts-set-tables-peek.sh -- READ-ONLY. What the two tables of one stage 3 set
# answer, row by row for the first few rows: the money columns Boards draws
# (avg test $, avg held-back $, avg test trades, the field columns) and the
# set document's own status, progress and errors. Asks the same two routes
# the page asks. Writes nothing, starts nothing.
#   arg: <setId>
set -uo pipefail
ID="${1:-}"
[ -n "$ID" ] || { echo "usage: <setId>"; exit 0; }
B=http://127.0.0.1:8094
curl -sf --max-time 60 "$B/api/stageset/$ID" -o /tmp/uts-stp-doc.json || echo "(set document did not answer)"
curl -sf --max-time 120 "$B/api/stageset/$ID/ranked?from=0&n=4" -o /tmp/uts-stp-ranked.json || echo "(ranked did not answer)"
curl -sf --max-time 120 "$B/api/stageset/$ID/coins?offset=0&limit=8" -o /tmp/uts-stp-coins.json || echo "(coins did not answer)"
python3 <<'PY'
import json
def load(p):
    try: return json.load(open(p))
    except Exception as e: return {'_err': str(e)}
doc = (load('/tmp/uts-stp-doc.json') or {}).get('set') or {}
rk = load('/tmp/uts-stp-ranked.json'); cn = load('/tmp/uts-stp-coins.json')
print('set', doc.get('id'), doc.get('name'), '| status', doc.get('status'), '| progress', repr(doc.get('progress')))
print('  counts', doc.get('counts'), '| tallyError', doc.get('tallyError'), '| agreedError', doc.get('agreedError'), '| error', doc.get('error'))
print('ranked: keys', sorted(k for k in rk.keys() if k != 'rows'), '| total', rk.get('total'), '| totalling', rk.get('totalling'), '| error', rk.get('error'))
for r in (rk.get('rows') or [])[:4]:
    print('  ', {k: r.get(k) for k in ['si','label','coins','avgTest','avgHold','avgTestTrades','avgTrades','fieldVerdict','fieldSized','fieldBlocked','fieldRead','beatNoise','noisePairs']})
print('coins: keys', sorted(k for k in cn.keys() if k != 'rows'), '| total', cn.get('total'), '| error', cn.get('error'))
for r in (cn.get('rows') or [])[:8]:
    print('  ', {k: r.get(k) for k in ['cellLabel','trade','geometry','fieldLabel','rows','avgTest','avgHold','avgTestTrades','avgTrades','share','fieldVerdict','fieldSized','beatNoise','noisePairs']})
PY
