#!/usr/bin/env bash
# uts-cs-applies.sh -- READ-ONLY. Every Stage 4 record set whose choices on Tune
# were written between 03:00 and 04:30 UTC today (a sizing or a stop, with its
# ladder and when), and every scan result file written in that window, so an
# Apply that landed somewhere other than where it was meant is visible.
set -uo pipefail
D=/opt/ultimate-trading-system/data/stagesets
sudo -u uts python3 - "$D" <<'PY'
import json, glob, os, sys, datetime
D = sys.argv[1]
day = datetime.datetime.utcnow().strftime('%Y-%m-%d')
lo, hi = day + 'T03:00', day + 'T04:30'
for f in sorted(glob.glob(os.path.join(D, 's4-*.json'))):
    if f.endswith('-tunescans.json'): continue
    try: d = json.load(open(f))
    except Exception: continue
    hits = {}
    for L, c in (d.get('stopChoices') or {}).items():
        c = c or {}
        sz = c.get('sizing') or {}
        if lo <= str(sz.get('at') or '') <= hi:
            k = ('sizing', json.dumps(sz.get('ladder')), str(sz.get('at'))[:19], sz.get('why'))
            hits[k] = hits.get(k, 0) + 1
        if lo <= str(c.get('at') or '') <= hi:
            k = ('stop', str(c.get('stopPct')), str(c.get('at'))[:19], c.get('why'))
            hits[k] = hits.get(k, 0) + 1
    if hits:
        print(f"\n== {d.get('id')} | {d.get('kind') or 'funnel'} | {d.get('name')}")
        for k, n in sorted(hits.items(), key=lambda x: x[0][2]): print(f"   {k[0]} x{n}: {k[1]} at {k[2]} why {k[3]!r}")
print("\n== scan files written 03:00-04:30")
for f in sorted(glob.glob(os.path.join(D, 's4-*-tunescans.json'))):
    m = datetime.datetime.utcfromtimestamp(os.path.getmtime(f)).strftime('%Y-%m-%dT%H:%M:%S')
    if not (lo <= m <= hi): continue
    x = json.load(open(f))
    print(f"-- {os.path.basename(f)} written {m}")
    for tool, per in (x.get('scans') or {}).items():
        for aim, r in (per or {}).items():
            tg = r.get('target') or {}
            print(f"   {tool} aim {aim[:70]} | {r.get('status')} finished {str(r.get('finishedUtc') or '')[:19]} survivor {str(tg.get('survivor'))[:20]} windows {tg.get('windows')} ladder {json.dumps(r.get('ladder'))}")
PY
