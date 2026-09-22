// uts-field-vs-control.js -- READ-ONLY. Two stage 3 record sets launched from
// the same parent with the same block, one with a field named and one without,
// read PER UNIT (Table 3.B's discipline, owner 2026-09-21: "focus on 3.b
// comparisons"): each unit's row is chosen on TEST -- most kept null copies
// beaten, then test $, ten test trades or more -- in each set on its own, and
// judged on HELD. Then the paired read: every field row against the control
// row of the SAME setting on the SAME unit, summed per gate value, with no
// choosing at all. Reads the two record stores. Writes nothing, starts nothing.
//
//   arg: <fieldSetId>+<controlId>            the summary
//        <fieldSetId>+<controlId>+units1     units 1-43, one line each
//        <fieldSetId>+<controlId>+units2     units 44 onward
const fs = require('fs');
const APP = '/opt/ultimate-trading-system';
const rowstore = require(`${APP}/lib/rowstore`);
const fieldGate = require(`${APP}/lib/fieldgate`);
const [A, B, PART] = String(process.argv[2] || '').split('+');
if (!A || !B) { console.log('usage: <fieldSetId>+<controlId>[+units1|+units2]'); process.exit(0); }
const r0 = (v) => (v == null || !Number.isFinite(Number(v)) ? '-' : String(Math.round(Number(v))));
const short = (g) => g.replace(/ sized by \w+ ×\S+ silent×\S+$/, '').replace(/agreement≥/, 'a≥').replace(/certainty≥/, 'c≥').replace(' & ', '&');
function load(id) {
  const doc = JSON.parse(fs.readFileSync(`${APP}/data/stagesets/${id}.json`, 'utf8'));
  const blocks = rowstore.blocksOf(id, 'records') || [];
  const units = new Map();   // unit -> Map(base setting -> Map(gate -> row))
  let n = 0;
  for (let bi = 0; bi < blocks.length; bi++) {
    for (const x of rowstore.readBlocks(id, 'records', [bi])) {
      const r = x.row; n++;
      const unit = `${r.trade}${r.ctx1 ? `+${r.ctx1}` : ''}${r.ctx2 ? `+${r.ctx2}` : ''}@${r.geometry}`;
      const [base, gate] = String(r.label).split(' · field ');
      const nt = Array.isArray(r.noiseTest) ? r.noiseTest.filter((v) => v != null) : [];
      const row = {
        base, gate: gate || '', t: Number(r.pnl) || 0, tt: Number(r.trades) || 0,
        h: r.holdout ? (Number(r.holdout.pnl) || 0) : null, ht: r.holdout ? (Number(r.holdout.trades) || 0) : null,
        bn: nt.filter((v) => r.pnl > v).length, np: nt.length,
        fh: r.field ? r.field.hold : null, fvh: r.fieldVerdict ? r.fieldVerdict.hold : null,
      };
      if (!units.has(unit)) units.set(unit, new Map());
      const m = units.get(unit);
      if (!m.has(base)) m.set(base, new Map());
      m.get(base).set(row.gate, row);
    }
  }
  return { doc, units, n };
}
const F = load(A); const C = load(B);
const unitKeys = [...C.units.keys()].sort();
const gates = new Set();
for (const m of F.units.values()) for (const g of m.values()) for (const k of g.keys()) gates.add(k);
const G = [...gates];
const rowsOf = (set, u) => { const out = []; const m = set.units.get(u); if (m) for (const g of m.values()) for (const r of g.values()) out.push(r); return out; };
const usable = (rows) => rows.filter((r) => r.tt >= 10 && r.h != null);
const fair = (rows) => usable(rows).sort((x, y) => (y.bn - x.bn) || (y.t - x.t))[0] || null;
const ceil = (rows) => usable(rows).sort((x, y) => (y.h - x.h))[0] || null;
const settingsPerUnit = (set) => { const m = set.units.get(unitKeys[0]); return m ? m.size : 0; };
const np = (() => { const r = rowsOf(C, unitKeys[0])[0]; return r ? r.np : '?'; })();

