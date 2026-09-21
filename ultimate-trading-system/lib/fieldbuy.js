// BUY THE FIELD (owner order, 2026-09-21): "scans everything and presents the
// top seven candidates out of the entire field for the next decision ... the
// software will generate the table that includes the coin and the shape and
// the opening price at 01:00 UTC of decision day ... that information will
// be fixed with the exception of showing the performance mid run".
//
// One press reads every pair of the field named and writes down the seven
// best candidates on their newest decision -- the coin, the shape, the
// decision instant, what the field said there, and the price the trade opened
// at -- as a record that never changes. Read back, the record carries the
// trade's price as it stands: the newest candle on file until the exit candle
// is on file, the exit price from then on, and the move in the field's own
// direction as a percentage. "The point is just to get a quick fix on the
// potential accuracy of this history field gate training." Nothing here
// trades.
//
// THE RULE, written down before any number existed. A pair is a candidate
// when its field was full on its last day, said a direction, at least one
// point spoke, certainty could be read, and its last day is the newest any
// pair of its shape reaches. Candidates rank by certainty times agreement,
// each taken as a share, so the score runs 0 to 100; evidence breaks ties.
// Certainty carries the most because it is the one number that separates a
// signal from noise -- how the real field's pull ranked against its slid
// copies -- and agreement says how united that pull was.
//
// THE PRICES ARE THE LAB'S OWN. A trade is measured from the price the chunk
// builder measures from (lib/dataset.js, buildChunks): on a daily shape the
// open of the entry candle, which is 01:00 UTC on the decision day, to the
// open of the exit candle; on the weekly shape the mean of the Tuesday run to
// the mean of the Thursday run. An invented candle is never a price.
const fs = require('fs');
const path = require('path');
const binance = require('./binance');
const fset = require('./fieldset');
const { GEOMETRIES, TUE_OFFSET_H, THU_OFFSET_H, LABEL_HOURS, candleRun, meanOHLC } = require('./dataset');

const HOUR_MS = 3_600_000;
const DIR = path.join(fset.DIR, 'buys');
const V = 1;
const TAKE = 7;
const RULE = 'a pair is a candidate when its field was full on its last day, said a direction, at least one point spoke, certainty could be read, and its last day is the newest any pair of its shape reaches; candidates rank by certainty times agreement, each as a share (0 to 100), evidence breaking ties';

const clean = (id) => String(id == null ? '' : id).replace(/[^A-Za-z0-9_-]/g, '');
const file = (id) => path.join(DIR, `${clean(id)}.json`);
function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch (_) { /* already there */ } }
function idsOnDisk() {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch (_) { return []; }
  return names.filter((n) => /^B-\d+\.json$/.test(n)).map((n) => n.slice(0, -5))
    .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
}
function nextId() {
  const taken = new Set(idsOnDisk());
  for (let n = 1; ; n++) { const id = `B-${n}`; if (!taken.has(id)) return id; }
}

// WHEN THE TRADE OPENS AND CLOSES for a decision on a shape, and how each
// price is taken: one candle's open, or a run's mean on the weekly shape
function tradeOf(geometry, decisionTs) {
  const geo = GEOMETRIES[geometry];
  if (!geo) throw new Error(`"${geometry}" is not a chunk shape`);
  if (geo.labelMode === 'windows') {
    const startTs = decisionTs - TUE_OFFSET_H * HOUR_MS;
    return { mode: 'windows', startTs, entryTs: startTs + TUE_OFFSET_H * HOUR_MS, entryHours: LABEL_HOURS, exitTs: startTs + THU_OFFSET_H * HOUR_MS, exitHours: LABEL_HOURS };
  }
  const startTs = decisionTs - geo.entryOffsetH * HOUR_MS;
  return { mode: 'points', startTs, entryTs: startTs + geo.entryOffsetH * HOUR_MS, entryHours: 1, exitTs: startTs + geo.exitOffsetH * HOUR_MS, exitHours: 1 };
}
// the price the lab measures from or to, or null while the candles are not on file
function priceOf(map, ts, hours, mode) {
  if (mode === 'windows') {
    const run = candleRun(map, ts, hours);
    return run && run.every((c) => c && c.open > 0 && !c.filled) ? meanOHLC(run) : null;
  }
  const c = map.get(ts);
  return c && c.open > 0 && !c.filled ? c.open : null;
}
// the candles on file between two instants, as a map by hour -- read from the
// months on disk, never the network
function candlesBetween(symbol, fromTs, toTs) {
  const map = new Map();
  const a = new Date(fromTs); const b = new Date(toTs);
  let y = a.getUTCFullYear(); let m = a.getUTCMonth() + 1;
  const ey = b.getUTCFullYear(); const em = b.getUTCMonth() + 1;
  while (y < ey || (y === ey && m <= em)) {
    const rows = binance.monthRowsOnDisk(symbol, y, m) || [];
    for (const r of rows) if (r && r.ts >= fromTs && r.ts <= toTs) map.set(r.ts, r);
    m++; if (m > 12) { m = 1; y++; }
  }
  return map;
}

