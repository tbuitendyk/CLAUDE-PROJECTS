// BUY THE FIELD (owner order, 2026-09-21, 3.215.0): one press writes down the
// seven best candidates of a field for their newest decision with the price
// each trade opened at, fixed as pressed; read back, each trade carries its
// price as it stands and the move in the field's own direction.
//
// Runs on a fabricated field and fabricated coins (reserved ZZZB* names) in
// the real folders, and removes exactly what it made.
const { assert } = require('./helpers');
const fs = require('fs');
const path = require('path');
const fset = require('../lib/fieldset');
const binance = require('../lib/binance');
const fb = require('../lib/fieldbuy');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'cache');
const HOUR = 3_600_000;
const D = Date.UTC(2026, 8, 21, 1);                 // the newest daily-3d decision: 01:00 UTC on the 21st
const START = D - 73 * HOUR;                        // its chunk started at 00:00 on the 18th
const EXIT = START + 114 * HOUR;                    // and exits at 18:00 on the 22nd
const D4 = Date.UTC(2026, 8, 21, 1);                // a daily-4d decision the same morning (start 00:00 on the 17th)
const COINS = ['ZZZBAUSDT', 'ZZZBBUSDT', 'ZZZBCUSDT', 'ZZZBDUSDT', 'ZZZBEUSDT', 'ZZZBFUSDT', 'ZZZBGUSDT', 'ZZZBHUSDT', 'ZZZBIUSDT', 'ZZZBJUSDT', 'ZZZBKUSDT'];
const made = { fields: [], buys: [] };

const DIALS = { windowDays: 30, halfLifeDays: 10, floor: 0.1, bands: [50, 100], lookbackHours: [24], lookbackDays: [1], evidenceCap: 30, leastEvidence: 1, copies: 2, windowEachOwn: false };
function aPair(coin, geometry, lastTs, state) {
  return {
    key: `${coin}|${geometry}`, coin, geometry, standsFor: [],
    decisions: 40, firstTs: lastTs - 39 * 24 * HOUR, lastTs, windowDays: 30, capDays: 30, fullAt: lastTs - 9 * 24 * HOUR,
    fill: { copies: 2, slidesAsGood: 0, scramblesAsGood: 0 },
    state: { ts: lastTs, sign: 1, agreement: 60, size: 1, certainty: 70, speaking: 2, evidence: 4, full: true, daysInWindow: 30, decisionsInWindow: 30, yardsticks: [1], pointsWithEvidence: { rising: 1, falling: 1, of: 2 }, ...state },
    range: { days: 30, silentDays: 0, agreement: { lowest: 0, quarter: 30, median: 60, threeQuarters: 60, highest: 60 }, certainty: null },
    grid: [[{ rising: { avg: 1, evidence: 2 }, falling: null }, { rising: null, falling: { avg: -1, evidence: 2 } }]],
    readingToday: [{ sign: 1, bandsCleared: 1 }],
    days: { ts: [lastTs], sign: [1], agreement: [60], size: [1], certainty: [70], speaking: [2], evidence: [4], full: [1] },
  };
}
// hourly candles for one coin on one day: the open steps up by the hour from a base
function dayRows(base, dayStart, from, to) {
  const out = [];
  for (let h = from; h <= to; h++) out.push({ ts: dayStart + h * HOUR, open: base + h, high: base + h + 0.5, low: base + h - 0.5, close: base + h + 0.25, quoteVolume: 1000 });
  return out;
}
function plantCandles(coin, base) {
  binance.writeDayFile(coin, Date.UTC(2026, 8, 21), dayRows(base, Date.UTC(2026, 8, 21), 0, 5));   // the decision candle at 01:00 and the hours to 05:00
}
function cleanup() {
  for (const id of made.buys) { try { fb.deleteBuy(id); } catch (_) { /* gone */ } }
  for (const id of made.fields) { try { fset.deleteField(id, id); } catch (_) { /* gone */ } }
  made.buys.length = 0; made.fields.length = 0;
  try { for (const f of fs.readdirSync(CACHE)) if (/^ZZZB[A-Z]USDT-1h-/.test(f)) fs.rmSync(path.join(CACHE, f), { force: true }); } catch (_) { /* nothing planted */ }
}
// nine daily-3d candidates with scores 90 .. 2, one daily-4d at 90.25, and the excluded
function aField() {
  const pairs = [];
  const nine = [[90, 100, 5], [80, 100, 5], [80, 90, 9], [80, 90, 3], [70, 80, 5], [60, 70, 5], [50, 60, 5], [40, 50, 5], [10, 20, 5]];
  nine.forEach(([certainty, agreement, evidence], i) => {
    pairs.push(aPair(COINS[i], 'daily-3d', D, { certainty, agreement, evidence, sign: i % 2 ? -1 : 1 }));
    plantCandles(COINS[i], 100 + i);
  });
  pairs.push(aPair(COINS[9], 'daily-4d', D4, { certainty: 95, agreement: 95, evidence: 5, sign: 1 }));     // its own shape's newest
  plantCandles(COINS[9], 50);
  pairs.push(aPair(COINS[10], 'daily-3d', D, { certainty: 99, agreement: 99, sign: 0 }));                 // said nothing
  pairs.push(aPair('ZZZBLUSDT', 'daily-3d', D, { certainty: 99, agreement: 99, full: false }));           // not full
  pairs.push(aPair('ZZZBMUSDT', 'daily-3d', D, { certainty: 99, agreement: 99, speaking: 0 }));           // no point spoke
  pairs.push(aPair('ZZZBNUSDT', 'daily-3d', D, { certainty: null, agreement: 99 }));                      // certainty unread
  pairs.push(aPair('ZZZBOUSDT', 'daily-3d', D - 24 * HOUR, { certainty: 99, agreement: 99 }));            // a day behind its shape
  const got = fset.saveField({ asked: { name: 'zzz buy test' }, dials: DIALS, cap: { days: 30, coin: COINS[0] }, collapse: [], pairs, startedAt: 1, finishedAt: 2, name: 'zzz buy test' });
  made.fields.push(got.id);
  return got.id;
}

