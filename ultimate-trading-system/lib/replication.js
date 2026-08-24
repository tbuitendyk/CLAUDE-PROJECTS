// THE REPLICATION TABLE, BUILT BY STREAMING (owner order, 2026-08-22).
//
// The Construct page used to do this arithmetic in the browser, over every row
// the run recorded. That was right when a run recorded a few hundred: one
// declared configuration on seventeen assets is seventeen rows. It stopped
// being right the moment the declared boxes could be permuted — 8,232
// configurations on 50,184 units is 413 million rows, which is not a table
// anybody renders and not a payload anybody ships.
//
// What the table actually shows is one line per CONFIGURATION: how many of its
// assets held up, how much money on the once-only look, how many of its own
// dealt-vote copies it beat, and how wide a region of neighbouring settings sat
// around it. All of those are running totals. So they are accumulated as the
// rows stream past, one line at a time, and what comes back is bounded by the
// number of configurations rather than by the number of rows.
//
// THE READING RULES ARE UNCHANGED and they are the point of the file:
//
//   * null copies score the declared cell too — that is their job — and they
//     must never enter the cross-asset count (QC 72). They contribute only to
//     the measured null: how many of a configuration's own copies its real
//     held-back money beat.
//   * every figure is the HELD-BACK window, never the window the settings were
//     chosen on.
//   * the ordering leads on the measured null, then plateau width, then the
//     share of assets, then money. Money is LAST on purpose: leading on it
//     rebuilds the shopped board. No p-value appears in the sort key at all
//     (QC-7 — assets move together, so they are not independent looks).
const rowstore = require('./rowstore');
const payload = require('./payload');

const assetKey = (r) => `${r.trade}|${r.ctx1 || ''}|${r.ctx2 || ''}|${r.geometry}`;

// Plateau width lives on the leader rows, keyed by asset and chunk shape.
function regionsByAsset(leaders) {
  const m = new Map();
  for (const l of (leaders || [])) {
    if (l.nullDealSeed != null || !l.region) continue;
    const k = assetKey(l);
    const prev = m.get(k);
    if (prev == null || (l.region.size || 0) > prev) m.set(k, l.region.size || 0);
  }
  return m;
}

// One pass over the rows. `rowsOf` yields every recorded row exactly once; it is
// the store for a run that has one and the doc's own array for a run recorded
// before the rows moved to disk.
function rowsOf(doc, fn) {
  if (rowstore.exists(doc.id, 'replication')) return rowstore.each(doc.id, 'replication', fn);
  let n = 0;
  for (const r of (doc.replication || [])) { n++; if (fn(r, n - 1) === false) return n; }
  return n;
}

