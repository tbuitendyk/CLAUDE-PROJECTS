// STRONGER PLATEAU TEST — does the surface keep its SHAPE out of sample?
//
// Authorised by the owner 2026-08-07 23:10 UTC ("Ok, stronger version then"),
// verified submission, after the cost was stated: this scores all 28 cells on
// the HELD-BACK window. From here on, held-back money is spent across this
// whole grid and can never again be fresh evidence for any cell in it. The
// FORWARD window is deliberately untouched and remains F1's only clean
// evidence.
//
// WHY IT IS STRONGER: the search-window plateau could not fail — all 28 cells
// were profitable there, so "neighbours are profitable" was guaranteed. Shape
// agreement between two windows can fail, and it tests the thing that matters:
// whether 137h/1-of-4 is where the geometry actually peaks, or just where the
// noise happened to peak on the window we picked from.
//
// READING RULE, declared before the run (both thresholds GUESSED):
//   R1 PEAK STABILITY — the held-back surface's best cell must lie within ONE
//      step of F1 in each dimension (hold length +/- one rung, agreement level
//      +/- one).
//   R2 SHAPE AGREEMENT — Spearman rank correlation between the 28 search values
//      and the 28 held-back values must be >= +0.50.
//   BOTH must hold for GEOMETRY REAL. Either failing gives FITTED, which
//   downgrades confidence in the specific cell; it does not retire F1, and the
//   forward record remains the thing that decides.
const bracketLib = require('/opt/general-classifier/lib/bracket');
const { buildCombo, trainMembers, quorumCall, specsFor, splitAndLabel } = require('/opt/general-classifier/lib/bracketwork');

const COMBO = { trade: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT', size: 3 };
const BRANCH = { geometry: 'daily-4d', decision: 'argmax', band: 'auto', weekdaysOnly: false };
const F1 = { quorum: 1, tHours: 137 };
const FEE = 0.125;

function spearman(a, b) {
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(v.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  const ma = ra.reduce((x, y) => x + y, 0) / n, mb = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}

(async () => {
  const { geo, maps, chunks } = await buildCombo(COMBO, BRANCH, { allLoaded: true });
  const { trainChunks, testChunks, holdChunks, bandPct } = splitAndLabel(chunks, BRANCH, true);
  const views = bracketLib.comboViews(3, geo.featureHours / 24).views;
  // One training pass, predicting over test THEN hold, then split — the same
  // models score both surfaces, so any difference is the window, not the model.
  const members = await trainMembers(specsFor(3, 'slim'), views, trainChunks, [...testChunks, ...holdChunks], BRANCH, maps, geo);
  const all = members.map((m) => m.calls);
  const mcTest = all.map((c) => c.slice(0, testChunks.length));
  const mcHold = all.map((c) => c.slice(testChunks.length));
  const TH = bracketLib.T_HOURS;

  const surf = (chunksFor, mc) => {
    const out = {};
    for (let q = 1; q <= 4; q++) {
      const calls = chunksFor.map((_, i) => quorumCall(mc, i, q));
      for (const t of TH) {
        const r = bracketLib.simCell({ quorum: q, entry: 'market', gate: 'directional', dMult: null, tHours: t, trailMult: null, armMult: null },
          chunksFor, calls, maps.trade, geo, bandPct, FEE);
        out[`${q}|${t}`] = { net: r.pnl, trades: r.trades || 0 };
      }
    }
    return out;
  };
  const S = surf(testChunks, mcTest);
  const H = surf(holdChunks, mcHold);

  console.log('STRONGER PLATEAU TEST — does the surface keep its shape out of sample?');
  console.log(`LTC+XRP+BCH daily-4d argmax, 4-member slim, market entry, band ${bandPct.toFixed(2)}%`);
  console.log(`search ${testChunks.length} periods | held-back ${holdChunks.length} periods\n`);
  console.log('HELD-BACK net money $ (search value in brackets); * = F1');
  console.log('        ' + TH.map((t) => String(t + 'h').padStart(16)).join(''));
  for (let q = 1; q <= 4; q++) {
    let row = `  ${q}-of-4`;
    for (const t of TH) {
      const mark = (q === F1.quorum && t === F1.tHours) ? '*' : ' ';
      row += `${mark}${('$' + H[`${q}|${t}`].net.toFixed(0)).padStart(6)}[${('$' + S[`${q}|${t}`].net.toFixed(0)).padStart(6)}]`;
    }
    console.log(row);
  }
  const keys = Object.keys(S);
  const rho = spearman(keys.map((k) => S[k].net), keys.map((k) => H[k].net));
  const bestS = keys.reduce((a, b) => (S[b].net > S[a].net ? b : a));
  const bestH = keys.reduce((a, b) => (H[b].net > H[a].net ? b : a));
  const [bq, bt] = bestH.split('|').map(Number);
  const dq = Math.abs(bq - F1.quorum);
  const dt = Math.abs(TH.indexOf(bt) - TH.indexOf(F1.tHours));
  const posH = keys.filter((k) => H[k].net > 0).length;

  console.log(`\nsearch peak    : ${bestS.replace('|', '-of-4 @ ')}h  $${S[bestS].net.toFixed(2)}`);
  console.log(`held-back peak : ${bestH.replace('|', '-of-4 @ ')}h  $${H[bestH].net.toFixed(2)}`);
  console.log(`F1 held-back   : $${H[`${F1.quorum}|${F1.tHours}`].net.toFixed(2)} (${H[`${F1.quorum}|${F1.tHours}`].trades} trades)`);
  console.log(`held-back cells profitable: ${posH} of 28   (search: ${keys.filter((k) => S[k].net > 0).length} of 28)`);
  console.log(`\nR1 peak stability : held-back peak is ${dq} agreement step(s) and ${dt} hold-length step(s) from F1`
    + `  -> ${dq <= 1 && dt <= 1 ? 'PASS' : 'FAIL'} (limit 1 each)`);
  console.log(`R2 shape agreement: Spearman rho = ${rho.toFixed(3)}  -> ${rho >= 0.5 ? 'PASS' : 'FAIL'} (limit +0.50)`);
  const real = dq <= 1 && dt <= 1 && rho >= 0.5;
  console.log(`\nVERDICT: ${real ? 'GEOMETRY REAL — the surface keeps its shape out of sample' : 'FITTED — the peak does not survive the window change; confidence in this cell DOWNGRADED'}`);
})().catch((e) => { console.log('ERROR:', e.message); console.log(e.stack); });
