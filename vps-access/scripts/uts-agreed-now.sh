#!/usr/bin/env bash
# uts-agreed-now.sh -- READ-ONLY. Is "share that agreed" filled in on the
# newest stage 3 set, and what are its four numbers on each table? Also says
# whether the answers file exists and how the tables were totalled.
set -uo pipefail
B=http://127.0.0.1:8094
curl -sf --max-time 25 "$B/api/stagesets" -o /tmp/uts-an-sets.json || { echo "no answer"; exit 1; }
ID=$(python3 -c '
import json
s=[x for x in (json.load(open("/tmp/uts-an-sets.json")).get("sets") or []) if str(x.get("stage"))=="3"]
print(s[0]["id"] if s else "")')
[ -n "$ID" ] || { echo "no stage 3 set"; exit 1; }
echo "stage 3 set: $ID"
ls -la "/opt/ultimate-trading-system/data/stagesets/$ID-agreed.json.gz" 2>/dev/null || echo "  NO answers file on disk"
ls -la "/opt/ultimate-trading-system/data/stagesets/$ID-tally.json.gz" 2>/dev/null || echo "  NO tally file on disk"
python3 -c "
import json
d=json.load(open('/opt/ultimate-trading-system/data/stagesets/$ID.json'))
print(' status:', d.get('status'), '| tallyError:', d.get('tallyError'), '| agreedError:', d.get('agreedError'))
print(' plan.settings:', (d.get('plan') or {}).get('settings'), '| plan.units:', (d.get('plan') or {}).get('units'))
" 2>/dev/null || echo "  (set document unreadable)"
curl -sf --max-time 120 "$B/api/stageset/$ID/ranked?from=0&n=3" -o /tmp/uts-an-r.json || echo "  (ranked did not answer)"
curl -sf --max-time 120 "$B/api/stageset/$ID/coins?limit=3" -o /tmp/uts-an-c.json || echo "  (coins did not answer)"
python3 <<'PY'
import json
def L(p):
    try: return json.load(open(p))
    except Exception: return {}
r=L('/tmp/uts-an-r.json'); c=L('/tmp/uts-an-c.json')
if r.get('totalling') or r.get('waiting'):
    print('  the tables are still building:', r.get('totalling') or r.get('waiting')); raise SystemExit
print()
print('  Table 3.A total', r.get('total'), ' agreedError:', r.get('agreedError'))
sp=(r.get('spread') or {}).get('agreedMin')
print('  Table 3.A share that agreed  min/median/avg/max:', None if not sp else
      [round(sp['min'],2), round(sp['median'],2), round(sp['avg'],2), round(sp['max'],2), 'n=%d'%sp['n']])
for row in (r.get('rows') or [])[:3]:
    print('    ', row.get('agreeRule'), 'rung', row.get('avgRung'), 'of', row.get('members'),
          '-> agreed', None if row.get('avgAgreed') is None else round(row['avgAgreed'],2))
sp2=(c.get('spread') or {}).get('minAgreed')
print('  Table 3.B total', c.get('total'))
print('  Table 3.B share that agreed  min/median/avg/max:', None if not sp2 else
      [round(sp2['min'],2), round(sp2['median'],2), round(sp2['avg'],2), round(sp2['max'],2), 'n=%d'%sp2['n']])
PY
