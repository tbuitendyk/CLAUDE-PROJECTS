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

// THE TALLY HAS ONE DEFINITION (owner order, 2026-08-25: "do the running
// tallies now"). This function is the only place the table's numbers are
// computed — the in-request path for small old runs, the background build for
// stored runs, and every test all call it, so there is no second copy to
// drift.
//
// `each` is called twice: once to learn whether the rows carry the copy tag,
// once to tally. What comes out is small — one entry per configuration — and
// it deliberately contains NOTHING that depends on the run document, so it can
// be saved beside the rows and stay true: plateau widths live on the leader
// rows and change while a run goes, so the tally keeps a per-asset row count
// instead and the widths are looked up at reading time.
function tallyOver(each) {
  // A run recorded before the copy tag existed carries no nullDealSeed on ANY
  // row, and filtering on it there keeps everything — silently mixing
  // dealt-vote copies into the cross-asset count. On those runs each asset's
  // FIRST recorded row is taken as the real one (real copies are queued ahead
  // of every copy), and the screen says INFERRED rather than measured.
  let tagged = false;
  each((r) => { if ('nullDealSeed' in r) { tagged = true; return false; } return true; });
  const seenUntagged = new Set();
  let dropped = 0;
  let rowsSeen = 0;
  const groups = new Map();

  each((r) => {
    rowsSeen++;
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
        assetRows: {},            // assetKey -> real rows seen, for widths later
        nullBeat: 0, nullPairs: 0,
        realHold: new Map(),      // asset -> held-back money, for the pairing
        pendingNulls: new Map(),  // asset -> null money seen before its real row
        realsTotal: 0,
      };
      groups.set(label, g);
    }
    const k = assetKey(r);
    const hold = r.holdout && r.holdout.pnl != null ? r.holdout.pnl : null;

    if (!tagged || r.nullDealSeed == null) {
      g.realsTotal++;
      g.assetRows[k] = (g.assetRows[k] || 0) + 1;
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
      // `hold` here is the COPY\'s held-back money; `mine` is the real one.
      for (const mine of (g.realHold.get(k) || [])) { g.nullPairs++; if (mine > hold) g.nullBeat++; }
      let pend = g.pendingNulls.get(k);
      if (!pend) { pend = []; g.pendingNulls.set(k, pend); }
      pend.push(hold);
    }
    return true;
  });

  // The pairing scratch is the expensive part and it is done with: what leaves
  // this function is one small entry per configuration.
  return {
    v: 1,
    builtAt: new Date().toISOString(),
    tagged,
    dropped,
    rowsSeen,
    groups: [...groups.values()].map((g) => ({
      label: g.label,
      holdCount: g.holdCount,
      pos: g.pos,
      vsLCount: g.vsLCount,
      vsLPos: g.vsLPos,
      sum: g.sum,
      assetRows: g.assetRows,
      nullBeat: g.nullBeat,
      nullPairs: g.nullPairs,
      realsTotal: g.realsTotal,
    })),
  };
}

// From a tally to the rows the screen shows: widths joined in from the CURRENT
// leader rows (they sharpen while a run goes, so they are never baked into a
// saved tally), then the standing order — measured null, plateau width, share
// of assets, money last (QC-7, QC-142).
function renderScored(totals, leaders) {
  const regions = regionsByAsset(leaders || []);
  const scored = totals.groups.map((g) => {
    let regionSum = 0;
    let regionN = 0;
    for (const [k, n] of Object.entries(g.assetRows || {})) {
      const reg = regions.get(k);
      if (reg != null) { regionSum += reg * n; regionN += n; }
    }
    return {
      label: g.label,
      assets: Object.keys(g.assetRows || {}).length,
      holdCount: g.holdCount,
      pos: g.pos,
      vsLCount: g.vsLCount,
      vsLPos: g.vsLPos,
      sum: g.sum,
      region: regionN ? Math.round(regionSum / regionN) : null,
      nullBeat: g.nullBeat,
      nullPairs: g.nullPairs,
      nullShare: g.nullPairs ? g.nullBeat / g.nullPairs : null,
      reals: [],
      realsTotal: g.realsTotal,
      realsShown: 0,
    };
  });
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
  return scored;
}

// ---- the saved tally, and the background build ------------------------------
//
// Reading 49,519,009 rows takes about ten minutes, and it used to happen on
// the one thread that answers every page — opening this table froze the whole
// site (owner, 2026-08-25). Now the tally is BUILT ONCE, off that thread, and
// SAVED beside the rows with the row count it covers. Serving it afterwards
// costs nothing. It is rebuilt automatically when a run finishes, and in the
// background on first open for anything older.
const fs = require('fs');
const path = require('path');

function totalsFile(runId) {
  return path.join(rowstore.storeDir(runId), 'replication.totals.json');
}

