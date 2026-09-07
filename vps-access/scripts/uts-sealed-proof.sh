#!/usr/bin/env bash
# uts-sealed-proof.sh -- READ-ONLY. Owner question, 2026-09-07: "with a
# 61/13/13/13 history setup ... confirm that actually right now with the funnel
# data that we have, thirteen percent history never seen."
#
# Reads: the newest Stage 4 set and its whole chain of parents (JSON on disk),
# the sealed window the service itself reports for the stage 3 parent (the same
# read the Funnel tab makes on every draw), the candle files the chain was
# priced from, and the data manifest stamped at the stage 1 launch against the
# files as they are on disk now. Writes nothing. Starts nothing.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data
cd /opt/ultimate-trading-system || exit 1
node - <<'JS'
const fs = require('fs'), path = require('path');
const D = '/opt/ultimate-trading-system/data';
const sets = path.join(D, 'stagesets');
const read = (id) => { try { return JSON.parse(fs.readFileSync(path.join(sets, id + '.json'), 'utf8')); } catch (e) { return null; } };
const day = (ts) => (ts ? new Date(Number(ts)).toISOString().slice(0, 10) : '-');
const s4s = fs.readdirSync(sets).filter((f) => /^s4-.*\.json$/.test(f)).map((f) => read(f.replace(/\.json$/, ''))).filter(Boolean)
  .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