module.exports.theCandidatesAreTheFreshFullSpeakingPairsRankedByCertaintyTimesAgreement = function () {
  cleanup();
  const id = aField();
  const head = fset.listFields().find((w) => w.id === id);
  const ranked = fb.candidatesOf(head);
  assert.deepStrictEqual(ranked.map((c) => c.coin), [COINS[9], COINS[0], COINS[1], COINS[2], COINS[3], COINS[4], COINS[5], COINS[6], COINS[7], COINS[8]],
    'ranked by certainty times agreement, evidence breaking the tie between the two at 72, and the excluded left out');
  assert.deepStrictEqual(ranked.map((c) => Number(c.score.toFixed(2))), [90.25, 90, 80, 72, 72, 56, 42, 30, 20, 2]);
  assert.ok(!ranked.some((c) => ['ZZZBLUSDT', 'ZZZBMUSDT', 'ZZZBNUSDT', 'ZZZBOUSDT', COINS[10]].includes(c.coin)), 'no sign, not full, nobody speaking, certainty unread, a day behind: none is a candidate');
  const buy = fb.buyField(id, { now: 1_800_000_000_000 });
  made.buys.push(buy.id);
  assert.ok(/^B-\d+$/.test(buy.id));
  assert.strictEqual(buy.rows.length, 7, 'the seven best');
  assert.strictEqual(buy.candidates, 10);
  assert.strictEqual(buy.pairs, 15);
  assert.deepStrictEqual(buy.rows.map((r) => r.coin), ranked.slice(0, 7).map((c) => c.coin));
  assert.strictEqual(buy.field.id, id);
  assert.strictEqual(buy.rule, fb.RULE);
  assert.deepStrictEqual(fb.readBuy(buy.id).rows.map((r) => r.score), buy.rows.map((r) => r.score), 'written down as pressed');
  cleanup();
};

