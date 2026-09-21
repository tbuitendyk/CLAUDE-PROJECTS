// uts-field-cells.js -- READ-ONLY. A stage 3 set priced under the field's
// gate beside its control, CELL BY CELL: every gate value the set declared is
// summed over the units it priced and held against the control's one setting
// on the same units -- never the best cell per coin, which would pick the
// luckiest of nine and call it the field. Reads the record stores. Writes
// nothing, starts nothing.
//
//   arg: <fieldSetId>+<controlId>
const fs = require('fs');
const APP = '/opt/ultimate-trading-system';
const rowstore = require(`${APP}/lib/rowstore`);
const fieldGate = require(`${APP}/lib/fieldgate`);
const [A, B] = String(process.argv[2] || '').split('+');
if (!A || !B) { console.log('usage: <fieldSetId>+<controlId>'); process.exit(0); }
const r2 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const r0 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
function load(id) {
  const doc = JSON.parse(fs.readFileSync(`${APP}/data/stagesets/${id}.json`, 'utf8'));
  const blocks = rowstore.blocksOf(id, 'records') || [];
  const rows = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    for (const x of rowstore.readBlocks(id, 'records', [bi])) {
      const r = x.row;
      const nt = Array.isArray(r.noiseTest) ? r.noiseTest.filter((v) => v != null) : [];
      const gate = String(r.label).includes(' · field ') ? String(r.label).split(' · field ')[1] : '';
      rows.push({
        unit: `${r.trade}|${r.geometry}`, gate,
        t: r.pnl, tt: r.trades == null ? null : Number(r.trades),
        h: r.holdout ? r.holdout.pnl : null, ht: r.holdout ? r.holdout.trades : null, vl: r.holdout ? r.holdout.vsAlwaysLong : null,
        bn: nt.filter((v) => r.pnl > v).length, np: nt.length,
        hb: r.beat ?? null, hp: r.pairs ?? null,
        ft: r.field ? r.field.test : null, fh: r.field ? r.field.hold : null,
        fvt: r.fieldVerdict ? r.fieldVerdict.test : null, fvh: r.fieldVerdict ? r.fieldVerdict.hold : null,
      });
    }
  }
  return { doc, rows };
}
const F = load(A); const C = load(B);
const units = [...new Set(C.rows.map((r) => r.unit))].sort();
const ctl = new Map(C.rows.map((r) => [r.unit, r]));
const cells = new Map();
for (const r of F.rows) { if (!cells.has(r.gate)) cells.set(r.gate, new Map()); cells.get(r.gate).set(r.unit, r); }
const sum = (list, f) => list.reduce((a, r) => a + (Number(f(r)) || 0), 0);
const short = (g) => g.replace(/ sized by \w+ ×100:1 silent×1$/, '').replace(/agreement≥/, 'a≥').replace(/certainty≥/, 'c≥');
console.log(`control ${C.doc.name} (${B}): ${units.length} units, ${C.rows.length} records`);
console.log(`field   ${F.doc.name} (${A}): ${cells.size} gate values, ${F.rows.length} records`);
const cRows = units.map((u) => ctl.get(u)).filter(Boolean);
console.log('');
console.log('== the control, summed over its units ==');
console.log(`  held $ ${r2(sum(cRows, (r) => r.h))}  held trades ${sum(cRows, (r) => r.ht)}  test $ ${r2(sum(cRows, (r) => r.t))}  test trades ${sum(cRows, (r) => r.tt)}  vs always-long (held) ${r2(sum(cRows, (r) => r.vl))}  beat-null avg ${r2(sum(cRows, (r) => r.bn) / cRows.length)}/${cRows[0] ? cRows[0].np : '?'}`);
console.log('');
console.log('== every gate value, summed over the same units; Δ is against the control ==');
console.log('  gate                | held $   Δ held  units better | test $   Δ test | held: placed sign-blk min-blk silent | held verdict     test verdict    | beat-null avg');
const lines = [];
for (const [g, byUnit] of cells) {
  const rows = units.map((u) => byUnit.get(u)).filter(Boolean);
  const H = sum(rows, (r) => r.h); const T = sum(rows, (r) => r.t);
  const dH = H - sum(cRows, (r) => r.h); const dT = T - sum(cRows, (r) => r.t);
  const better = rows.filter((r) => ctl.get(r.unit) && r.h > ctl.get(r.unit).h).length;
  const fh = rows.reduce((acc, r) => fieldGate.addTotals(acc, r.fh), null);
  const ft = rows.reduce((acc, r) => fieldGate.addTotals(acc, r.ft), null);
  lines.push({ g, H, dH, better, T, dT, fh, ft, bn: sum(rows, (r) => r.bn) / (rows.length || 1), n: rows.length });
}
lines.sort((x, y) => y.H - x.H);
for (const l of lines) {
  const fh = l.fh || {};
  console.log(`  ${short(l.g).padEnd(20)}| ${String(r2(l.H)).padStart(8)} ${String(r2(l.dH)).padStart(8)}  ${String(l.better).padStart(2)}/${l.n}        | ${String(r2(l.T)).padStart(8)} ${String(r2(l.dT)).padStart(8)} | ${String(fh.placed ?? '-').padStart(6)} ${String(fh.blockedSign ?? '-').padStart(8)} ${String(fh.blockedMin ?? '-').padStart(7)} ${String(fh.silent ?? '-').padStart(6)} | ${String(fieldGate.verdictOf(l.fh) || '-').padEnd(16)} ${String(fieldGate.verdictOf(l.ft) || '-').padEnd(16)}| ${r2(l.bn)}`);
}
console.log('');
console.log('== held $ per unit: the control, then every gate value (columns in the order above) ==');
console.log(`  ${'unit'.padEnd(18)} ${'control'.padStart(8)} ` + lines.map((l) => short(l.g).padStart(11)).join(' '));
for (const u of units) {
  const c = ctl.get(u);
  console.log(`  ${u.padEnd(18)} ${String(r2(c ? c.h : null)).padStart(8)} ` + lines.map((l) => { const r = cells.get(l.g).get(u); return String(r2(r ? r.h : null)).padStart(11); }).join(' '));
}
console.log('');
console.log('== beat-null per unit (how many of the kept null copies the TEST money beats): the control, then every gate value ==');
for (const u of units) {
  const c = ctl.get(u);
  console.log(`  ${u.padEnd(18)} ${String(c ? c.bn : null).padStart(8)} ` + lines.map((l) => { const r = cells.get(l.g).get(u); return String(r ? r.bn : null).padStart(11); }).join(' '));
}