// the two picks per unit, and the paired sums per unit and gate
const per = [];
const paired = {}; for (const g of G) paired[g] = { n: 0, dH: 0, dT: 0, better: 0, same: 0, worse: 0, fh: null, unitsUp: 0, unitsDown: 0 };
for (const u of unitKeys) {
  const cRows = rowsOf(C, u); const fRows = rowsOf(F, u);
  const cp = fair(cRows); const fp = fair(fRows); const cc = ceil(cRows); const fc = ceil(fRows);
  const dU = {};
  for (const g of G) dU[g] = 0;
  const cm = C.units.get(u) || new Map(); const fm = F.units.get(u) || new Map();
  for (const [base, gm] of cm) {
    const c = gm.get('');
    const fg = fm.get(base);
    if (!c || !fg || c.h == null) continue;
    for (const g of G) {
      const f = fg.get(g);
      if (!f || f.h == null) continue;
      const p = paired[g];
      const d = f.h - c.h;
      p.n++; p.dH += d; p.dT += f.t - c.t; dU[g] += d;
      if (Math.abs(d) < 0.005) p.same++; else if (d > 0) p.better++; else p.worse++;
      p.fh = fieldGate.addTotals(p.fh, f.fh);
    }
  }
  for (const g of G) { if (dU[g] > 0.005) paired[g].unitsUp++; else if (dU[g] < -0.005) paired[g].unitsDown++; }
  // THE SETTINGS AN OWNER WOULD ACTUALLY LOOK AT: the control's top 20 on TEST
  // for this unit (most kept null copies beaten, then test $, ten test trades
  // or more), paired with the same settings under each gate. Pairing every one
  // of 3,168 settings is dominated by the thousands that lose money, where
  // blocking trades helps by construction.
  const top = usable(cRows).sort((x, y) => (y.bn - x.bn) || (y.t - x.t)).slice(0, 20);
  const dTop = {};
  for (const g of G) dTop[g] = { n: 0, dH: 0, better: 0, worse: 0 };
  for (const c of top) {
    const fg = fm.get(c.base);
    for (const g of G) {
      const f = fg ? fg.get(g) : null;
      if (!f || f.h == null) continue;
      const d = f.h - c.h;
      dTop[g].n++; dTop[g].dH += d; if (d > 0.005) dTop[g].better++; else if (d < -0.005) dTop[g].worse++;
    }
  }
  per.push({ u, cp, fp, cc, fc, dU, dTop, nC: cRows.length, nF: fRows.length, cUsable: usable(cRows).length, fUsable: usable(fRows).length });
}

if (PART === 'units1' || PART === 'units2') {
  const from = PART === 'units1' ? 0 : 43;
  console.log(`per unit ${from + 1}-${Math.min(from + 43, per.length)} of ${per.length}: the row chosen on TEST in each set (bn = of ${np} kept null copies beaten), judged on HELD; then the paired held Δ summed over the unit's settings`);
  console.log(`  ${'unit'.padEnd(30)} ${'ctl held'.padStart(8)} ${'tr'.padStart(4)} ${'bn'.padStart(2)} | ${'gate'.padEnd(9)} ${'fld held'.padStart(8)} ${'tr'.padStart(4)} ${'bn'.padStart(2)} ${'Δ'.padStart(7)} | ${G.map((g) => short(g).padStart(8)).join(' ')}`);
  for (const x of per.slice(from, from + 43)) {
    const c = x.cp; const f = x.fp;
    console.log(`  ${x.u.padEnd(30)} ${r0(c && c.h).padStart(8)} ${r0(c && c.ht).padStart(4)} ${String(c ? c.bn : '-').padStart(2)} | ${(f ? short(f.gate) : '-').padEnd(9)} ${r0(f && f.h).padStart(8)} ${r0(f && f.ht).padStart(4)} ${String(f ? f.bn : '-').padStart(2)} ${r0(c && f ? f.h - c.h : null).padStart(7)} | ${G.map((g) => r0(x.dU[g]).padStart(8)).join(' ')}`);
  }
  process.exit(0);
}

