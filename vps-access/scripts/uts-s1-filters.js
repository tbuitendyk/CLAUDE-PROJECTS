// uts-s1-filters.js -- READ-ONLY. What a stage 1 (or 2) set's table is cut
// down to by the filters saved on it, and how the two null-set readings are
// spread over all its rows and over the rows that pass: beat its own null set
// (the forecast score against shuffled calendars) and beat its own null set --
// tuning-slice $ (the votes priced on the tuning slice against the same votes
// dealt onto other days). Reads the set document and the record store through
// the service's own filter; writes nothing, starts nothing.
//   arg: <setId>                             the filters saved on the set
//   arg: <setId>+beatMin@95+moneyMin@0+...    these filters instead (Boards' own keys)
const fs = require('fs');
const APP = '/opt/ultimate-trading-system';
const rowstore = require(`${APP}/lib/rowstore`);
const stages = require(`${APP}/lib/stages`);
const [id, ...parts] = String(process.argv[2] || '').split('+');
if (!id) { console.log('usage: <setId>[+key@value...]'); process.exit(0); }
const asked = {};
for (const p of parts) { const [k, v] = p.split('@'); if (k) asked[k] = Number.isFinite(Number(v)) ? Number(v) : v; }
const doc = JSON.parse(fs.readFileSync(`${APP}/data/stagesets/${id}.json`, 'utf8'));
console.log(`${doc.name} (${id}) stage ${doc.stage} ${doc.status} · units ${(doc.plan || {}).units} · nullN ${(doc.params || {}).nullN}`);
if (doc.parent) console.log('carried from:', JSON.stringify(doc.parent));
console.log('filters saved on the set:', JSON.stringify(doc.filters || null));
const filters = parts.length ? asked : (doc.filters || {});
if (parts.length) console.log('filters asked for this read:', JSON.stringify(filters));
console.log('sort saved on the set:', JSON.stringify(doc.sort || null));
const rows = [];
for (const b of (rowstore.blocksOf(id, 'records') || []).keys()) for (const x of rowstore.readBlocks(id, 'records', [b])) rows.push(x.row);
const pct = (r, a, b) => (r[b] ? (r[a] / r[b]) * 100 : null);
const beatPct = (r) => pct(r, 'beat', 'pairs');
const moneyPct = (r) => (r.nullMoney && r.nullMoney.length ? (r.beatMoney / r.nullMoney.length) * 100 : (r.beatMoney != null && r.pairs ? (r.beatMoney / r.pairs) * 100 : null));
const buckets = [[0, 50, '0-49'], [50, 80, '50-79'], [80, 90, '80-89'], [90, 95, '90-94'], [95, 99, '95-98'], [99, 100.01, '99-100']];
function hist(list, f) {
  const out = {}; let none = 0;
  for (const b of buckets) out[b[2]] = 0;
  for (const r of list) { const v = f(r); if (v == null) { none++; continue; } for (const b of buckets) if (v >= b[0] && v < b[1]) { out[b[2]]++; break; } }
  return `${Object.entries(out).map(([k, n]) => `${k}: ${n}`).join('  ')}${none ? `  (no value: ${none})` : ''}`;
}
const kept = stages.applyFilters(doc.stage, rows, filters);
console.log(`rows: ${rows.length} in all, ${kept.length} pass the ${parts.length ? 'asked' : 'saved'} filters`);
for (const [name, list] of [['all rows', rows], ['rows that pass', kept]]) {
  console.log(`== ${name} ==`);
  console.log(`  beat its own null set, %:                 ${hist(list, beatPct)}`);
  console.log(`  beat its own null set -- tuning-slice $, %: ${hist(list, moneyPct)}`);
  const hi = list.filter((r) => (beatPct(r) ?? 0) >= 99);
  const hiMoney = hi.filter((r) => (moneyPct(r) ?? 0) >= 90);
  console.log(`  at 99-100 on the forecast score: ${hi.length}; of those, at 90+ on tuning-slice $: ${hiMoney.length}; money > 0 on the tuning slice: ${hi.filter((r) => (r.money || 0) > 0).length}`);
  const byShape = {}; for (const r of list) byShape[r.geometry] = (byShape[r.geometry] || 0) + 1;
  console.log(`  by chunk shape: ${JSON.stringify(byShape)}`);
  const byCoin = {}; for (const r of list) byCoin[r.trade] = (byCoin[r.trade] || 0) + 1;
  console.log(`  by coin: ${Object.entries(byCoin).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ')}`);
}
// the rows that pass, best first by the forecast-score beat, with their money reading beside
const show = kept.slice().sort((a, b) => ((beatPct(b) ?? -1) - (beatPct(a) ?? -1)) || ((b.lead ?? -1e9) - (a.lead ?? -1e9))).slice(0, 25);
console.log('== the first 25 rows that pass, by beat its own null set ==');
console.log('  unit                                  beat%  lead   score   | tuning $   beat$%  lead$   voices');
for (const r of show) {
  const u = `${r.trade}|${r.ctx1 || ''}${r.ctx2 ? '|' + r.ctx2 : ''}|${r.geometry}`;
  const f = (v, d = 1) => (v == null ? '   -' : Number(v).toFixed(d));
  console.log(`  ${u.padEnd(38)} ${f(beatPct(r), 0).padStart(4)}  ${f(r.lead, 2).padStart(5)}  ${f(r.score, 3).padStart(6)}  | ${f(r.money, 2).padStart(8)}  ${f(moneyPct(r), 0).padStart(5)}  ${f(r.leadMoney, 2).padStart(5)}  ${String(r.voices ?? '-').padStart(6)}`);
}

