#!/usr/bin/env bash
# ht-board-read.sh -- read-only: the History Tuning dial-pair board computed
# from the stored rows exactly as the UI computes it (combined TEST money per
# dial pair, ranked; holds shown for winner + reference only), plus the
# stamped verdict from the server's own endpoint.
set -uo pipefail
cd /opt/general-classifier
python3 - <<'EOF'
import json, glob
f = sorted(glob.glob('data/batches/historytuning-*.json'))[-1]
d = json.load(open(f))
rows = [r for r in (d.get('htRows') or []) if not r.get('refused') and not r.get('skipped')]
arms = {}
for r in rows:
    k = f"{r['ageKey']}|{r['retuneKey']}"
    a = arms.setdefault(k, {'test': 0.0, 'holds': {}, 'eff': float('inf'), 'n': 0})
    a['test'] += r.get('testPnl') or 0
    a['holds'][r.get('split')] = r.get('holdPnl')
    a['eff'] = min(a['eff'], r.get('effectiveDays') or float('inf'))
    a['n'] += 1
ranked = sorted(arms.items(), key=lambda kv: -kv[1]['test'])
ref = 'none|never'
winner = ranked[0][0]
print(f"run {d['id']}  status={d['status']}  105 passes, 35 dial pairs x 3 splits")
print("rank  age|retune        test $ (3 windows)   eff.days   holds e/m/l (winner+ref only)")
for i, (k, v) in enumerate(ranked[:8], 1):
    show = k in (winner, ref)
    holds = ' / '.join(f"{(v['holds'].get(s) or 0):+.0f}" for s in ('early','middle','late')) if show else '(sealed)'
    tag = ' WINNER' if k == winner else (' REFERENCE' if k == ref else '')
    print(f"  {i:2d}  {k:16s} {v['test']:+10.2f}   {v['eff']:8.0f}   {holds}{tag}")
if ref not in [k for k,_ in ranked[:8]]:
    v = arms[ref]
    holds = ' / '.join(f"{(v['holds'].get(s) or 0):+.0f}" for s in ('early','middle','late'))
    print(f"  {[k for k,_ in ranked].index(ref)+1:2d}  {ref:16s} {v['test']:+10.2f}   {v['eff']:8.0f}   {holds} REFERENCE")
EOF
echo "== stamped verdict (server's own reading of the four rules) =="
curl -s "http://127.0.0.1:8093/api/historytuning/$(ls -t data/batches/historytuning-*.json | head -1 | xargs basename | sed 's/\.json//')/verdict" | head -c 1800
