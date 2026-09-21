// uts-two-sets-per-coin.js -- READ-ONLY. Two named stage 3 sets side by side,
// per coin and chunk shape: the best record of each set by beat the kept null
// money (test trades of 10 or more), with its test money and trades, held-back
// money, trades, beat its own null set, vs always-long, lead, and share that
// agreed; and, at the control's best share, every plateau share the with-set
// priced on that coin. Reads the record stores and the agreed answers beside
// them. Writes nothing, starts nothing.
//
//   arg: best+<withId>+<controlId>   the best row per coin on each, compared
//   arg: like+<withId>+<controlId>   at the control's best share, every plateau share
const fs = require('fs');
const APP = '/opt/ultimate-trading-system';
const rowstore = require(`${APP}/lib/rowstore`);
const stages = require(`${APP}/lib/stages`);
const sw = require(`${APP}/lib/stagework`);
const [mode, A, B] = String(process.argv[2] || '').split('+');
if (!mode || !A || !B) { console.log('usage: best+<withId>+<controlId> | like+<withId>+<controlId>'); process.exit(0); }
const r2 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
function load(id) {
  const doc = JSON.parse(fs.readFileSync(`${APP}/data/stagesets/${id}.json`, 'utf8'));
  const agreed = stages.readAgreed(id) || {};
  const blocks = rowstore.blocksOf(id, 'records') || [];
  const rows = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    for (const x of rowstore.readBlocks(id, 'records', [bi])) {
      const r = x.row;
      const nt = Array.isArray(r.noiseTest) ? r.noiseTest.filter((v) => v != null) : [];
      const ag = agreed[`${r.u}|${sw.agreedKeyOfRecord(r)}`] || null;
      rows.push({
        coin: r.trade, geo: r.geometry, u: r.u,
        pct: r.agreePct == null ? null : Number(r.agreePct), plat: r.plateauPct == null ? null : Number(r.plateauPct),
        name: String(r.label).split(' · ')[0].replace(/ market.*$/, ''),
        bn: nt.filter((v) => r.pnl > v).length, np: nt.length,
        t: r2(r.pnl), tt: r.trades == null ? null : Number(r.trades),
        h: r.holdout ? r2(r.holdout.pnl) : null, ht: r.holdout ? r.holdout.trades : null, vl: r.holdout ? r2(r.holdout.vsAlwaysLong) : null,
        hb: r.beat ?? null, hp: r.pairs ?? null, lead: r2(r.lead), ag: ag && ag.agreed != null ? r2(ag.agreed) : null,
        members: r.members ?? null, voices: r.voices ?? null,
      });
    }
  }
  return { id, name: doc.name, release: doc.release || null, rule: (doc.params || {}).agreeRule || null, n: rows.length, rows };
}
const share = (r) => (r.np ? r.bn / r.np : -1);
const better = (a, b) => (share(b) - share(a)) || ((b.t ?? -1e15) - (a.t ?? -1e15));
function bestPerCoin(set) {
  const by = new Map();
  for (const r of set.rows) { const k = `${r.coin}|${r.geo}`; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  const out = new Map();
  for (const [k, list] of by) {
    const enough = list.filter((r) => (r.tt ?? 0) >= 10);
    const pool = enough.length ? enough : list;
    const sorted = pool.slice().sort(better);
    out.set(k, { ...sorted[0], thin: !enough.length, of: list.length });
  }
  return out;
}
const W = load(A);
const C = load(B);
const bw = bestPerCoin(W);
const bc = bestPerCoin(C);
const keys = [...new Set([...bw.keys(), ...bc.keys()])].sort();
const head = { with: { id: W.id, name: W.name, release: W.release, rule: W.rule, records: W.n }, control: { id: C.id, name: C.name, release: C.release, rule: C.rule, records: C.n } };
if (mode === 'best') {
  const coins = keys.map((k) => {
    const w = bw.get(k) || null; const c = bc.get(k) || null;
    const d = w && c && w.np && c.np ? r2((share(w) - share(c)) * 100) : null;
    const hOk = w && c && w.h != null && c.h != null;
    let verdict = 'tie';
    if (d != null && hOk && d >= 5 && w.h >= c.h) verdict = 'with';
    else if (d != null && hOk && d <= -5 && c.h >= w.h) verdict = 'control';
    return { coin: k, with: w, control: c, d, verdict };
  });
  const tally = { with: coins.filter((x) => x.verdict === 'with').length, control: coins.filter((x) => x.verdict === 'control').length, tie: coins.filter((x) => x.verdict === 'tie').length };
  console.log(JSON.stringify({ ...head, tally, coins }));
} else {
  const coins = keys.map((k) => {
    const c = bc.get(k) || null;
    const at = c ? W.rows.filter((r) => r.coin === c.coin && r.geo === c.geo && r.pct === c.pct).sort((x, y) => (x.plat ?? 0) - (y.plat ?? 0)) : [];
    return { coin: k, pct: c ? c.pct : null, control: c ? [c.bn, c.np, c.t, c.tt, c.h] : null, with: at.map((r) => [r.plat, r.bn, r.np, r.t, r.tt, r.h]) };
  });
  console.log(JSON.stringify({ ...head, legend: 'control [beat, of, test$, testTrades, held$]; with rows [plateau%, beat, of, test$, testTrades, held$]', coins }));
}
