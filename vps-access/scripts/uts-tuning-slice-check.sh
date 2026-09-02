#!/usr/bin/env bash
# READ-ONLY. The check before anything is built: for the 25 stage 1 units,
# does direction money on the tuning slice of the training window (the probe
# votes tau is tuned on, already on disk) order the units the way direction
# money on the test window does -- and does it do so better than today's
# fixed rule (beat its own null set on forecast score, ties by lead)?
# Pass rule, written before the numbers: build the ranking change only if
# the rank correlation of tuning-slice money with test-window money is at
# least +0.3 AND above the fixed rule's correlation with test-window money.
# Nothing is written.
set -uo pipefail
cd /opt/ultimate-trading-system
node - <<'JS'
const fs = require('fs');
const rowstore = require('./lib/rowstore');
const sw = require('./lib/stagework');
const bracketLib = require('./lib/bracket');
const S2 = 's2-mtdyamtf-1';
const d2 = JSON.parse(fs.readFileSync(`data/stagesets/${S2}.json`, 'utf8'));
const s1Id = d2.parent.id;
const seedOf = (id) => { let h = 2166136261 >>> 0; const s = String(id); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h || 1; };
const seed = seedOf(s1Id);
const fee = Number(d2.params.fee ?? 0.00125);
const NULLN = 100;
console.log('stage 2 set', S2, 'parent', s1Id, 'seed', seed, 'fee', fee, 'copies', NULLN);
const recs = rowstore.readAll(S2, 'records');
const unitKeyOf = (u) => `${u.trade}|${u.ctx1 || ''}|${u.ctx2 || ''}|${u.geometry}`;
const rowsOf = (store, range, u) => { const idxs = []; for (let b = range[0]; b < range[1]; b++) idxs.push(b); return rowstore.readBlocks(S2, store, idxs).map((x) => x.row).filter((r) => r.u === u); };
const callsOf = (probsPerMember, idx, n) => { const out = new Array(n); for (let i = 0; i < n; i++) { let up = 0, dn = 0; for (const mi of idx) { up += probsPerMember[mi][i][2]; dn += probsPerMember[mi][i][0]; } out[i] = up > dn ? 1 : up < dn ? -1 : 0; } return out; };
const f = (x, n = 1) => (x == null || !isFinite(x) ? '-' : Number(x).toFixed(n));
const rows = [];
(async () => {
  for (const rec of recs) {
    const key = unitKeyOf(rec);
    const { geo, maps, split } = await sw.unitChunks({ trade: rec.trade, ctx1: rec.ctx1, ctx2: rec.ctx2, size: rec.size }, rec.geometry, d2.params);
    const { trainChunks, testChunks } = split;
    const tau = rowsOf('tau', rec.blocks.tau, rec.u).sort((a, b) => a.mi - b.mi);
    const votes = rowsOf('votes', rec.blocks.votes, rec.u).filter((v) => v.w === 0).sort((a, b) => a.i - b.i);
    const M = rec.specs.length;
    if (tau.length !== M) { console.log(key, 'tau rows', tau.length, 'members', M); continue; }
    const nVal = tau[0].probs.length;
    if (tau.some((t) => t.probs.length !== nVal)) { console.log(key, 'tau lengths differ'); continue; }
    if (votes.length !== testChunks.length || votes.some((v, i) => v.ts !== testChunks[i].startTs)) { console.log(key, 'MISALIGNED test votes'); continue; }
    const valChunks = trainChunks.slice(trainChunks.length - nVal);
    const tauProbs = tau.map((t) => t.probs);
    const testProbs = []; for (let mi = 0; mi < M; mi++) testProbs.push(votes.map((v) => v.m[mi]));
    const all = rec.specs.map((_, i) => i); const lr = rec.specs.map((s, i) => (s.model === 'logreg' ? i : -1)).filter((i) => i >= 0);
    const tH = geo.exitOffsetH - geo.entryOffsetH;
    const money = (chunks, calls) => bracketLib.simMarket(chunks, calls, maps.trade, geo, { tHours: tH, feePerLeg: fee }).pnl;
    const cv8 = callsOf(tauProbs, all, nVal), cv4 = callsOf(tauProbs, lr, nVal);
    const ct8 = callsOf(testProbs, all, testChunks.length), ct4 = callsOf(testProbs, lr, testChunks.length);
    const mv8 = money(valChunks, cv8), mv4 = money(valChunks, cv4), mt8 = money(testChunks, ct8), mt4 = money(testChunks, ct4);
    let bv8 = 0, bt8 = 0; const nvArr = [], ntArr = [];
    for (let d = 0; d < NULLN; d++) {
      const ov = sw.dealOrder(seed, key, `s1val#${d}`, nVal); const mvd = money(valChunks, ov.map((k) => cv8[k])); nvArr.push(mvd); if (mv8 > mvd) bv8++;
      const ot = sw.dealOrder(seed, key, `s1#${d}`, testChunks.length); const mtd = money(testChunks, ot.map((k) => ct8[k])); ntArr.push(mtd); if (mt8 > mtd) bt8++;
    }
    rows.push({ key, nVal, nTest: testChunks.length, mv8, mv4, mt8, mt4, bv8, bt8, lv: sw.leadOver(mv8, nvArr), lt: sw.leadOver(mt8, ntArr), beat: rec.beat, lead: rec.lead, score3: rec.score3 });
  }
  const rank = (vals) => { const idx = vals.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]); const r = new Array(vals.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; };
  const pearson = (a, b) => { const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; } return saa && sbb ? sab / Math.sqrt(saa * sbb) : null; };
  const spearman = (a, b) => pearson(rank(a), rank(b));
  const fixedOrder = rows.map((r, i) => i).sort((i, j) => ((rows[j].beat || 0) - (rows[i].beat || 0)) || ((rows[j].lead || 0) - (rows[i].lead || 0)));
  const fixedScore = new Array(rows.length); fixedOrder.forEach((i, pos) => { fixedScore[i] = rows.length - pos; });
  const top = (vals, n = 10) => new Set(vals.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, n).map((x) => x[1]));
  const overlap = (a, b) => [...a].filter((x) => b.has(x)).length;
  const mt8 = rows.map((r) => r.mt8), mv8 = rows.map((r) => r.mv8), mv4 = rows.map((r) => r.mv4), mt4 = rows.map((r) => r.mt4);
  console.log(['unit'.padEnd(26), 'nVal', 'nTest', 'tune$8', 'tune$4', 'test$8', 'test$4', 'beatV', 'beatT', 'leadV', 'leadT', 'rule:beat', 'lead'].join(' '));
  for (const r of rows) console.log([r.key.padEnd(26), String(r.nVal).padStart(4), String(r.nTest).padStart(5), f(r.mv8).padStart(7), f(r.mv4).padStart(7), f(r.mt8).padStart(7), f(r.mt4).padStart(7), String(r.bv8).padStart(5), String(r.bt8).padStart(5), f(r.lv, 2).padStart(6), f(r.lt, 2).padStart(6), String(r.beat).padStart(9), f(r.lead, 2).padStart(5)].join(' '));
  console.log('');
  console.log('rank correlation with test-window money (all members):');
  console.log('  tuning-slice money (all members) :', f(spearman(mv8, mt8), 2));
  console.log('  tuning-slice money (stage 1 members only) vs test (stage 1 members only):', f(spearman(mv4, mt4), 2));
  console.log('  tuning-slice beat (copies)        :', f(spearman(rows.map((r) => r.bv8), mt8), 2));
  console.log("  today's fixed rule (beat, lead)  :", f(spearman(fixedScore, mt8), 2));
  console.log('  forecast score (stage 1 members) :', f(spearman(rows.map((r) => r.score3 || 0), mt8), 2));
  const tTop = top(mt8); const posT = new Set(rows.map((r, i) => (r.mt8 > 0 ? i : -1)).filter((i) => i >= 0));
  const say = (name, s) => console.log(`  top 10 by ${name}: ${overlap(s, tTop)} of the test-money top 10; ${overlap(s, posT)} of 10 make money on the test window; test-window beats avg ${f([...s].reduce((a, i) => a + rows[i].bt8, 0) / s.size, 1)} of 100`);
  say('tuning-slice money', top(mv8)); say('tuning-slice beat', top(rows.map((r) => r.bv8))); say("today's fixed rule", top(fixedScore));
  console.log(`  units making money on the test window: ${posT.size} of ${rows.length}; on the tuning slice: ${rows.filter((r) => r.mv8 > 0).length}`);
})().catch((e) => console.log('FAILED', e.stack));
JS
