// Phase L2 ladder monitors: the live rung-watching state machine must mirror
// the simulator exactly — entries fire once per epoch, the exit ladder arms
// at the first entry against the fallen-from anchor and persists across new
// highs, a new ATH re-arms entries (announced only when an epoch was
// actually underway), DCA reminds monthly after seating, and repeated checks
// at the same price never re-fire. Plus CRUD, recipients validation, and the
// tick's notification dispatch through the (stubbed) mailer.
const { freshDb, ok, approx } = require('./helpers');
freshDb('laddermon');

const mailer = require('../lib/mailer');
const sent = [];
mailer.sendLadderNotice = async (mon, subject, text) => {
  sent.push({ monitorId: mon.id, subject, text });
  return { emailed: 1 };
};
const pricing = require('../lib/pricing');
let PRICE = 100_000;
pricing.fetchUsdPrices = async () => ({ bitcoin: PRICE });

const lm = require('../lib/laddermon');

const CFG = {
  entryStart: 20, entrySpacing: 20, entryCount: 4, buyFrac: 0.2,
  exitStart: 1.0, exitSpacing: 0.5, exitCount: 3, sellFrac: 0.2,
  reservePct: 0, dcaMonthlyPct: 2,
};
const T0 = 1_780_000_000_000;

(async () => {
  // ---- validation -----------------------------------------------------------
  let threw = false;
  try { lm.validateConfig({ ...CFG, buyFrac: 5 }); } catch { threw = true; }
  ok(threw, 'buyFrac > 1 rejected (fractions, not percent)');
  threw = false;
  try { lm.createMonitor({ name: 'x', config: CFG, anchor: -1 }); } catch { threw = true; }
  ok(threw, 'negative anchor rejected');
  threw = false;
  try { lm.createMonitor({ name: 'x', config: CFG, anchor: 100000, recipients: [{ email: 'not-an-email' }] }); } catch { threw = true; }
  ok(threw, 'bad recipient email rejected');

  // ---- CRUD -----------------------------------------------------------------
  const mon = lm.createMonitor({
    name: 'Aggressive ladder',
    config: CFG,
    anchor: 124_659,
    recipients: [{ email: 'a@b.co', telegram_chat_id: '123' }],
    pollMinutes: 15,
  });
  ok(mon.id > 0 && mon.anchor_ath === 124_659, `monitor created (id ${mon.id}, anchor ${mon.anchor_ath})`);
  ok(mon.recipients.length === 1 && mon.recipients[0].email === 'a@b.co', 'recipients stored');

  // ---- state machine: mid-drawdown first check ------------------------------
  // BTC at 64k vs 124.7k anchor = 48.7% down: rungs -20% and -40% fire, the
  // exit ladder arms against the anchor.
  let evs = await lm.checkMonitor(lm.getMonitor(mon.id), 64_000, T0);
  const types = evs.map((e) => e.type);
  ok(types.filter((t) => t === 'buy').length === 2, `mid-drawdown first check fires rungs 1+2 (${JSON.stringify(types)})`);
  ok(types.includes('sell-armed'), 'exit ladder armed at the first entry');
  ok(!types.includes('dca'), 'first check seats the DCA counter instead of firing a stale reminder');
  let m = lm.getMonitor(mon.id);
  ok(m.entries_fired.join(',') === '0,1', 'fired rungs persisted');
  ok(m.exit_levels.length === 3 && Math.round(m.exit_levels[0]) === 124_659, `exit levels anchored (${m.exit_levels.map((x) => Math.round(x)).join(', ')})`);

  // Same price again: nothing re-fires.
  evs = await lm.checkMonitor(lm.getMonitor(mon.id), 64_000, T0 + 60_000);
  ok(evs.length === 0, 'repeated check at the same price is silent');

  // Deeper: -60% rung fires once.
  evs = await lm.checkMonitor(lm.getMonitor(mon.id), 49_000, T0 + 120_000);
  ok(evs.length === 1 && evs[0].type === 'buy' && /rung 3/.test(evs[0].message), 'rung 3 fires once at -60%');

  // Recovery to the first exit level: sell rung 1 fires; price equals the
  // anchor so no re-anchor (must EXCEED to raise).
  evs = await lm.checkMonitor(lm.getMonitor(mon.id), 124_659, T0 + 180_000);
  ok(evs.length === 1 && evs[0].type === 'sell' && /SELL rung 1/.test(evs[0].message), 'exit rung 1 fires at the anchor level');

  // New ATH: re-anchor announced (an epoch was underway), entries re-arm,
  // and the unhit exit rungs 2/3 stay armed at their old absolute levels.
  evs = await lm.checkMonitor(lm.getMonitor(mon.id), 130_000, T0 + 240_000);
  ok(evs.some((e) => e.type === 'reanchor'), 'new ATH announces the re-arm');
  m = lm.getMonitor(mon.id);
  ok(m.anchor_ath === 130_000 && m.entries_fired.length === 0, 'anchor raised, entries re-armed');
  ok(Math.round(m.exit_levels[1]) === 186_989 && !m.exits_fired.includes(1), 'old exit rungs stay armed at absolute levels');

  // Grind higher with no epoch underway: anchor raises SILENTLY.
  evs = await lm.checkMonitor(lm.getMonitor(mon.id), 131_000, T0 + 300_000);
  ok(evs.length === 0 && lm.getMonitor(mon.id).anchor_ath === 131_000, 'uneventful new high raises the anchor silently');

  // Next epoch: -20% from 131k fires rung 1 again and re-arms fresh exits.
  evs = await lm.checkMonitor(lm.getMonitor(mon.id), 104_000, T0 + 360_000);
  ok(evs.some((e) => e.type === 'buy' && /rung 1/.test(e.message)), 'next epoch fires rung 1 again');
  m = lm.getMonitor(mon.id);
  ok(Math.round(m.exit_levels[0]) === 131_000, 'fresh exit ladder anchored to the new epoch high');

  // DCA: a month later the reminder fires (counter was seated on check #1).
  const MONTH = 30 * 86_400_000;
  evs = await lm.checkMonitor(lm.getMonitor(mon.id), 104_000, T0 + MONTH + 400_000);
  ok(evs.some((e) => e.type === 'dca'), 'monthly DCA reminder fires after a month');
  evs = await lm.checkMonitor(lm.getMonitor(mon.id), 104_000, T0 + MONTH + 460_000);
  ok(!evs.some((e) => e.type === 'dca'), 'DCA does not repeat within the month');

  // ---- notifications + event log --------------------------------------------
  ok(sent.length > 0 && sent.every((s) => s.monitorId === mon.id), `notices dispatched through the mailer (${sent.length})`);
  ok(!sent.some((s) => /exit ladder armed/.test(s.subject)), 'sell-armed context is logged but never paged');
  const events = lm.recentEvents(mon.id, 50);
  ok(events.length >= sent.length, `event log carries the audit trail (${events.length} rows)`);
  ok(events.every((e) => e.emailed === 1 || e.type === 'sell-armed'), 'emailed flag stamped from the dispatch result');

  // ---- tick (due-by-cadence + shared price fetch) ---------------------------
  PRICE = 104_000;
  // The state-machine checks above used synthetic PAST timestamps; seat the
  // check clock to real now so cadence math is tested, not history.
  require('../lib/db').prepare('UPDATE ladder_monitors SET last_checked_at = ? WHERE id = ?').run(Date.now(), mon.id);
  let t = await lm.tick(Date.now());
  ok(t.checked === 0, 'freshly-checked monitor is not due yet (cadence respected)');
  require('../lib/db').prepare('UPDATE ladder_monitors SET last_checked_at = ? WHERE id = ?').run(Date.now() - 16 * 60_000, mon.id);
  t = await lm.tick(Date.now());
  ok(t.checked === 1, 'due monitor is checked by the tick');
  lm.updateMonitor(mon.id, { active: 0 });
  require('../lib/db').prepare('UPDATE ladder_monitors SET last_checked_at = ? WHERE id = ?').run(Date.now() - 16 * 60_000, mon.id);
  t = await lm.tick(Date.now());
  ok(t.checked === 0, 'paused monitor is skipped');

  // ---- config edit resets epoch state ---------------------------------------
  lm.updateMonitor(mon.id, { config: { ...CFG, entryStart: 30 } });
  m = lm.getMonitor(mon.id);
  ok(m.entries_fired.length === 0 && m.exit_levels.length === 0 && m.epoch_had_entry === 0, 'config change resets stale epoch state');

  // ---- real-balance mode: alerts carry actual order sizes, ledger mirrors
  // the simulator (0.5%/leg), avg cost updates on buys, true-up supported.
  const FEE = require('../lib/ladder').FEE_RATE;
  const led = lm.createMonitor({
    name: 'Real ladder',
    config: CFG,
    anchor: 100_000,
    recipients: [],
    startUsd: 10_000,
    startBtc: 0.05,
    avgCost: 70_000,
  });
  ok(led.usd_bal === 10_000 && led.btc_bal === 0.05 && led.avg_cost === 70_000, 'balances stored at creation');

  // First check at -25%: rung 1 fires; spend = 20% of 10k = 2000.
  evs = await lm.checkMonitor(lm.getMonitor(led.id), 75_000, T0);
  const buyEv = evs.find((e) => e.type === 'buy');
  ok(/spend ≈ \$2,000/.test(buyEv.message), `buy alert states the real spend (${buyEv.message.match(/spend ≈ [^ ]+/)})`);
  m = lm.getMonitor(led.id);
  const qty1 = (2000 - 2000 * FEE) / 75_000;
  ok(approx(m.usd_bal, 8000, 1e-9), 'USD debited');
  ok(approx(m.btc_bal, 0.05 + qty1, 1e-9), 'BTC credited net of costs');
  const expAvg = (0.05 * 70_000 + 2000) / (0.05 + qty1);
  ok(approx(m.avg_cost, expAvg, 1e-9), `avg cost re-weighted (${m.avg_cost.toFixed(0)} ≈ ${expAvg.toFixed(0)})`);

  // Sell at the anchor: qty = 20% of held; proceeds credited net of costs.
  evs = await lm.checkMonitor(lm.getMonitor(led.id), 100_000, T0 + 60_000);
  const sellEv = evs.find((e) => e.type === 'sell');
  ok(sellEv && /sell ≈ .* BTC ≈ \$/.test(sellEv.message), 'sell alert states real BTC quantity and proceeds');
  ok(/Vs your .* avg cost: \+/.test(sellEv.message), 'sell alert shows gain vs avg cost');
  const before = m;
  m = lm.getMonitor(led.id);
  const sellQty = before.btc_bal * CFG.sellFrac;
  ok(approx(m.btc_bal, before.btc_bal - sellQty, 1e-9), 'BTC debited on sell');
  ok(approx(m.usd_bal, before.usd_bal + sellQty * 100_000 * (1 - FEE), 1e-9), 'USD credited net of costs');
  ok(approx(m.avg_cost, before.avg_cost, 1e-9), 'avg cost unchanged by sells');

  // True-up after real fills.
  lm.updateMonitor(led.id, { usdBal: 9000, btcBal: 0.08, avgCost: 72_000 });
  m = lm.getMonitor(led.id);
  ok(m.usd_bal === 9000 && m.btc_bal === 0.08 && m.avg_cost === 72_000, 'balance true-up persists');
  const lview = lm.monitorView(m);
  ok(lview.ledger && approx(lview.ledger.totalValue, 9000 + 0.08 * m.last_price, 1e-9), 'view exposes total value at last price');

  // Percent-only monitors carry no ledger and no amounts in messages.
  const pctView = lm.monitorView(lm.getMonitor(mon.id));
  ok(pctView.ledger === null, 'percent-only monitor has no ledger');
  lm.deleteMonitor(led.id);

  // ---- view + delete --------------------------------------------------------
  const view = lm.monitorView(lm.getMonitor(mon.id));
  ok(view.entries.length === 4 && view.exits.length === 3 && view.exitsArmed === false, 'view exposes rung previews after reset');
  ok(Array.isArray(view.events) && view.events.length > 0, 'view carries recent events');
  lm.deleteMonitor(mon.id);
  ok(lm.getMonitor(mon.id) === null, 'delete removes the monitor');
  ok(lm.recentEvents(mon.id).length === 0, 'events cascade-deleted with the monitor');

  console.log('test-laddermon: all assertions passed');
})().catch((err) => {
  console.error('FAIL (exception):', err);
  process.exit(1);
});