// ---- TABLE 3.B, PER UNIT (owner, 2026-09-21: "this table that applies a bunch
// of settings to units to which they don't pertain is almost worthless ... run
// your control compare against 3.b"). Each unit takes its own gate value. The
// fair pick is made on TEST -- the row that beats the most of its kept null
// copies, then the most test money -- and judged on HELD, the walk's own
// discipline. The pick made on held itself is printed after it as the ceiling:
// the most the nine could show, not a fair read.
function perUnit(title, chooser, fair) {
  console.log('');
  console.log(`== ${title} ==`);
  console.log(`  ${'unit'.padEnd(18)} ${'ctl held'.padStart(9)} ${'ctl tr'.padStart(6)} ${'ctl bn'.padStart(6)} | ${'chosen gate'.padEnd(14)} ${'bn'.padStart(3)} ${'test $'.padStart(8)} ${'test tr'.padStart(7)} ${'held $'.padStart(8)} ${'held tr'.padStart(7)} ${'Δ held'.padStart(8)}  held verdict`);
  let better = 0; let sumF = 0; let sumC = 0; const picked = new Map();
  for (const u of units) {
    const c = ctl.get(u);
    // A ROW THAT HARDLY TRADES BEATS EVERY LOSING NULL COPY (found on the
    // second field run: two chosen rows with test $ 0 and held $ 0). The pick
    // needs at least ten test trades, the floor uts-two-sets-per-coin.js
    // already uses, and the trade counts are printed beside the money.
    const all = [...cells.values()].map((m) => m.get(u)).filter(Boolean);
    const rows = all.filter((r) => (Number(r.tt) || 0) >= 10);
    rows.sort(chooser);
    const p = rows[0] || null;
    if (!c) continue;
    if (!p) { console.log(`  ${u.padEnd(18)} no row with ten test trades or more (${all.length} rows)`); continue; }
    if (p.h > c.h) better++;
    sumF += Number(p.h) || 0; sumC += Number(c.h) || 0;
    picked.set(short(p.gate), (picked.get(short(p.gate)) || 0) + 1);
    console.log(`  ${u.padEnd(18)} ${String(r2(c.h)).padStart(9)} ${String(c.ht).padStart(6)} ${String(c.bn).padStart(6)} | ${short(p.gate).padEnd(14)} ${String(p.bn).padStart(3)} ${String(r2(p.t)).padStart(8)} ${String(p.tt).padStart(7)} ${String(r2(p.h)).padStart(8)} ${String(p.ht).padStart(7)} ${String(r2(p.h - c.h)).padStart(8)}  ${p.fvh || '-'}`);
  }
  console.log(`  units better on held: ${better}/${units.length}; held $ summed: chosen ${r2(sumF)} vs control ${r2(sumC)}${fair ? '' : ' (chosen on held itself: a ceiling, not a fair read)'}`);
  console.log(`  gate values chosen: ${[...picked].map(([g, n]) => `${g} x${n}`).join(', ')}`);
}
perUnit('per unit: the row chosen on TEST (most kept null copies beaten, then test $; ten test trades or more), judged on held', (x, y) => (y.bn - x.bn) || (y.t - x.t), true);
perUnit('per unit: the row chosen on HELD itself (ten test trades or more), the ceiling', (x, y) => (y.h - x.h), false);
