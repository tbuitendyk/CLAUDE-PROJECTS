// Phase L2 ladder monitors: the live rung-watching state machine must mirror
// the simulator exactly — entries fire once per epoch, the exit ladder arms
// at the first entry against the fallen-from anchor and persists across new
// highs, a new ATH re-arms entries (announced only when an epoch was
// actually underway), DCA reminds monthly after seating, and repeated checks
// at the same price never re-fire. Plus CRUD, recipients validation, and the
// tick's notification dispatch through the (stubbed) mailer.
const { freshDb, ok } = require('./helpers');
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
