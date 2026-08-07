// Declared training-extent stability test. Standalone file, not an inline
// node -e string: the first attempt embedded this program in a shell launcher
// and the quoting mangled it into silence (finished, empty output).
//
// SCORED PERIODS ARE IDENTICAL FOR EVERY EXTENT (the last 15% of history, never
// trained on). Only the amount of history feeding the members varies, always
// ending immediately before the scored slice, so any difference is attributable
// to training extent alone.
//
// READING RULE, declared before the run: STABLE means net money keeps its SIGN
// across all extents AND the call rate stays within a factor of two. Anything
// else disqualifies the setup from a live test regardless of its other numbers.
const bracketLib = require('/opt/general-classifier/lib/bracket');
const { buildCombo, trainMembers, quorumCall, specsFor, splitAndLabel } = require('/opt/general-classifier/lib/bracketwork');

const F1CELL = { quorum: 1, entry: 'market', gate: 'directional', dMult: null, tHours: 137, trailMult: null, armMult: null };
const F2CELL = { quorum: 1, entry: 'breakout', gate: 'active', dMult: 1.5, tHours: 161, trailMult: null, armMult: null };
const CASES = [
  { coin: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT', decision: 'argmax', cell: F1CELL, tag: 'F1 spec' },
  { coin: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT', decision: 'directional', cell: F1CELL, tag: 'cross' },
  { coin: 'XLMUSDT', ctx1: 'DOTUSDT', ctx2: 'TRXUSDT', decision: 'directional', cell: F2CELL, tag: 'F2 spec' },
  { coin: 'XLMUSDT', ctx1: 'DOTUSDT', ctx2: 'TRXUSDT', decision: 'argmax', cell: F2CELL, tag: 'cross' },
];
const EXTENTS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

(async () => {
  console.log('TRAINING-EXTENT STABILITY — same scored periods, varying only how much history trains the members');
  console.log('reading rule (declared before the run): net money must keep its SIGN and call rate stay within x2\n');
  for (const c of CASES) {
    const combo = { trade: c.coin, ctx1: c.ctx1, ctx2: c.ctx2, size: 3 };
    const branch = { geometry: 'daily-4d', decision: c.decision, band: 'auto', weekdaysOnly: false };
    const { geo, maps, chunks } = await buildCombo(combo, branch, { allLoaded: true });
    const { trainChunks, testChunks, holdChunks, bandPct } = splitAndLabel(chunks, branch, true);
    const pre = [...trainChunks, ...testChunks];
    const views = bracketLib.comboViews(3, geo.featureHours / 24).views;
    const specs = specsFor(3, 'slim');
    console.log(`== ${c.coin} ${c.decision} (${c.tag}, ${c.cell.entry} t${c.cell.tHours}, band ${bandPct.toFixed(2)}%, scored on ${holdChunks.length} held-back periods)`);
    console.log('   extent  trainPeriods  callRate  committee  trades      net $');
    const rows = [];
    for (const e of EXTENTS) {
      const n = Math.max(60, Math.floor(pre.length * e));
      const tr = pre.slice(pre.length - n);
      const ms = await trainMembers(specs, views, tr, holdChunks, branch, maps, geo);
      const cl = ms.map((m) => m.calls);
      const cr = cl.reduce((a, x) => a + x.filter((v) => v !== 0).length, 0) / (cl.length * holdChunks.length);
      const calls = holdChunks.map((_, i) => quorumCall(cl, i, c.cell.quorum));
      const q = calls.filter((v) => v !== 0).length;
      const r = bracketLib.simCell(c.cell, holdChunks, calls, maps.trade, geo, bandPct, 0.125);
      rows.push({ e, cr, net: r.pnl, trades: r.trades || 0 });
      console.log(`   ${(e * 100).toFixed(0).padStart(4)}%${String(n).padStart(13)}${(100 * cr).toFixed(1).padStart(9)}%`
        + `${(q + '/' + holdChunks.length).padStart(11)}${String(r.trades || 0).padStart(8)}${('$' + r.pnl.toFixed(2)).padStart(11)}`);
    }
    const nets = rows.map((r) => r.net);
    const crs = rows.map((r) => r.cr).filter((x) => x > 0);
    const signStable = nets.every((n) => n > 0) || nets.every((n) => n < 0);
    const ratio = crs.length ? Math.max(...crs) / Math.min(...crs) : Infinity;
    console.log(`   VERDICT: net sign ${signStable ? 'STABLE' : 'FLIPS (' + nets.map((n) => (n > 0 ? '+' : '-')).join('') + ')'}`
      + ` | call-rate spread x${ratio.toFixed(1)} (limit x2)`
      + ` -> ${signStable && ratio <= 2 ? 'STABLE' : 'UNSTABLE — disqualified from a live test'}`);
    console.log(`   money range across extents: $${Math.min(...nets).toFixed(2)} .. $${Math.max(...nets).toFixed(2)}\n`);
  }
})().catch((e) => { console.log('ERROR:', e.message); console.log(e.stack); });
