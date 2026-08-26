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

  each((r, at) => {
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
        vsLCount: 0, vsLPos: 0,
        assets: new Map(),        // assetKey -> this configuration's score ON THAT COIN
        realHold: new Map(),      // asset -> held-back money, for the pairing
        pendingNulls: new Map(),  // asset -> null money seen before its real row
        realsTotal: 0,
      };
      groups.set(label, g);
    }
    const k = assetKey(r);
    let a = g.assets.get(k);
    if (!a) { a = { n: 0, hold: 0, pos: 0, sum: 0, t: 0, vl: 0, vln: 0, beat: 0, pairs: 0, at: [] }; g.assets.set(k, a); }
    const hold = r.holdout && r.holdout.pnl != null ? r.holdout.pnl : null;

    if (!tagged || r.nullDealSeed == null) {
      g.realsTotal++;
      a.n++;
      // WHERE the row sits, so a reader can be handed the records themselves
      // (owner order, 2026-08-25: "allow an open-records-below arrow that
      // expands to the detail records"). Saved as BLOCK positions, never row
      // positions — buildAndSaveTotals makes that swap before writing.
      if (typeof at === 'number') a.at.push(at);
      if (hold != null) {
        a.hold++;
        a.sum += hold;
        a.t += (r.holdout.trades || 0);
        if (hold > 0) a.pos++;
        const vsL = r.holdout.vsAlwaysLong;
        // Kept per coin as well as per configuration (owner order,
        // 2026-08-26: "expose the average vs always-long of the underlying
        // records for each record" of the every-coin table).
        if (vsL != null) { g.vsLCount++; if (vsL > 0) g.vsLPos++; a.vl += vsL; a.vln++; }
        // pair against every copy of this asset already seen, and remember the
        // real figure so copies arriving later can be paired too
        let mine = g.realHold.get(k);
        if (!mine) { mine = []; g.realHold.set(k, mine); }
        mine.push(hold);
        for (const nv of (g.pendingNulls.get(k) || [])) { a.pairs++; if (hold > nv) a.beat++; }
      }
    } else if (hold != null) {
      // `hold` here is the COPY\'s held-back money; `mine` is the real one.
      for (const mine of (g.realHold.get(k) || [])) { a.pairs++; if (mine > hold) a.beat++; }
      let pend = g.pendingNulls.get(k);
      if (!pend) { pend = []; g.pendingNulls.set(k, pend); }
      pend.push(hold);
    }
    return true;
  });

  // The pairing scratch is the expensive part and it is done with: what leaves
  // this function is one entry per configuration carrying ITS SCORE ON EACH
  // COIN (owner order, 2026-08-25: "we need to add the per-coin score"). The
  // whole-configuration figures are derived from these at reading time, so the
  // two views can never disagree — there is one set of counts, sliced twice.
  return {
    v: 4,
    builtAt: new Date().toISOString(),
    tagged,
    dropped,
    rowsSeen,
    groups: [...groups.values()].map((g) => ({
      label: g.label,
      vsLCount: g.vsLCount,
      vsLPos: g.vsLPos,
      realsTotal: g.realsTotal,
      assets: Object.fromEntries(g.assets),
    })),
  };
}
const TALLY_V = 4;
// The record index (which blocks hold each coin's rows) exists from v3 on —
// the records button keeps answering from a v3 save while the v4 averages
// rebuild in the background.
const SPANS_FROM_V = 3;