// EVERY CANDIDATE OF A FIELD, best first, under the rule above
function candidatesOf(head) {
  const briefs = (head.briefs || []).filter((b) => b && b.state && b.lastTs != null && !b.error);
  const newest = {};
  for (const b of briefs) newest[b.geometry] = Math.max(newest[b.geometry] || 0, b.lastTs);
  const out = [];
  for (const b of briefs) {
    const s = b.state;
    if (!s.full || !(s.sign === 1 || s.sign === -1) || !(s.speaking > 0) || s.certainty == null) continue;
    if (b.lastTs !== newest[b.geometry]) continue;
    out.push({
      key: b.key, coin: b.coin, geometry: b.geometry, standsFor: b.standsFor || [],
      decisionTs: b.lastTs, sign: s.sign, agreement: s.agreement, certainty: s.certainty,
      speaking: s.speaking, evidence: s.evidence,
      score: Number(s.certainty) * Number(s.agreement) / 100,
    });
  }
  out.sort((a, b) => (b.score - a.score) || (b.evidence - a.evidence) || a.coin.localeCompare(b.coin) || a.geometry.localeCompare(b.geometry));
  return out;
}

// THE PRESS: the seven, written down with the price each trade opened at
function buyField(fieldId, { now = Date.now(), take = TAKE } = {}) {
  const head = fset.listFields().find((w) => w.id === String(fieldId));
  if (!head) throw new Error(`there is no field ${JSON.stringify(String(fieldId))} on this box`);
  const ranked = candidatesOf(head);
  if (!ranked.length) throw new Error(`${head.id} has no candidate: no pair was full, said a direction and had a point speaking on its last day`);
  const rows = ranked.slice(0, take).map((c) => {
    const t = tradeOf(c.geometry, c.decisionTs);
    const map = candlesBetween(c.coin, t.entryTs - HOUR_MS, t.entryTs + (t.entryHours + 1) * HOUR_MS);
    return { ...c, ...t, entryPrice: priceOf(map, t.entryTs, t.entryHours, t.mode) };
  });
  ensureDir();
  // ONE FIELD, ONE TEST (owner, 2026-09-21: "once a field has been built and
  // the buy the field button has been used, it should be ghosted after
  // that"). A field's last day is fixed when it is built, so a second press
  // would say the same seven; it is refused in words, and a new day means a
  // new field. The seven of every field stay with their field.
  const had = buyOf(head.id);
  if (had) throw new Error(`${head.id} already has its seven, pressed ${new Date(had.pressedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC — a new day needs a refresh on Data and Build the field again`);
  const doc = {
    v: V, id: nextId(), field: { id: head.id, name: head.name || head.id }, pressedAt: now,
    rule: RULE, take, candidates: ranked.length, pairs: (head.briefs || []).length, rows,
  };
  fs.writeFileSync(file(doc.id), JSON.stringify(doc));
  return doc;
}
// the buy of one field, or null; and every buy of a field removed with the
// field itself
function buyOf(fieldId) {
  return listBuys().find((b) => b.field && b.field.id === String(fieldId)) || null;
}
function deleteBuysOf(fieldId) {
  let gone = 0;
  for (const id of idsOnDisk()) {
    const d = readBuy(id);
    if (d && d.field && d.field.id === String(fieldId)) { try { fs.unlinkSync(file(id)); gone++; } catch (_) { /* already gone */ } }
  }
  return gone;
}