console.log(`control ${C.doc.name} (${B}): ${unitKeys.length} units, ${C.n} records, ${settingsPerUnit(C)} settings on the first unit`);
console.log(`field   ${F.doc.name} (${A}): ${F.units.size} units, ${F.n} records, gate values: ${G.map(short).join(', ')}`);
const tally = (pick) => {
  let better = 0; let same = 0; let worse = 0; let none = 0; let cH = 0; let fH = 0; let cT = 0; let fT = 0; let cHt = 0; let fHt = 0;
  const chosen = new Map(); const verdicts = new Map();
  for (const x of per) {
    const c = pick === 'fair' ? x.cp : x.cc; const f = pick === 'fair' ? x.fp : x.fc;
    if (!c || !f) { none++; continue; }
    if (Math.abs(f.h - c.h) < 0.005) same++; else if (f.h > c.h) better++; else worse++;
    cH += c.h; fH += f.h; cT += c.t; fT += f.t; cHt += c.ht; fHt += f.ht;
    chosen.set(short(f.gate), (chosen.get(short(f.gate)) || 0) + 1);
    verdicts.set(f.fvh || '-', (verdicts.get(f.fvh || '-') || 0) + 1);
  }
  console.log(`  units: field pick better on held ${better}, same ${same}, worse ${worse}${none ? `, no usable row ${none} (control lacks one on ${per.filter((x) => !x.cUsable).length}, field on ${per.filter((x) => !x.fUsable).length})` : ''} of ${per.length}`);
  console.log(`  held $ summed: control picks ${r0(cH)}, field picks ${r0(fH)} (Δ ${r0(fH - cH)}); held trades ${cHt} vs ${fHt}`);
  console.log(`  test $ summed: control picks ${r0(cT)}, field picks ${r0(fT)}`);
  console.log(`  gate values chosen: ${[...chosen].map(([g, n]) => `${g} x${n}`).join(', ')}`);
  console.log(`  held verdict of the field picks: ${[...verdicts].map(([v, n]) => `${v} ${n}`).join(', ')}`);
};
console.log('');
console.log(`== per unit, chosen on TEST (most of ${np} kept null copies beaten, then test $; ten test trades or more), judged on HELD ==`);
tally('fair');
console.log('');
console.log('== per unit, chosen on HELD itself: the ceiling, not a fair read ==');
tally('ceil');
const HEAD_ALL = (`  ${'gate'.padEnd(9)} ${'pairs'.padStart(7)} ${'held Δ sum'.padStart(11)} ${'better'.padStart(7)} ${'same'.padStart(7)} ${'worse'.padStart(7)} ${'test Δ sum'.padStart(11)} | held, summed: ${'placed'.padStart(8)} ${'sign-blk'.padStart(8)} ${'min-blk'.padStart(8)} ${'silent'.padStart(8)} | units up/down`);
console.log('');
console.log("== paired on the control's top 20 settings per unit (chosen on TEST as above): the same settings under each gate, judged on HELD ==");
for (const g of G) {
  let n = 0; let dH = 0; let better = 0; let worse = 0; let up = 0; let down = 0;
  for (const x of per) { const t = x.dTop[g]; n += t.n; dH += t.dH; better += t.better; worse += t.worse; if (t.dH > 0.005) up++; else if (t.dH < -0.005) down++; }
  console.log(`  ${short(g).padEnd(9)} pairs ${n}: held Δ sum ${r0(dH)}, better ${better}, worse ${worse}; units up ${up}, down ${down}`);
}
console.log('');
console.log('== paired over EVERY setting (mostly losers, where blocking helps by construction) ==');
console.log(HEAD_ALL);
for (const g of G) {
  const p = paired[g]; const fh = p.fh || {};
  console.log(`  ${short(g).padEnd(9)} ${String(p.n).padStart(7)} ${r0(p.dH).padStart(11)} ${String(p.better).padStart(7)} ${String(p.same).padStart(7)} ${String(p.worse).padStart(7)} ${r0(p.dT).padStart(11)} |               ${r0(fh.placed).padStart(8)} ${r0(fh.blockedSign).padStart(8)} ${r0(fh.blockedMin).padStart(8)} ${r0(fh.silent).padStart(8)} | ${p.unitsUp}/${p.unitsDown}`);
}