// PER CONFIGURATION, AND NOTHING PER ROW — now meant literally (owner order,
// 2026-08-23).
//
// This used to carry back up to 60 example rows per configuration so the
// per-asset table under each line could be drawn without a second request.
// Fine for one declared configuration. On a run that declares 2,772 of them it
// is 166,320 rows in one reply: 99 MB, which no browser renders and no screen
// ever showed, because the request never finished.
//
// The rows are not lost and they were never needed here: detail() fetches one
// configuration's rows, capped and counted, when a reader actually opens that
// line. So the ranked list is now what its own name says — one summary per
// configuration — and the reply is bounded by the number of configurations
// rather than by the number of rows behind them.
function rank(doc, { detailCap = 0, ...query } = {}) {
  const regions = regionsByAsset(doc.leaders || []);
  const groups = new Map();
  let total = 0;

  // TWO PASSES, because the rule depends on something only the rows can say.
  // A run recorded before the copy tag existed carries no nullDealSeed on ANY
  // row, and filtering on it there keeps everything — silently mixing dealt-vote
  // copies into the cross-asset count. On those runs each asset's FIRST recorded
  // row is taken as the real one (real copies are queued ahead of every copy)
  // and the measured null stays absent by fact rather than by accident. The
  // screen says so rather than presenting an inferred count as a measured one.
  let tagged = false;
  rowsOf(doc, (r) => { if ('nullDealSeed' in r) { tagged = true; return false; } return true; });
  const seenUntagged = new Set();
  let dropped = 0;

  rowsOf(doc, (r) => {
    total++;
    const label = r.declaredLabel || 'declared config';
    if (!tagged) {
      const dk = `${assetKey(r)}|${label}`;
      if (seenUntagged.has(dk)) { dropped++; return true; }
      seenUntagged.add(dk);
    }
    let g = groups.get(label);
    if (!g) {
      g = {
        label,
        holdCount: 0, pos: 0, vsLCount: 0, vsLPos: 0, sum: 0,
        assets: new Set(), regionSum: 0, regionN: 0,
        nullBeat: 0, nullPairs: 0,
        realHold: new Map(),      // asset -> held-back money, for the pairing
        pendingNulls: new Map(),  // asset -> null money seen before its real row
        reals: [], realsTotal: 0,
      };
      groups.set(label, g);
    }
    const k = assetKey(r);
    const hold = r.holdout && r.holdout.pnl != null ? r.holdout.pnl : null;

    if (!tagged || r.nullDealSeed == null) {
      g.realsTotal++;
      if (detailCap > 0 && g.reals.length < detailCap) g.reals.push(r);
      g.assets.add(k);
      const reg = regions.get(k);
      if (reg != null) { g.regionSum += reg; g.regionN++; }
      if (hold != null) {
        g.holdCount++;
        g.sum += hold;
        if (hold > 0) g.pos++;
        const vsL = r.holdout.vsAlwaysLong;
        if (vsL != null) { g.vsLCount++; if (vsL > 0) g.vsLPos++; }
        // pair against every copy of this asset already seen, and remember the
        // real figure so copies arriving later can be paired too
        let mine = g.realHold.get(k);
        if (!mine) { mine = []; g.realHold.set(k, mine); }
        mine.push(hold);
        for (const nv of (g.pendingNulls.get(k) || [])) { g.nullPairs++; if (hold > nv) g.nullBeat++; }
      }
    } else if (hold != null) {
      // `hold` here is the COPY's held-back money; `mine` is the real one.
      for (const mine of (g.realHold.get(k) || [])) { g.nullPairs++; if (mine > hold) g.nullBeat++; }
      let pend = g.pendingNulls.get(k);
      if (!pend) { pend = []; g.pendingNulls.set(k, pend); }
      pend.push(hold);
    }
  });

  const scored = [...groups.values()].map((g) => ({
    label: g.label,
    assets: g.assets.size,
    holdCount: g.holdCount,
    pos: g.pos,
    vsLCount: g.vsLCount,
    vsLPos: g.vsLPos,
    sum: g.sum,
    region: g.regionN ? Math.round(g.regionSum / g.regionN) : null,
    nullBeat: g.nullBeat,
    nullPairs: g.nullPairs,
    nullShare: g.nullPairs ? g.nullBeat / g.nullPairs : null,
    reals: g.reals,
    realsTotal: g.realsTotal,
    realsShown: g.reals.length,
  }));

  // The first key must return 0 when NEITHER side has a measured null, or the
  // `||` chain never reaches plateau width and money. Returning -1 there made a
  // comparator not even consistent with itself, so the order was arbitrary
  // rather than merely wrong.
  const byNull = (a, b) => (a.nullShare == null && b.nullShare == null ? 0
    : b.nullShare == null ? -1 : a.nullShare == null ? 1 : b.nullShare - a.nullShare);
  scored.sort((a, b) => byNull(a, b)
    || (b.region ?? -1) - (a.region ?? -1)
    || (b.pos / (b.holdCount || 1)) - (a.pos / (a.holdCount || 1))
    || b.sum - a.sum);

  // PAGED OVER CONFIGURATIONS (owner order, 2026-08-23: "make it sane and
  // pageable"). Sorted whole first — the ordering is a claim about which row is
  // better and it has to be made over everything, not over a page — then a
  // slice of that order is returned. `configs` is the true count either way, so
  // a page can never read as the whole list.
  const win = payload.page(scored, query);
  return {
    total, tagged, dropped, configs: scored.length,
    scored: win.rows,
    page: { offset: win.offset, limit: win.limit, total: win.total, shown: win.shown, more: win.more },
  };
}

// Every real row of ONE configuration, for the per-asset table a reader opens.
//
// PAGED, NOT CAPPED (owner order, 2026-08-23). It used to hand back the first
// 500 and say how many it had left behind — honest, but there was no way to
// ask for the 501st, so four fifths of a configuration's rows were simply
// unreachable from the screen. It walks to `offset` and returns `limit` from
// there, streaming throughout: nothing but the page being built is ever held.
function detail(doc, label, { offset = 0, limit = 200 } = {}) {
  const from = Math.max(0, Math.floor(Number(offset) || 0));
  const take = Math.min(1000, Math.max(1, Math.floor(Number(limit) || 200)));
  const out = [];
  let matched = 0;
  rowsOf(doc, (r) => {
    if ((r.declaredLabel || 'declared config') !== label) return true;
    if (r.nullDealSeed != null) return true;   // a copy is machinery, never an asset row
    matched++;
    // matched keeps counting past the page so `total` is the real total — a
    // reader has to be able to see how far they have to go.
    if (matched > from && out.length < take) out.push(r);
    return true;
  });
  return {
    label,
    rows: out,
    matched,
    shown: out.length,
    page: { offset: from, limit: take, total: matched, shown: out.length, more: from + out.length < matched },
  };
}

module.exports = { rank, detail, assetKey };