function readBuy(id) {
  try {
    const doc = JSON.parse(fs.readFileSync(file(id), 'utf8'));
    return doc && doc.v === V ? doc : null;
  } catch (_) { return null; }
}
// every buy on the box, newest press first, without its rows
function listBuys() {
  const out = [];
  for (const id of idsOnDisk()) {
    const d = readBuy(id);
    if (!d) continue;
    out.push({ id: d.id, field: d.field, pressedAt: d.pressedAt, rows: (d.rows || []).length, candidates: d.candidates, pairs: d.pairs });
  }
  out.sort((a, b) => (b.pressedAt || 0) - (a.pressedAt || 0));
  return out;
}
function deleteBuy(id) {
  const doc = readBuy(id);
  if (!doc) throw new Error(`there is no buy ${JSON.stringify(String(id))} on this box`);
  try { fs.unlinkSync(file(id)); } catch (err) { throw new Error(`${doc.id} could not be removed: ${err.message}`); }
  return { deleted: true, id: doc.id };
}

// THE BUY AS IT STANDS: the record as pressed, and each trade's price so far.
// Until the closing candle is on file the price is the newest candle's close
// and the trade is running; the performance is the move in the field's own
// direction.
//
// CHECKED AND CLOSED (owner, 2026-09-21: "if there are still selections in a
// running state, they need to be checked and closed with the closing price,
// if the date of closing has passed"). A trade whose closing has passed --
// its closing candle has ended -- is closed at that candle's price. When the
// candle is not on file the hours since the last whole day are fetched for
// that coin, the way Refresh to latest fetches them (`fetchRecent`, handed
// in by the service, and withheld while a data job holds the cache). Once
// closed, the closing price is WRITTEN INTO THE RECORD and never read from
// the candles again, whatever happens to them on disk. A closing that has
// passed with no candle to be had reads so, never as running.
const HOLD_CLOSED = (r, price) => {
  const movePct = r.entryPrice > 0 && price != null ? (price - r.entryPrice) / r.entryPrice * 100 : null;
  return { ...r, closed: true, passed: true, price, priceTs: r.exitTs, movePct, performancePct: movePct == null ? null : movePct * r.sign };
};
async function buyNow(id, { now = Date.now(), fetchRecent = null } = {}) {
  const doc = readBuy(id);
  if (!doc) throw new Error(`there is no buy ${JSON.stringify(String(id))} on this box`);
  let changed = false;
  const rows = [];
  for (const r of (doc.rows || [])) {
    if (r.closedPrice != null) { rows.push(HOLD_CLOSED(r, r.closedPrice)); continue; }   // closed for good, as written down
    const passed = now >= r.exitTs + r.exitHours * HOUR_MS;
    const exitOn = () => priceOf(candlesBetween(r.coin, r.exitTs - HOUR_MS, r.exitTs + (r.exitHours + 1) * HOUR_MS), r.exitTs, r.exitHours, r.mode);
    let exitPrice = exitOn();
    if (exitPrice == null && passed && fetchRecent) {
      try { await fetchRecent(r.coin); } catch (_) { /* the newest on file stands, and the state says the closing has passed */ }
      exitPrice = exitOn();
    }
    if (exitPrice != null) {
      r.closedPrice = exitPrice; r.closedTs = r.exitTs; changed = true;
      rows.push(HOLD_CLOSED(r, exitPrice));
      continue;
    }
    const newest = binance.newestCandle(r.coin);
    const price = newest && newest.ts >= r.entryTs && newest.close > 0 ? newest.close : null;
    const priceTs = newest && newest.ts >= r.entryTs ? newest.ts : null;
    const movePct = r.entryPrice > 0 && price != null ? (price - r.entryPrice) / r.entryPrice * 100 : null;
    rows.push({ ...r, closed: false, passed, price, priceTs, movePct, performancePct: movePct == null ? null : movePct * r.sign });
  }
  if (changed) fs.writeFileSync(file(doc.id), JSON.stringify(doc));   // the closing prices, written down once
  return { ...doc, rows };
}

module.exports = { DIR, V, TAKE, RULE, tradeOf, priceOf, candlesBetween, candidatesOf, buyField, readBuy, listBuys, buyOf, deleteBuy, deleteBuysOf, buyNow };