if (doc.stage === 2) {
  console.log('== stage 2: what the fuller board bought (BOOST members added to the stage 1 committee) ==');
  const r2 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
  // on the record, all-members tuning-slice $ is called money; the table calls it moneyAll
  for (const r of rows) if (r.moneyAll == null && r.money != null) r.moneyAll = r.money;
  const n = rows.length;
  const helped = rows.filter((r) => (r.helped || 0) > 0).length;
  const moreMoney = rows.filter((r) => r.moneyAll != null && r.money3 != null && r.moneyAll > r.money3).length;
  const inMoney = rows.filter((r) => (r.moneyAll || 0) > 0).length;
  const inMoney3 = rows.filter((r) => (r.money3 || 0) > 0).length;
  const b95 = rows.filter((r) => (beatPct(r) ?? 0) >= 95).length;
  const bm95 = rows.filter((r) => (moneyPct(r) ?? 0) >= 95).length;
  const sum = (f) => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0);
  console.log(`  units ${n}: fuller board helped? above 0 on ${helped}; tuning-slice $ -- all members above stage 1 members on ${moreMoney}; in the money with all members ${inMoney} (stage 1 members alone ${inMoney3})`);
  console.log(`  tuning-slice $ summed: stage 1 members ${r2(sum((r) => r.money3))}, all members ${r2(sum((r) => r.moneyAll))}`);
  console.log(`  beat its own null set at 95+: ${b95} of ${n}; beat its own null set -- tuning-slice $ at 95+: ${bm95} of ${n}`);
  console.log('  unit                                  s1#  memb voices  score3  scoreAll helped | beat%  lead  |  $ s1   $ all  beat$%  lead$');
  const shown = rows.slice().sort((a, b) => ((b.moneyAll ?? -1e9) - (a.moneyAll ?? -1e9)));
  for (const r of shown) {
    const u = `${r.trade}|${r.ctx1 || ''}${r.ctx2 ? '|' + r.ctx2 : ''}|${r.geometry}`;
    const f = (v, d = 1) => (v == null ? '-' : Number(v).toFixed(d));
    console.log(`  ${u.padEnd(38)} ${String(r.s1rank ?? '-').padStart(3)}  ${String((r.specs || []).length).padStart(4)} ${String(r.voices ?? '-').padStart(6)}  ${f(r.score3, 1).padStart(6)}  ${f(r.scoreAll, 1).padStart(8)} ${f(r.helped, 1).padStart(6)} | ${f(beatPct(r), 0).padStart(4)}  ${f(r.lead, 2).padStart(5)} | ${f(r.money3, 1).padStart(6)} ${f(r.moneyAll, 1).padStart(7)}  ${f(moneyPct(r), 0).padStart(5)}  ${f(r.leadMoney, 2).padStart(5)}`);
  }
}