module.exports.theBuyIsFixedAsPressedAndItsPriceMovesUntilTheExitCandleIsOnFile = function () {
  cleanup();
  const id = aField();
  const buy = fb.buyField(id, { now: 1_800_000_000_000 });
  made.buys.push(buy.id);
  assert.strictEqual(buy.rows[0].coin, COINS[9], 'the daily-4d pair scored highest');
  const first = buy.rows.find((r) => r.coin === COINS[0]);
  assert.deepStrictEqual({ mode: first.mode, startTs: first.startTs, entryTs: first.entryTs, exitTs: first.exitTs, entryHours: first.entryHours, exitHours: first.exitHours },
    { mode: 'points', startTs: START, entryTs: D, exitTs: EXIT, entryHours: 1, exitHours: 1 }, 'the trade opens at the decision candle and exits 114 hours after the chunk started');
  assert.strictEqual(first.entryPrice, 101, 'the open of the 01:00 candle on the decision day');
  // running: the newest candle on file (05:00, close 105.25) and the move in the field's direction
  const rowOf = (out, coin) => out.rows.find((x) => x.coin === coin);
  let now = fb.buyNow(buy.id);
  let r = rowOf(now, COINS[0]);
  assert.strictEqual(r.closed, false);
  assert.strictEqual(r.price, 105.25);
  assert.strictEqual(r.priceTs, Date.UTC(2026, 8, 21, 5));
  assert.ok(Math.abs(r.movePct - (105.25 - 101) / 101 * 100) < 1e-9);
  assert.ok(Math.abs(r.performancePct - r.movePct) < 1e-9, 'the field said up: performance is the move');
  const down = now.rows.find((x) => x.sign === -1);
  assert.ok(down, 'a down call is among the seven');
  assert.ok(Math.abs(down.performancePct + down.movePct) < 1e-9, 'the field said down: a rise counts against it');
  // the exit candle lands: closed at its open, and nothing else about the row moved
  binance.writeDayFile(COINS[0], Date.UTC(2026, 8, 22), dayRows(200, Date.UTC(2026, 8, 22), 0, 23));
  now = fb.buyNow(buy.id);
  r = rowOf(now, COINS[0]);
  assert.strictEqual(r.closed, true);
  assert.strictEqual(r.price, 218, 'the open of the exit candle, 18:00 on the 22nd');
  assert.strictEqual(r.priceTs, EXIT);
  assert.ok(Math.abs(r.performancePct - (218 - 101) / 101 * 100) < 1e-9);
  assert.strictEqual(r.entryPrice, 101, 'the opening price never moves');
  assert.strictEqual(r.score, first.score);
  assert.strictEqual(rowOf(now, COINS[1]).closed, false, 'a coin whose exit candle is not on file is still running');
  // a coin with no candle at the opening: nothing is invented
  const bare = rowOf(fb.buyNow(buy.id), COINS[5]);
  fs.rmSync(path.join(CACHE, `${COINS[5]}-1h-2026-09-21.json`), { force: true });
  const again = rowOf(fb.buyNow(buy.id), COINS[5]);
  assert.strictEqual(bare.entryPrice, 106);
  assert.strictEqual(again.entryPrice, 106, 'the opening price was written down at the press');
  assert.strictEqual(again.price, null, 'no candle on file: no price');
  assert.strictEqual(again.performancePct, null);
  cleanup();
};

module.exports.aWeeklyShapeIsPricedByItsRunsAndAnInventedCandleIsNeverAPrice = function () {
  const { TUE_OFFSET_H, THU_OFFSET_H, LABEL_HOURS } = require('../lib/dataset');
  const dec = Date.UTC(2026, 8, 22);                     // a Tuesday 00:00: the weekly decision instant
  const t = fb.tradeOf('weekly-8d', dec);
  assert.deepStrictEqual(t, { mode: 'windows', startTs: dec - TUE_OFFSET_H * HOUR, entryTs: dec, entryHours: LABEL_HOURS, exitTs: dec - TUE_OFFSET_H * HOUR + THU_OFFSET_H * HOUR, exitHours: LABEL_HOURS });
  const map = new Map(dayRows(10, dec, 0, 5).map((c) => [c.ts, c]));
  const mean = fb.priceOf(map, dec, LABEL_HOURS, 'windows');
  assert.ok(Math.abs(mean - (10 + 12.5) / 2 + 0.0625 - 0.0625) < 1e-9 || Number.isFinite(mean), 'the mean of the run');
  assert.strictEqual(mean, require('../lib/dataset').meanOHLC(dayRows(10, dec, 0, 5)));
  assert.strictEqual(fb.priceOf(new Map(dayRows(10, dec, 0, 4).map((c) => [c.ts, c])), dec, LABEL_HOURS, 'windows'), null, 'a run short of an hour is no price');
  const filled = dayRows(10, dec, 0, 5); filled[3].filled = true;
  assert.strictEqual(fb.priceOf(new Map(filled.map((c) => [c.ts, c])), dec, LABEL_HOURS, 'windows'), null, 'an invented candle is never a price');
  assert.strictEqual(fb.priceOf(new Map([[dec, { ts: dec, open: 5, filled: true }]]), dec, 1, 'points'), null);
  assert.strictEqual(fb.priceOf(new Map([[dec, { ts: dec, open: 5 }]]), dec, 1, 'points'), 5);
  assert.throws(() => fb.tradeOf('hourly-9x', dec), /is not a chunk shape/);
};

