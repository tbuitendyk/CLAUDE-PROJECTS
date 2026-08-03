#!/usr/bin/env bash
# classifier-l14-settings.sh -- read-only: print the July 30 layout
# face-off run's settings so the owner can re-enter them in the form
# without guessing. Prints only the result-shaping fields, plainly.
set -euo pipefail
F=/opt/general-classifier/data/batches/bracketlab-20260730-2306-l14-both-layouts.json
[[ -f "$F" ]] || { echo "doc not found: $F"; exit 1; }
python3 - "$F" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))['params']
def g(k, d='—'): return p.get(k, d)
print('universe        :', ', '.join(g('universe', [])) or '(all 17)')
print('combo sizes     :', ', '.join(k for k, v in (g('sizes', {}) or {}).items() if v))
print('months          :', 'ALL LOADED' if g('allLoaded') else f"{g('startMonth')} to {g('endMonth')}")
print('permuted options:', ', '.join(k for k, v in (g('permute', {}) or {}).items() if v) or 'none')
print('fixed set       :', g('set'))
print('promote top-K   :', g('promoteK'))
print('min trades      :', g('minTrades'))
print('trailing swept  :', g('trailing'))
print('fee per leg     :', g('feePerLeg'))
print('menu d-mults    :', g('dMults'))
print('menu t-hours    :', g('tHours'))
print('menu gates      :', g('gates'))
print('menu entries    :', g('entries'))
print('dormant band    :', g('dormantPct'))
print('compare symbol  :', g('compareSymbol'))
PY
