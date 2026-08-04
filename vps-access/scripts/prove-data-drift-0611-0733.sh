#!/usr/bin/env bash
# prove-data-drift-0611-0733.sh -- read-only PROOF of whether the candle data
# on the server changed between the 0611 (Aug 3) and 0733 (Aug 4) launches.
# Evidence printed:
#   1. both runs' exact fire times;
#   2. every cache file for UNIUSDT/DOGEUSDT/LTCUSDT written AFTER 0611 fired
#      (these files could not have been read by 0611 but were read by 0733,
#      because both runs are all-loaded = read the whole cache);
#   3. the UNI daily-2d row's stored fields from both runs side by side
#      (the row that moved) and the LTC row (the control that did not);
#   4. the 0733 row's window stamps -- window END dates in August prove the
#      all-loaded run reads far past the 2026-06 month box on the form.
# Writes nothing.
set -euo pipefail
cd /opt/general-classifier
python3 - <<'EOF'
import json, glob, os, datetime
def load(pat):
    f = sorted(glob.glob(f'data/batches/*{pat}*.json'))
    assert f, pat
    return json.load(open(f[0]))
a = load('20260803-0611-null9-census')
b = load('20260804-0733-null9-census')
t_a = a.get('startedAt') or a.get('createdAt')
t_b = b.get('startedAt') or b.get('createdAt')
print(f"0611 fired {t_a} | 0733 fired {t_b}")
cut = datetime.datetime.fromisoformat(t_a.replace('Z','+00:00')).timestamp()
print()
print("1. CACHE FILES WRITTEN AFTER 0611 FIRED (0733 read these, 0611 could not):")
for sym in ('UNIUSDT','DOGEUSDT','LTCUSDT'):
    hits = []
    for f in sorted(glob.glob(f'data/cache/{sym}*')):
        st = os.stat(f)
        if st.st_mtime > cut:
            hits.append(f"   {os.path.basename(f):44s} {st.st_size:>9,} bytes  written {datetime.datetime.utcfromtimestamp(st.st_mtime).isoformat()}Z")
    print(f"  {sym}: {len(hits)} file(s) new or rewritten since 0611 fired")
    for h in hits[:6]: print(h)
print()
def row(d, trade, geom, dec):
    for r in d.get('edgeCensus', []):
        if r.get('nullDealSeed') is None and not r.get('shiftFrac') and r['trade']==trade and r['geometry']==geom and r['decision']==dec:
            return r
    return None
def sidebyside(name, ra, rb):
    print(f"2. {name}: every stored number, 0611 vs 0733 (only differing fields marked *):")
    keys = sorted(set(ra) | set(rb))
    for k in keys:
        va, vb = ra.get(k), rb.get(k)
        if isinstance(va,(dict,list)) or isinstance(vb,(dict,list)): continue
        mark = ' ' if va == vb else '*'
        print(f"  {mark} {k:24s} {str(va)[:34]:34s} | {str(vb)[:34]}")
    print()
u_a, u_b = row(a,'UNIUSDT','daily-2d','directional'), row(b,'UNIUSDT','daily-2d','directional')
sidebyside('UNI daily-2d Up/Down Hunter (the row that MOVED)', u_a, u_b)
l_a, l_b = row(a,'LTCUSDT','daily-4d','argmax'), row(b,'LTCUSDT','daily-4d','argmax')
sidebyside('LTC daily-4d classic 3-class (the CONTROL)', l_a, l_b)
ws = (l_b or {}).get('windowStamps')
print('3. 0733 LTC row window stamps (proof all-loaded reads past the 2026-06 month box):')
print('  ', json.dumps(ws)[:400])
EOF
