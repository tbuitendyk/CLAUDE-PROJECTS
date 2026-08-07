// PLATEAU CHECK for F1 (LTC+XRP+BCH, daily-4d, argmax, 4-member slim).
//
// PURPOSE: this SELECTS NOTHING. It asks one question about the cell we
// already have — is F1 sitting on a plateau, where neighbouring settings behave
// similarly, or on a spike, where it happens to be the one profitable point in
// a field of losses? A spike is the signature of a setting fitted to noise.
//
// WINDOW: the SEARCH (test) window only. The held-back window is not touched
// and not printed. Scoring 28 cells on the held-back window would spend it
// across the whole neighbourhood, which is exactly what the engine's own menu
// grid refuses to do (per-cell held-back numbers never leave the engine). The
// forward window is likewise untouched — it is the only clean evidence F1 has
// left and it is not being spent on a diagnostic.
//
// CONSTRUCTION: the board's own — train on the first 70%, score the test slice,
// so this reproduces the context F1 was selected in.
//
// READING RULE, declared before the run:
//   PLATEAU  = of F1's four immediate neighbours (137h at quorum 2; 113h and
//              161h at quorum 1 — the grid edges count as fewer), a MAJORITY
//              are profitable AND within a factor of 3 of F1's money.
//   SPIKE    = F1 profitable while a majority of neighbours are not, or F1
//              exceeding every neighbour by more than 3x.
//   Thresholds are GUESSED, declared in advance. A spike does not retire F1 —
//   it downgrades confidence and says the cell was fitted, not found.
const bracketLib = require('/opt/general-classifier/lib/bracket');
const { buildCombo, trainMembers, quorumCall, specsFor, splitAndLabel } = require('/opt/general-classifier/lib/bracketwork');

const COMBO = { trade: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT', size: 3 };
const BRANCH = { geometry: 'daily-4d', decision: 'argmax', band: 'auto', weekdaysOnly: false };
const F1 = { quorum: 1, tHours: 137 };
const FEE = 0.125;

(async () => {
  const { geo, maps, chunks } = await buildCombo(COMBO, BRANCH, { allLoaded: true });
  const { trainChunks, testChunks, bandPct } = splitAndLabel(chunks, BRANCH, true);
  const views = bracketLib.comboViews(3, geo.featureHours / 24).views;
  const members = await trainMembers(specsFor(3, 'slim'), views, trainChunks, testChunks, BRANCH, maps, geo);
  const mc = members.map((m) => m.calls);

  console.log('PLATEAU CHECK — F1 neighbourhood, SEARCH window only (held-back and forward untouched)');
  console.log(`LTC+XRP+BCH daily-4d argmax, 4-member slim, market entry, band ${bandPct.toFixed(2)}%, ${testChunks.length} periods\n`);
  console.log('net money $ by hold length (columns) x agreement level (rows); (t) = trades');
  const TH = bracketLib.T_HOURS;
  console.log('        ' + TH.map((t) => String(t + 'h').padStart(13)).join(''));
  const grid = {};
  for (let q = 1; q <= 4; q++) {
    let row = `  ${q}-of-4`;
    for (const t of TH) {
      const calls = testChunks.map((_, i) => quorumCall(mc, i, q));
      const r = bracketLib.simCell({ quorum: q, entry: 'market', gate: 'directional', dMult: null, tHours: t, trailMult: null, armMult: null },
        testChunks, calls, maps.trade, geo, bandPct, FEE);
      grid[`${q}|${t}`] = { net: r.pnl, trades: r.trades || 0 };
      const mark = (q === F1.quorum && t === F1.tHours) ? '*' : ' ';
      row += `${mark}${('$' + r.pnl.toFixed(0)).padStart(7)}(${String(r.trades || 0).padStart(3)})`;
    }
    console.log(row);
  }
  const me = grid[`${F1.quorum}|${F1.tHours}`];
  const nb = [];
  const iT = TH.indexOf(F1.tHours);
  if (iT > 0) nb.push({ k: `${F1.quorum}|${TH[iT - 1]}`, why: `${TH[iT - 1]}h same level` });
  if (iT < TH.length - 1) nb.push({ k: `${F1.quorum}|${TH[iT + 1]}`, why: `${TH[iT + 1]}h same level` });
  nb.push({ k: `2|${F1.tHours}`, why: '2-of-4 same hold' });
  console.log(`\n* F1 = 1-of-4, 137h: $${me.net.toFixed(2)} over ${me.trades} trades`);
  console.log('immediate neighbours:');
  let profitable = 0, within = 0;
  for (const n of nb) {
    const g = grid[n.k];
    const ok = g.net > 0;
    const near = me.net !== 0 && g.net > 0 && Math.max(g.net, me.net) / Math.min(g.net, me.net) <= 3;
    if (ok) profitable++;
    if (near) within++;
    console.log(`   ${n.why.padEnd(20)} $${g.net.toFixed(2).padStart(9)} (${g.trades}t)  ${ok ? 'profitable' : 'LOSS'}${near ? ', within 3x' : ''}`);
  }
  const all = Object.values(grid);
  const pos = all.filter((g) => g.net > 0).length;
  console.log(`\nwhole 28-cell grid: ${pos} of 28 cells profitable on the search window`);
  const verdict = (profitable > nb.length / 2 && within > nb.length / 2) ? 'PLATEAU' : 'SPIKE';
  console.log(`VERDICT (rule declared before the run): ${verdict}`);
  console.log(verdict === 'PLATEAU'
    ? '  -> neighbouring settings behave similarly; the cell was found, not fitted to a knife-edge.'
    : '  -> F1 stands alone among its neighbours; confidence DOWNGRADED — the cell looks fitted. Not retired.');
})().catch((e) => { console.log('ERROR:', e.message); console.log(e.stack); });