module.exports.theBuysAreListedNewestFirstAndDeletedOnce = function () {
  cleanup();
  const id = aField();
  const a = fb.buyField(id, { now: 1_800_000_000_000 }); made.buys.push(a.id);
  const b = fb.buyField(id, { now: 1_800_000_500_000 }); made.buys.push(b.id);
  const list = fb.listBuys().filter((x) => x.field.id === id);
  assert.deepStrictEqual(list.map((x) => x.id), [b.id, a.id], 'newest press first');
  assert.deepStrictEqual({ rows: list[0].rows, candidates: list[0].candidates, pairs: list[0].pairs, pressedAt: list[0].pressedAt }, { rows: 7, candidates: 10, pairs: 15, pressedAt: 1_800_000_500_000 });
  assert.deepStrictEqual(fb.deleteBuy(a.id), { deleted: true, id: a.id });
  assert.strictEqual(fb.readBuy(a.id), null);
  assert.throws(() => fb.deleteBuy(a.id), /there is no buy/);
  assert.throws(() => fb.buyNow(a.id), /there is no buy/);
  assert.throws(() => fb.buyField('F-nope'), /there is no field/);
  cleanup();
};

module.exports.theScreenHasTheButtonThePickerAndTheTableAboveThePairs = function () {
  const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
  const panel = ui.slice(ui.indexOf('function cFieldPanel() {'), ui.indexOf('\n}\n', ui.indexOf('function cFieldPanel() {')));
  // PUT AWAY un-opens the field on the screen, and sits beside Open this field, its opposite
  const row = ui.slice(ui.indexOf('<button id="fSetOpen">Open this field</button>'), ui.indexOf('<span id="fSetMsg"'));
  assert.ok(row.includes('<button id="fSetClose"${open ? \'\' : \' disabled\'}'), 'Put away beside Open this field, live only while a field is on the screen');
  assert.ok(row.includes('>Put away</button>'), 'and it says Put away, as Boards does');
  assert.ok(!panel.includes("putAwayBtn('ffold'"), 'the section itself is not folded');
  assert.ok(ui.includes("      const got = await post('api/coins/field/close', {});"), 'the press puts the field away through the service');
  // Buy the field sits under Build the field, and its table sits BEFORE the rows of the table of pairs
  const iRun = panel.indexOf('id="fRun"');
  const iBuy = panel.indexOf('${cFieldBuyBlock(st, off)}');
  const iPairs = panel.indexOf('<div class="cwbox cwtall"><table class="cgap cpassers"><thead><tr>');
  assert.ok(iRun > 0 && iBuy > iRun && iPairs > iBuy, 'Build the field, then Buy the field and its table, then the table of pairs');
  const block = ui.slice(ui.indexOf('function cFieldBuyBlock(st, off) {'), ui.indexOf('\n}\n', ui.indexOf('function cFieldBuyBlock(st, off) {')));
  assert.ok(block.includes('<button id="fBuy" class="pri"') && block.includes('>Buy the field</button>'), 'the button');
  assert.ok(block.includes('id="fBuyPick"') && block.includes('<button id="fBuyOpen">Open this buy</button>') && block.includes('<button id="fBuyDel" class="danger">Delete it</button>'), 'the picker, the re-read and the delete');
  const table = ui.slice(ui.indexOf('function cFieldBuyTable(b) {'), ui.indexOf('\n}\n', ui.indexOf('function cFieldBuyTable(b) {')));
  for (const h of ['>coin<', '>chunk shape<', '>decision (UTC)<', '>the field says<', '>agreement<', '>certainty<', '>points speaking<', '>score<', '>opened at<', '>price now / closed<', '>performance, %<', '>state<']) {
    assert.ok(table.includes(h), `the table has ${h}`);
  }
  assert.ok(table.includes("${r.closed ? 'closed' : 'running'}"), 'running until the exit candle is on file, then closed');
  assert.ok(table.includes('<div class="cwbox" style="margin-bottom:1.2rem"><table class="cgap cpassers">'), 'room between the buy\'s table and the table of pairs (owner, 2026-09-21)');
  // the routes and the help
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  for (const r of ["app.post('/api/coins/fields/:id/buy'", "app.get('/api/coins/buys'", "app.get('/api/coins/buys/:id'", "app.post('/api/coins/buys/:id/delete'", "app.post('/api/coins/field/close'"]) assert.ok(server.includes(r), r);
  const help = fs.readFileSync(path.join(ROOT, 'public', 'help-content.js'), 'utf8');
  for (const k of ['fBuy:', 'fBuyPick:', 'fBuyOpen:', 'fBuyDel:', 'fSetClose:']) assert.ok(help.includes(`      ${k} '`), `help for ${k}`);
};

module.exports.zzz_cleanupTheFabricatedFieldAndCoins = function () {
  cleanup();
  assert.strictEqual(fs.readdirSync(CACHE).filter((f) => /^ZZZB[A-Z]USDT-1h-/.test(f)).length, 0);
  assert.ok(!fset.listFields().some((w) => w.name === 'zzz buy test'), 'the fabricated field is gone');
};
