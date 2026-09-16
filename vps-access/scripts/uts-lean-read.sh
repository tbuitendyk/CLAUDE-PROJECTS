#!/usr/bin/env bash
# uts-lean-read.sh -- READ-ONLY. For every per-trade capture on the box: per
# survivor and per window, how many trades went long and how many short, and
# what each side made. The measurement nothing on any screen makes yet.
# Reads the capture files off disk; writes nothing, starts nothing.
set -uo pipefail
D=/opt/ultimate-trading-system/data/stagesets
python3 - "$D" <<'PY'
import json, os, sys, gzip, collections
D = sys.argv[1]
caps = sorted(f for f in os.listdir(D) if f.endswith('-capture.json.gz'))
if not caps: print('no capture on this box'); raise SystemExit
def m(v): return 'none' if not isinstance(v,(int,float)) else f'{v:,.2f}'
for f in caps:
    try: cap = json.load(gzip.open(os.path.join(D, f), 'rt'))
    except Exception as e: print(f'{f}: unreadable ({e})'); continue
    print('=' * 104)
    print(f"{f}")
    print(f"  set {cap.get('id')}  unit {cap.get('unitName') or cap.get('unit')}  members {cap.get('members')}  captured {len(cap.get('survivors') or [])}  at {str(cap.get('at'))[:16]} release {cap.get('release')}")
    rsv = cap.get('reserve') or {}
    print(f"  reserve entries: {'yes' if rsv.get('captured') else 'NO - ' + str(rsv.get('why'))[:70]}")
    # pooled over every captured survivor, per window
    for w in ('train', 'test', 'hold', 'reserve'):
        L = S_ = 0; lu = su = 0.0; nsv = 0
        per = []
        for sv in (cap.get('survivors') or []):
            es = (sv.get('entries') or {}).get(w) or []
            if not es: continue
            nsv += 1
            l = sum(1 for e in es if e.get('side') == 'LONG')
            s = sum(1 for e in es if e.get('side') == 'SHORT')
            lm = sum(float(e.get('usd') or 0) for e in es if e.get('side') == 'LONG')
            sm = sum(float(e.get('usd') or 0) for e in es if e.get('side') == 'SHORT')
            L += l; S_ += s; lu += lm; su += sm
            per.append((sv.get('label'), l, s, lm, sm))
        n = L + S_
        if not n: print(f"  {w:8s}: no entries"); continue
        lean = (L - S_) / n
        print(f"  {w:8s}: {n:6d} trades over {nsv} survivors | LONG {L:6d} ({100*L/n:5.1f}%) made {m(lu):>12s} | SHORT {S_:6d} ({100*S_/n:5.1f}%) made {m(su):>12s} | side lean {lean:+.3f} | total {m(lu+su)}")
        # the three most and least one-sided survivors on this window
        per.sort(key=lambda r: (r[1] - r[2]) / max(1, r[1] + r[2]))
        for tag, row in (('  most short-leaning', per[0]), ('  most long-leaning ', per[-1])):
            lbl, l, s, lm, sm = row
            t = l + s
            print(f"    {tag}: {str(lbl)[:52]:52s} L{l:4d}/S{s:4d} lean {((l-s)/max(1,t)):+.2f}  long {m(lm)}  short {m(sm)}")
PY