function readTotals(runId) {
  try { return JSON.parse(fs.readFileSync(totalsFile(runId), 'utf8')); } catch (_) { return null; }
}

function writeTotals(runId, totals) {
  const f = totalsFile(runId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(totals));
  fs.renameSync(tmp, f);
}

// The full pass, streamed from the store. Run this in a worker thread, never
// on the answering thread — that is the whole point of this file's change.
function buildAndSaveTotals(runId, onProgress) {
  let n = 0;
  const totals = tallyOver((fn) => rowstore.each(runId, 'replication', (r) => {
    n++;
    if (onProgress && n % 1000000 === 0) onProgress(n);
    return fn(r);
  }));
  writeTotals(runId, totals);
  return totals;
}

// One build per run at a time, in a worker thread, at the kindest priority the
// box offers. Fire-and-forget: rank() reports its progress, and the run\'s
// completion fires it so a finished run is already totalled before anybody
// asks.
const builds = new Map();   // runId -> { scanned, startedAt, error }

function startTotals(runId) {
  const going = builds.get(runId);
  if (going && !going.error) return going;
  const state = { scanned: 0, startedAt: Date.now(), error: null };
  builds.set(runId, state);
  try {
    const { Worker } = require('worker_threads');
    const w = new Worker(path.join(__dirname, 'replication-worker.js'), { workerData: { runId } });
    w.on('message', (m) => {
      if (m.scanned != null) state.scanned = m.scanned;
      if (m.error) { state.error = m.error; }
      if (m.done) builds.delete(runId);
    });
    w.on('error', (e) => { state.error = e.message; });
    w.on('exit', (code) => { if (code === 0) builds.delete(runId); else if (!state.error) state.error = `the build stopped with code ${code}`; });
    w.unref();
  } catch (err) {
    state.error = err.message;
  }
  return state;
}

function rank(doc, { detailCap = 0, ...query } = {}) {
  void detailCap;   // examples come from detail() since 2026-08-23; kept for callers
  const pack = (scored, extra) => {
    const win = payload.page(scored, query);
    return {
      tagged: extra.tagged, dropped: extra.dropped, total: extra.total,
      configs: scored.length,
      scored: win.rows,
      page: { offset: win.offset, limit: win.limit, total: win.total, shown: win.shown, more: win.more },
      ...extra.meta,
    };
  };

  // A run recorded before the rows moved to disk: small by construction, so it
  // is tallied here and now — through the SAME definition as everything else.
  if (!rowstore.exists(doc.id, 'replication')) {
    const t = tallyOver((fn) => { for (const r of (doc.replication || [])) if (fn(r) === false) return; });
    return pack(renderScored(t, doc.leaders), {
      tagged: t.tagged, dropped: t.dropped, total: t.rowsSeen,
      meta: { totals: { upToDate: true, asOfRows: t.rowsSeen, builtAt: t.builtAt } },
    });
  }

  const rows = rowstore.count(doc.id, 'replication');
  const saved = readTotals(doc.id);
  if (saved && saved.rowsSeen === rows) {
    return pack(renderScored(saved, doc.leaders), {
      tagged: saved.tagged, dropped: saved.dropped, total: rows,
      meta: { totals: { upToDate: true, asOfRows: rows, builtAt: saved.builtAt } },
    });
  }

  // Behind, or never built. While a run is GOING, a tally a few minutes old is
  // served as what it is — "as of N rows" — and a fresh build is only started
  // when there is no tally at all, or the run has stopped, or the saved one
  // has fallen more than fifteen minutes behind. Without that hold-off, every
  // open during a run would queue another ten-minute pass behind the last.
  const running = doc.status === 'running';
  const savedAgeMs = saved ? Date.now() - new Date(saved.builtAt).getTime() : Infinity;
  const wantBuild = !saved || !running || savedAgeMs > 15 * 60 * 1000;
  const state = wantBuild ? startTotals(doc.id) : (builds.get(doc.id) || null);
  const buildingMeta = {
    building: !!(state && !state.error),
    scanned: state ? state.scanned : 0,
    of: rows,
    ...(state && state.error ? { buildError: `the totalling stopped: ${state.error}` } : {}),
  };
  if (saved) {
    return pack(renderScored(saved, doc.leaders), {
      tagged: saved.tagged, dropped: saved.dropped, total: rows,
      meta: { totals: { upToDate: false, asOfRows: saved.rowsSeen, builtAt: saved.builtAt }, ...buildingMeta },
    });
  }
  return { ...buildingMeta, tagged: null, dropped: 0, total: rows, configs: 0, scored: [], page: { offset: 0, limit: 0, total: 0, shown: 0, more: false } };
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

module.exports = { rank, detail, assetKey, tallyOver, renderScored, buildAndSaveTotals, startTotals, readTotals, writeTotals, totalsFile };