// From a tally to the rows the screen shows: widths joined in from the CURRENT
// leader rows (they sharpen while a run goes, so they are never baked into a
// saved tally), then the standing order — measured null, plateau width, share
// of assets, money last (QC-7, QC-142).
function renderScored(totals, leaders) {
  const regions = regionsByAsset(leaders || []);
  const scored = totals.groups.map((g) => {
    // v2 carries the per-coin counts and the whole-configuration figures are
    // SUMS of them — one set of counts, sliced twice, so the two views cannot
    // disagree. A v1 save (from before the per-coin score) still renders this
    // table from its stored group figures until its background rebuild lands.
    const perAsset = g.assets
      ? Object.entries(g.assets)
      : Object.entries(g.assetRows || {}).map(([k, n]) => [k, { n }]);
    let regionSum = 0;
    let regionN = 0;
    let holdCount = 0; let pos = 0; let sum = 0; let nullBeat = 0; let nullPairs = 0;
    for (const [k, a] of perAsset) {
      const reg = regions.get(k);
      if (reg != null) { regionSum += reg * a.n; regionN += a.n; }
      holdCount += a.hold || 0; pos += a.pos || 0; sum += a.sum || 0;
      nullBeat += a.beat || 0; nullPairs += a.pairs || 0;
    }
    if (!g.assets) {
      holdCount = g.holdCount; pos = g.pos; sum = g.sum;
      nullBeat = g.nullBeat; nullPairs = g.nullPairs;
    }
    return {
      label: g.label,
      assets: perAsset.length,
      holdCount,
      pos,
      vsLCount: g.vsLCount,
      vsLPos: g.vsLPos,
      sum,
      region: regionN ? Math.round(regionSum / regionN) : null,
      nullBeat,
      nullPairs,
      nullShare: nullPairs ? nullBeat / nullPairs : null,
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

// ONE PARSED TALLY IN HAND (owner order, 2026-08-26: "do the totals cache").
// The saved tally for the owner's run carries 235,620 per-coin entries, and
// every ask of the table, the coin view or a records button parsed that file
// again on the answering thread — most of the 820 ms measured on the box.
// ONE slot, not a map: a parsed tally of that size is real heap beside a
// 1.8 GB ceiling, and the screens work one run at a time. The slot serves
// only while the file's stamp AND size still match; a write from anywhere —
// this thread or the build worker — changes them, and the next ask re-reads.
// NOTHING MAY WRITE INTO THE SERVED OBJECT: it is handed to every caller,
// so every reader derives and none mutates (they all already do).
let totalsInHand = null;   // { runId, mtimeMs, size, totals }

function readTotals(runId) {
  let st;
  try { st = fs.statSync(totalsFile(runId)); } catch (_) {
    if (totalsInHand && totalsInHand.runId === runId) totalsInHand = null;
    return null;
  }
  if (totalsInHand && totalsInHand.runId === runId
    && totalsInHand.mtimeMs === st.mtimeMs && totalsInHand.size === st.size) {
    return totalsInHand.totals;
  }
  try {
    const totals = JSON.parse(fs.readFileSync(totalsFile(runId), 'utf8'));
    // The stamp was taken BEFORE the read: if the file was replaced between
    // the two, the mismatch surfaces on the next ask and costs one re-parse
    // in the safe direction — stale is never served as current.
    totalsInHand = { runId, mtimeMs: st.mtimeMs, size: st.size, totals };
    return totals;
  } catch (_) { return null; }
}

function writeTotals(runId, totals) {
  const f = totalsFile(runId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(totals));
  fs.renameSync(tmp, f);
  // The writer already holds the parsed object — hand it to the slot so the
  // next ask does not pay to re-read what this thread just wrote.
  try {
    const st = fs.statSync(f);
    totalsInHand = { runId, mtimeMs: st.mtimeMs, size: st.size, totals };
  } catch (_) { totalsInHand = null; }
}

// The full pass, streamed from the store. Run this in a worker thread, never
// on the answering thread — that is the whole point of this file's change.
function buildAndSaveTotals(runId, onProgress) {
  let n = 0;
  const totals = tallyOver((fn) => rowstore.each(runId, 'replication', (r, at) => {
    n++;
    if (onProgress && n % 1000000 === 0) onProgress(n);
    return fn(r, at);
  }));
  // ROW positions become BLOCK positions before the tally is saved. The block
  // is the unit a reader can actually fetch, and a coin's rows land in a
  // handful of them — where a list of every real row's position would put
  // millions of numbers in a file that is read back on every open.
  const blocks = rowstore.blocksOf(runId, 'replication');
  const starts = blocks ? blocks.map((b) => b.firstRow) : null;
  const blockOfRow = (at) => {
    let lo = 0; let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= at) lo = mid; else hi = mid - 1; }
    return lo;
  };
  for (const g of totals.groups) {
    for (const a of Object.values(g.assets || {})) {
      if (!Array.isArray(a.at)) continue;
      if (starts && starts.length) a.b = [...new Set(a.at.map(blockOfRow))].sort((x, y) => x - y);
      delete a.at;
    }
  }
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

// EVERY COIN OF EVERY CONFIGURATION, ONE ROW EACH, over the whole data set
// (owner order, 2026-08-25: "somehow it needs to be easily viewable and
// sortable FROM THE ENTIRE DATA SET"). The whole-configuration table hides a
// one-coin winner inside its average; this view un-hides it. The rows come
// from the same saved tally as the table above — one set of counts, sliced
// twice — flattened to (configuration, coin), SORTED WHOLE (an ordering is a
// claim and it is made over everything, never over a page), then paged.
//
// The default order leads on the share of head-to-heads won, with more
// comparisons winning ties — and the comparisons column travels with every
// row, because a 10-of-10 built on ten comparisons is luck wearing a score.
// `minPairs` narrows to rows with at least that many comparisons; it defaults
// to zero so nothing is hidden unless the reader asks, and the reply says how
// many rows the narrowing removed.
const COIN_SORTS = ['share', 'pairs', 'money', 'vslong', 'coin', 'configuration'];

function coinsFrom(totals, { sort = 'share', minPairs = 0, ...query } = {}) {
  const key = COIN_SORTS.includes(String(sort)) ? String(sort) : 'share';
  const atLeast = Math.max(0, Math.floor(Number(minPairs) || 0));
  const rows = [];
  for (const g of totals.groups) {
    for (const [k, a] of Object.entries(g.assets || {})) {
      const [trade, ctx1, ctx2, geometry] = k.split('|');
      rows.push({
        label: g.label,
        trade, ctx1, ctx2, geometry,
        rows: a.n,
        holdCount: a.hold || 0,
        pos: a.pos || 0,
        sum: a.sum || 0,
        // PER-ROW AVERAGES, not sums (owner order, 2026-08-25: "change the
        // held-back column to avg held-back so we're dividing by 16 or 8 and
        // the info becomes useful. show also the avg trades"). The divisor is
        // the rows that recorded a held-back number — every row, on a
        // finished run — so a coin with 16 rows and one with 8 read alike.
        avgHold: a.hold ? (a.sum || 0) / a.hold : null,
        avgTrades: a.hold ? (a.t || 0) / a.hold : null,
        // Against just holding the coin, averaged over the rows that
        // recorded the comparison (owner order, 2026-08-26). Positive means
        // the configuration beat holding on this coin, on average.
        avgVsLong: a.vln ? (a.vl || 0) / a.vln : null,
        beat: a.beat || 0,
        pairs: a.pairs || 0,
        share: a.pairs ? a.beat / a.pairs : null,
      });
    }
  }
  // ONE configuration's coins, when asked by name (owner order, 2026-08-26:
  // the ranked list's open line now serves per-coin summaries from this same
  // saved tally, instead of walking every recorded row — a walk that died at
  // the web server's time limit and froze every page while it lasted).
  const only = query.label != null && String(query.label) !== '' ? String(query.label) : null;
  const scoped = only ? rows.filter((r) => r.label === only) : rows;
  // FOUR MORE FLOORS (owner order, 2026-08-26): least share of head-to-heads
  // won (as the percent the column shows), least avg held-back, least avg
  // trades, least avg vs always-long. An empty floor removes nothing; a set
  // floor also removes rows that never recorded that number — a row with no
  // measurement cannot clear a bar, and keeping it would smuggle unmeasured
  // rows through every filter.
  const bar = (v) => {
    if (v == null || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const minShare = bar(query.minShare);
  const minHold = bar(query.minHold);
  const minTrades = bar(query.minTrades);
  const minVsLong = bar(query.minVsLong);
  const clears = (r) => (atLeast ? r.pairs >= atLeast : true)
    && (minShare == null || (r.share != null && r.share * 100 >= minShare))
    && (minHold == null || (r.avgHold != null && r.avgHold >= minHold))
    && (minTrades == null || (r.avgTrades != null && r.avgTrades >= minTrades))
    && (minVsLong == null || (r.avgVsLong != null && r.avgVsLong >= minVsLong));
  const kept = scoped.filter(clears);
  const byShare = (a, b) => (a.share == null && b.share == null ? 0
    : b.share == null ? -1 : a.share == null ? 1 : b.share - a.share);
  const byAvg = (a, b) => (b.avgHold ?? -Infinity) - (a.avgHold ?? -Infinity);
  const byVsL = (a, b) => (b.avgVsLong ?? -Infinity) - (a.avgVsLong ?? -Infinity);
  const orders = {
    share: (a, b) => byShare(a, b) || b.pairs - a.pairs || byAvg(a, b),
    pairs: (a, b) => b.pairs - a.pairs || byShare(a, b),
    money: (a, b) => byAvg(a, b) || byShare(a, b),
    vslong: (a, b) => byVsL(a, b) || byShare(a, b),
    coin: (a, b) => a.trade.localeCompare(b.trade) || byShare(a, b),
    configuration: (a, b) => a.label.localeCompare(b.label) || a.trade.localeCompare(b.trade),
  };
  kept.sort(orders[key]);
  const win = payload.page(kept, query);
  return {
    sort: key,
    minPairs: atLeast,
    ...(only ? { label: only } : {}),
    ...(minShare != null ? { minShare } : {}),
    ...(minHold != null ? { minHold } : {}),
    ...(minTrades != null ? { minTrades } : {}),
    ...(minVsLong != null ? { minVsLong } : {}),
    narrowedOut: scoped.length - kept.length,
    rows: win.rows,
    page: { offset: win.offset, limit: win.limit, total: win.total, shown: win.shown, more: win.more },
  };
}

// The endpoint's shape mirrors rank(): fresh serves instantly, anything else
// reports the background build. A save from before the per-coin score (v1)
// can draw the table above but not this view, so it counts as behind HERE and
// a rebuild starts; the table above keeps serving from it meanwhile.
function coins(doc, query = {}) {
  if (!rowstore.exists(doc.id, 'replication')) {
    const t = tallyOver((fn) => { for (const r of (doc.replication || [])) if (fn(r) === false) return; });
    return { ...coinsFrom(t, query), total: t.rowsSeen, totals: { upToDate: true, asOfRows: t.rowsSeen, builtAt: t.builtAt } };
  }
  const rows = rowstore.count(doc.id, 'replication');
  const saved = readTotals(doc.id);
  if (saved && saved.v === TALLY_V && saved.rowsSeen === rows) {
    return { ...coinsFrom(saved, query), total: rows, totals: { upToDate: true, asOfRows: rows, builtAt: saved.builtAt } };
  }
  const running = doc.status === 'running';
  const usable = saved && saved.v === TALLY_V ? saved : null;
  const savedAgeMs = usable ? Date.now() - new Date(usable.builtAt).getTime() : Infinity;
  const wantBuild = !usable || !running || savedAgeMs > 15 * 60 * 1000;
  const state = wantBuild ? startTotals(doc.id) : (builds.get(doc.id) || null);
  const buildingMeta = {
    building: !!(state && !state.error),
    scanned: state ? state.scanned : 0,
    of: rows,
    ...(state && state.error ? { buildError: `the totalling stopped: ${state.error}` } : {}),
  };
  if (usable) {
    return { ...coinsFrom(usable, query), total: rows, totals: { upToDate: false, asOfRows: usable.rowsSeen, builtAt: usable.builtAt }, ...buildingMeta };
  }
  return { ...buildingMeta, sort: 'share', minPairs: 0, narrowedOut: 0, total: rows, rows: [], page: { offset: 0, limit: 0, total: 0, shown: 0, more: false } };
}

// THE RECORDS BEHIND ONE COIN ROW (owner order, 2026-08-25: "allow an
// open-records-below arrow that expands to the detail records (either 8 or 16
// in this case)"). NEVER a walk over the whole store — that walk is ten
// minutes on the one thread that answers every page, and freezing the site to
// show sixteen rows is the exact fault this file exists to prevent. The saved
// tally carries, per coin, WHICH blocks of the store hold its real rows; only
// those blocks are unpacked, and everything else on disk stays untouched.
function coinRows(doc, { label = '', trade = '', ctx1 = '', ctx2 = '', geometry = '' } = {}) {
  const k = `${trade}|${ctx1 || ''}|${ctx2 || ''}|${geometry}`;
  const wanted = (r) => (r.declaredLabel || 'declared config') === label && assetKey(r) === k;
  const pack = (rows, extra) => ({ label, coin: { trade, ctx1, ctx2, geometry }, rows, shown: rows.length, ...extra });

  // A run recorded before the rows moved to disk: small by construction, so
  // it is read here and now — under the tally's own untagged rule (the first
  // recorded row per coin is the real one).
  if (!rowstore.exists(doc.id, 'replication')) {
    let tagged = false;
    for (const r of (doc.replication || [])) if ('nullDealSeed' in r) { tagged = true; break; }
    const out = [];
    for (const r of (doc.replication || [])) {
      if (!wanted(r)) continue;
      if (tagged ? r.nullDealSeed != null : out.length > 0) continue;
      out.push(r);
    }
    return pack(out, { indexed: true });
  }

  const saved = readTotals(doc.id);
  if (!saved || !(saved.v >= SPANS_FROM_V)) {
    return pack([], { indexed: false, why: 'the saved totals predate the per-coin record index — the fresh totalling now going brings it' });
  }
  const g = (saved.groups || []).find((x) => x.label === label);
  const a = g && g.assets ? g.assets[k] : null;
  if (!a) return pack([], { indexed: true });
  if (!Array.isArray(a.b) || !a.b.length) {
    return pack([], { indexed: false, why: 'this run\'s rows are stored in a form the record index does not cover' });
  }
  // The named blocks, exactly — one sidecar read, one byte-range read each.
  // Going through page() re-parsed the whole sidecar once per block, and
  // sixteen records cost three seconds of the answering thread (measured on
  // the box, 2026-08-26).
  const got = rowstore.readBlocks(doc.id, 'replication', a.b);
  if (!got) {
    return pack([], { indexed: false, why: 'this run\'s rows are stored in a form the record index does not cover' });
  }
  const out = [];
  const ats = [];
  for (const e of got) {
    const r = e.row;
    if (!wanted(r)) continue;
    if (saved.tagged ? r.nullDealSeed != null : out.length >= (a.n || 1)) continue;
    out.push(r);
    ats.push(e.at);
  }

  // THE CHOICES ON EVERY RECORD (owner order, 2026-08-26: "you need to
  // record that information for each row. i'm sure it can be recovered").
  // Rows written from 2026-08-26 carry them; older rows are named from the
  // recovered spans (lib/choices.js — the run's own census records, matched
  // in the order both were written). No sidecar yet means the recovery is
  // kicked here, in the background, and this answer says so.
  let namesFrom = null;
  let recovery = null;
  if (out.length) {
    if (out.every((r) => r.decision != null)) {
      namesFrom = 'rows';
    } else {
      const choices = require('./choices');
      const units = choices.readUnits(doc.id);
      if (units) {
        let filled = 0;
        out.forEach((r, i) => {
          if (r.decision != null) return;
          const s = choices.namesAt(units, ats[i]);
          if (s && (s.d != null || s.b != null || s.w != null)) {
            r.decision = s.d;
            r.bandMode = s.b;
            r.weekdaysOnly = s.w;
            if (r.key == null && s.k != null) r.key = s.k;
            filled++;
          }
        });
        if (filled) namesFrom = 'recovered';
      } else if (rowstore.exists(doc.id, 'census')) {
        const st = choices.startUnits(doc.id);
        recovery = {
          going: !!(st && !st.error),
          scanned: st ? st.scanned : 0,
          of: saved.rowsSeen || 0,
          ...(st && st.error ? { error: `the recovery stopped: ${st.error}` } : {}),
        };
      }
    }
  }
  const unnamedRecords = out.filter((r) => r.decision == null).length;
  return pack(out, { indexed: true, namesFrom, unnamedRecords, ...(recovery ? { recovery } : {}) });
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

// detail() — the per-configuration row walk — is RETIRED (owner go,
// 2026-08-26). It walked every recorded row on the answering thread for
// each opened line; on the owner's run that walk outlived the web server's
// time limit and froze every page while it lasted. The line's table is now
// per-coin summaries from the saved tally (coins() with a label), and the
// rows themselves come one coin at a time through coinRows(), block-exact.

module.exports = { rank, coins, coinsFrom, coinRows, assetKey, tallyOver, renderScored, buildAndSaveTotals, startTotals, readTotals, writeTotals, totalsFile, TALLY_V, SPANS_FROM_V, COIN_SORTS };