if (!s4s.length) { console.log('no Stage 4 set on this box'); process.exit(0); }
const s4 = s4s[0];
console.log('== the Stage 4 set ==');
console.log('   ' + s4.name + '  (' + s4.id + ')  cut ' + s4.createdAt + '  under ' + (s4.release || (s4.params||{}).engineVersion || '?'));
console.log('   unit ' + (s4.unit || 'all units together') + '   survivors ' + ((s4.counts||{}).survivors) + ' of ' + ((s4.counts||{}).target));
console.log('   heldBackReadAt: ' + JSON.stringify(s4.heldBackReadAt === undefined ? '(no field)' : s4.heldBackReadAt));
// the chain
const chain = [];
let cur = read((s4.parent || {}).id);
while (cur) { chain.push(cur); cur = read((cur.parent || {}).id || (cur.params || {}).from || ''); }
console.log('== the chain it came from ==');
for (const d of chain) {
  const p = d.params || {};
  console.log('   stage ' + d.stage + '  ' + d.name + '  (' + d.id + ')  ' + d.status + '  created ' + d.createdAt + '  release ' + (p.engineVersion || d.release || '?'));
  console.log('      windowLayout ' + p.windowLayout + '   allLoaded ' + p.allLoaded + '   months ' + p.startMonth + ' .. ' + p.endMonth + '   universe ' + JSON.stringify(p.universe));
}
const s3 = chain[0], s1 = chain[chain.length - 1];
// the data manifest stamped at launch, against the files on disk NOW. The
// doc stores a per-symbol digest: sha256 over "file|bytes|sha256" of every 1h
// file, in name order. Rolled again here the same way, from the files as they
// are now, for the unit's coins -- so a match means not one byte of the price
// history this chain was priced from has moved since the stage 1 launch.
console.log('== the price files: digest stamped at the stage 1 launch, against the files on disk now ==');
const crypto = require('crypto');
const man = (s1 && s1.dataManifest) || {};
const syms = man.symbols || {};
const unitCoins = String(s4.unit || '').split('|').filter((x, i) => i < 3 && x);
const cache = path.join(D, 'cache');
const rollNow = (sym) => {
  const files = fs.readdirSync(cache).filter((f) => f.startsWith(sym + '-1h-') && f.endsWith('.json')).sort();
  const roll = crypto.createHash('sha256');
  let bytes = 0;
  for (const f of files) {
    const buf = fs.readFileSync(path.join(cache, f));
    const h = crypto.createHash('sha256').update(buf).digest('hex');
    bytes += buf.length;
    roll.update(f + '|' + buf.length + '|' + h + '\n');
  }
  return { files: files.length, bytes, digest: files.length ? roll.digest('hex') : null };
};
console.log('   coins in the manifest: ' + Object.keys(syms).length + '   stamped at ' + (man.at || man.stampedAt || s1.createdAt));
for (const sym of unitCoins) {
  const was = syms[sym];
  if (!was) { console.log('   ' + sym.padEnd(9) + ' NOT in the stage 1 manifest'); continue; }
  const now = rollNow(sym);
  const same = was.digest && now.digest && was.digest === now.digest;
  console.log('   ' + sym.padEnd(9) + (same ? 'UNCHANGED since the launch' : 'CHANGED since the launch') + '   files then ' + was.files + ' now ' + now.files + '   bytes then ' + was.bytes + ' now ' + now.bytes);
}
if (!Object.keys(syms).length) console.log('   (the stage 1 set carries no per-symbol manifest: keys ' + JSON.stringify(Object.keys(man)) + ')');
// the candle span on disk for the unit's coins
console.log('== the candles on disk for the unit\'s coins (1h files) ==');
for (const sym of unitCoins) {
  const months = fs.readdirSync(cache).filter((f) => f.startsWith(sym + '-1h-') && /-\d{4}-\d{2}\.json$/.test(f)).sort();
  if (!months.length) { console.log('   ' + sym + ': no 1h files'); continue; }
  const lastRows = JSON.parse(fs.readFileSync(path.join(cache, months[months.length - 1]), 'utf8'));
  const firstRows = JSON.parse(fs.readFileSync(path.join(cache, months[0]), 'utf8'));
  const lastTs = Math.max(...lastRows.map((r) => Number(r.ts ?? r.openTime ?? r[0])).filter(Number.isFinite));
  const firstTs = Math.min(...firstRows.map((r) => Number(r.ts ?? r.openTime ?? r[0])).filter(Number.isFinite));
  const newest = months.map((m) => fs.statSync(path.join(cache, m)).mtime).sort((a, b) => b - a)[0];
  console.log('   ' + sym.padEnd(9) + months[0].replace(sym + '-1h-', '').replace('.json', '') + ' .. ' + months[months.length - 1].replace(sym + '-1h-', '').replace('.json', '')
    + '   first candle ' + day(firstTs) + '   last candle ' + day(lastTs) + '   newest file written ' + newest.toISOString().slice(0, 16));
}
fs.writeFileSync('/tmp/uts-sealed-proof.json', JSON.stringify({ s3: s3 && s3.id, unit: s4.unit || 'all', createdAt: s4.createdAt }));
JS
# THE SEALED WINDOW AS THE SERVICE REPORTS IT -- the same read the Funnel tab
# makes on every draw of the walk, on the same set and unit.
S3=$(python3 -c "import json;print(json.load(open('/tmp/uts-sealed-proof.json'))['s3'])")
UNIT=$(python3 -c "import json;print(json.load(open('/tmp/uts-sealed-proof.json'))['unit'])")
echo "== the sealed window, as the service reports it for $S3 on unit $UNIT =="
curl -sf --max-time 120 -X POST -H 'content-type: application/json' -d "{\"unit\":\"$UNIT\",\"step\":1,\"rule\":{\"ranges\":{},\"allowed\":{},\"floors\":{}}}" "$B/api/funnel/$S3/read" | python3 -c "
import json,sys,datetime
d=json.load(sys.stdin)
if d.get('error'): print('   could not read:', d['error']); raise SystemExit
s=d.get('set',{}); z=s.get('sealed',{})
day=lambda ts: datetime.datetime.utcfromtimestamp(ts/1000).strftime('%Y-%m-%d') if ts else '-'
print('   layout %s   sealed %s   units %d   missing %s   why %s' % (z.get('layout'), z.get('sealed'), len(z.get('units',[])), z.get('missing'), z.get('why')))
mine=[u for u in z.get('units',[]) if '%s|%s|%s|%s' % (u.get('trade'), u.get('ctx1') or '', u.get('ctx2') or '', u.get('geometry')) == '$UNIT']
STEP={'weekly-8d':24*7,'daily-1d':24,'daily-2d':24,'daily-3d':24,'daily-4d':24}
for u in mine:
    r=u.get('reserve') or {}
    print('   this unit: %s alongside %s and %s, %s' % (u.get('trade'), u.get('ctx1'), u.get('ctx2'), u.get('geometry')))
    if not r: print('   this unit carries NO reserve record'); continue
    step=STEP.get(u.get('geometry'),24)*3600*1000
    chunks=r.get('chunks'); fromTs=r.get('fromTs')
    whole=round(chunks/0.13); work=max(1,whole-chunks); nHold=max(2,round(work*0.15)); nTest=max(2,round(work*0.15))
    holdTo=fromTs; holdFrom=fromTs-nHold*step; testTo=holdFrom; testFrom=testTo-nTest*step
    print('   sealed reserve: %s chunks from %s  (recorded on the record; its end is not recorded, so the end below is chunks x step)' % (chunks, day(fromTs)))
    print('      sealed   %s .. %s   (%d chunks = %.1f%% of the %d chunks the whole span made)' % (day(fromTs), day(fromTs+chunks*step), chunks, 100.0*chunks/whole, whole))
    print('      held-back %s .. %s   (%d chunks)  <- the window the 199 were graded on, and the four comparisons' % (day(holdFrom), day(holdTo), nHold))
    print('      test      %s .. %s   (%d chunks)  <- the window the walk read against its scrambled copies' % (day(testFrom), day(testTo), nTest))
    print('      training  .. %s  (everything before the test window; the tuning slice is its last quarter)' % day(testFrom))
    print('   (the work windows above are derived from the reserve with the same three shares the service uses: 0.13 sealed of the whole, then 0.15 test and 0.15 held-back of the rest)')
if not mine: print('   the unit was not found in the sealed units list')
print('   comparisons for this unit on the parent (buy/short and hold, always long/short): %s' % ('present' if (d.get('against') or {}).get('board',{}).get('known') else 'NOT known - ' + str((d.get('against') or {}).get('board',{}).get('why'))))
"
rm -f /tmp/uts-sealed-proof.json
