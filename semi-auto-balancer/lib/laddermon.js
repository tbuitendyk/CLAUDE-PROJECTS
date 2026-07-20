const db = require('./db');
const mailer = require('./mailer');
const pricing = require('./pricing');

// Ladder monitors (Phase L2): LIVE watching of an adopted cycle-ladder
// config. The Ladder Lab tunes and picks configs; a monitor takes one and
// turns its rungs into notifications — email + Telegram per the monitor's
// own recipients list (same shape as profile recipients), plus an on-screen
// event log. Advisory only: the monitor says WHAT the config would do now
// ("BUY rung 2 hit at $49,864 — spend 20% of spendable USD"); it never
// touches an exchange.
//
// State machine mirrors lib/ladder.js simulateLadder EXACTLY, evaluated on
// live prices instead of bars:
//   - exits first: absolute $ levels (anchored to the fallen-from ATH at the
//     first entry of the epoch) stay armed until hit, even across new highs;
//   - a new ATH raises the anchor and re-arms the entry ladder;
//   - entries fire on drawdown rungs from the anchor, once per epoch;
//   - optional monthly DCA reminder (fixed % of starting capital).
// Rung alerts are edge-triggered one-shots per epoch — no armed→notified
// timeout machine needed, because a fired rung cannot re-fire until an ATH
// resets the epoch. "Check now" just forces an immediate evaluation.

const DAY_MS = 86_400_000;
const DCA_MONTH_MS = 30 * DAY_MS; // same calendar bucket the simulator uses

const CONFIG_FIELDS = [
  'entryStart', 'entrySpacing', 'entryCount', 'buyFrac',
  'exitStart', 'exitSpacing', 'exitCount', 'sellFrac',
  'reservePct', 'dcaMonthlyPct',
];

function validateConfig(raw) {
  const cfg = {};
  for (const f of CONFIG_FIELDS) {
    const v = Number(raw ? raw[f] : NaN);
    if (!Number.isFinite(v) || v < 0) throw new Error(`config.${f} must be a non-negative number`);
    cfg[f] = v;
  }
  if (cfg.entryCount < 1 || cfg.exitCount < 1) throw new Error('entryCount and exitCount must be at least 1');
  if (cfg.entryStart >= 100) throw new Error('entryStart must be below 100 (% drawdown)');
  if (cfg.buyFrac > 1 || cfg.sellFrac > 1) throw new Error('buyFrac/sellFrac are fractions (0..1)');
  return cfg;
}

// Same recipient rules as profiles: each row needs at least one channel,
// emails must look like emails, Telegram chat ids are integers.
function cleanRecipients(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error('recipients must be an array');
  const cleaned = [];
  for (const r of raw) {
    const email = String((r && r.email) || '').trim();
    const chatId = String((r && r.telegram_chat_id) || '').trim();
    if (!email && !chatId) continue;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`invalid email: ${email}`);
    if (chatId && !/^-?\d{1,20}$/.test(chatId)) throw new Error(`invalid Telegram chat ID: ${chatId}`);
    cleaned.push({ email, telegram_chat_id: chatId });
  }
  return cleaned;
}

const entryLevelPct = (cfg, r) => cfg.entryStart + r * cfg.entrySpacing;
const exitLevelMult = (cfg, j) => cfg.exitStart + j * cfg.exitSpacing;

const fmtUsd = (x) => `$${Math.round(x).toLocaleString('en-US')}`;
const pct = (x) => `${Math.round(x * 100)}%`;

// ---- pure state transition --------------------------------------------------
// mon: row-shaped {config(parsed), anchor_ath, entries_fired[], epoch_had_entry,
// exit_levels[], exits_fired[], last_dca_month}. Returns {events, patch} —
// caller persists patch and dispatches events. No IO here (unit-testable).
function evaluate(mon, price, now = Date.now()) {
  const cfg = mon.config;
  const events = [];
  let anchor = mon.anchor_ath;
  let entriesFired = new Set(mon.entries_fired);
  let epochHadEntry = Boolean(mon.epoch_had_entry);
  let exitLevels = mon.exit_levels.slice();
  let exitsFired = new Set(mon.exits_fired);
  let lastDcaMonth = mon.last_dca_month;

  // EXITS first — anchored absolute levels persist until hit.
  for (let j = 0; j < exitLevels.length; j++) {
    if (!exitsFired.has(j) && price >= exitLevels[j]) {
      exitsFired.add(j);
      events.push({
        type: 'sell',
        subject: `SELL rung ${j + 1} hit at ${fmtUsd(price)}`,
        message:
          `SELL rung ${j + 1}/${exitLevels.length} hit: BTC ${fmtUsd(price)} reached the armed level ` +
          `${fmtUsd(exitLevels[j])} (${exitLevelMult(cfg, j).toFixed(2)}× the ` +
          `${fmtUsd(exitLevels[j] / exitLevelMult(cfg, j))} anchor this ladder was armed against). ` +
          `Config says: sell ${pct(cfg.sellFrac)} of held BTC at market.`,
      });
    }
  }

  // New ATH: raise the anchor; if an epoch was underway, that's a real
  // re-arm worth announcing (otherwise raise silently — an uneventful grind
  // upward must not spam a notice on every tick).
  if (price > anchor) {
    const hadEpoch = epochHadEntry || entriesFired.size > 0;
    anchor = price;
    entriesFired = new Set();
    epochHadEntry = false;
    if (hadEpoch) {
      events.push({
        type: 'reanchor',
        subject: `new ATH ${fmtUsd(price)} — entry ladder re-armed`,
        message:
          `New all-time high ${fmtUsd(price)}: the entry ladder re-armed against this anchor. ` +
          `Next buy rung: −${entryLevelPct(cfg, 0)}% = ${fmtUsd(price * (1 - entryLevelPct(cfg, 0) / 100))}. ` +
          `Unhit sell rungs from the previous epoch stay armed at their absolute levels.`,
      });
    }
  }

  // ENTRIES on drawdown rungs from the anchor.
  const ddPct = (1 - price / anchor) * 100;
  for (let r = 0; r < cfg.entryCount; r++) {
    const level = entryLevelPct(cfg, r);
    if (ddPct >= level && !entriesFired.has(r)) {
      entriesFired.add(r);
      events.push({
        type: 'buy',
        subject: `BUY rung ${r + 1} hit at ${fmtUsd(price)}`,
        message:
          `BUY rung ${r + 1}/${cfg.entryCount} hit: BTC ${fmtUsd(price)} is ${ddPct.toFixed(1)}% below the ` +
          `${fmtUsd(anchor)} anchor (rung level −${level}% = ${fmtUsd(anchor * (1 - level / 100))}). ` +
          `Config says: spend ${pct(cfg.buyFrac)} of spendable USD` +
          (cfg.reservePct > 0 ? ` (after the ${cfg.reservePct}% reserve floor)` : '') +
          ` at market.`,
      });
      if (!epochHadEntry) {
        epochHadEntry = true;
        exitLevels = Array.from({ length: cfg.exitCount }, (_, j) => exitLevelMult(cfg, j) * anchor);
        exitsFired = new Set();
        events.push({
          type: 'sell-armed',
          subject: `exit ladder armed to the ${fmtUsd(anchor)} anchor`,
          message:
            `First entry of this epoch: exit ladder armed at ` +
            exitLevels.map((l, j) => `${fmtUsd(l)} (${exitLevelMult(cfg, j).toFixed(2)}×)`).join(', ') +
            `. These absolute levels stay armed until hit.`,
        });
      }
    }
  }

  // Monthly DCA reminder (same 30-day bucket arithmetic as the simulator).
  if (cfg.dcaMonthlyPct > 0) {
    const month = Math.floor(now / DCA_MONTH_MS);
    if (month !== lastDcaMonth) {
      // Only remind once armed with a real prior month — the very first
      // check just seats the counter instead of firing a stale reminder.
      if (lastDcaMonth != null) {
        events.push({
          type: 'dca',
          subject: `monthly DCA due`,
          message:
            `Monthly DCA reminder: buy ${cfg.dcaMonthlyPct}% of your starting capital in BTC at market ` +
            `(price now ${fmtUsd(price)}).`,
        });
      }
      lastDcaMonth = month;
    }
  }

  return {
    events,
    patch: {
      anchor_ath: anchor,
      entries_fired: JSON.stringify([...entriesFired].sort((a, b) => a - b)),
      epoch_had_entry: epochHadEntry ? 1 : 0,
      exit_levels: JSON.stringify(exitLevels),
      exits_fired: JSON.stringify([...exitsFired].sort((a, b) => a - b)),
      last_dca_month: lastDcaMonth,
      last_price: price,
      last_checked_at: now,
    },
  };
}

// ---- persistence ------------------------------------------------------------
function parseRow(row) {
  return {
    ...row,
    config: JSON.parse(row.config),
    entries_fired: JSON.parse(row.entries_fired),
    exit_levels: JSON.parse(row.exit_levels),
    exits_fired: JSON.parse(row.exits_fired),
    recipients: JSON.parse(row.recipients || '[]'),
  };
}

function listMonitors() {
  return db.prepare('SELECT * FROM ladder_monitors ORDER BY id').all().map(parseRow);
}

function getMonitor(id) {
  const row = db.prepare('SELECT * FROM ladder_monitors WHERE id = ?').get(id);
  return row ? parseRow(row) : null;
}

function createMonitor({ name, config, anchor, recipients = [], pollMinutes = 15, alertsEnabled = 1 }) {
  const cfg = validateConfig(config);
  const a = Number(anchor);
  if (!Number.isFinite(a) || a <= 0) throw new Error('anchor (ATH) must be a positive price');
  if (!name || !String(name).trim()) throw new Error('name is required');
  const info = db
    .prepare(
      `INSERT INTO ladder_monitors (name, created_at, config, anchor_ath, poll_minutes, alerts_enabled, recipients)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      Date.now(),
      JSON.stringify(cfg),
      a,
      Math.max(1, Math.round(Number(pollMinutes) || 15)),
      alertsEnabled ? 1 : 0,
      JSON.stringify(cleanRecipients(recipients))
    );
  return getMonitor(info.lastInsertRowid);
}

function updateMonitor(id, fields) {
  const mon = getMonitor(id);
  if (!mon) throw new Error('monitor not found');
  const sets = [];
  const vals = [];
  if (fields.name != null) { sets.push('name = ?'); vals.push(String(fields.name).trim()); }
  if (fields.active != null) { sets.push('active = ?'); vals.push(fields.active ? 1 : 0); }
  if (fields.alertsEnabled != null) { sets.push('alerts_enabled = ?'); vals.push(fields.alertsEnabled ? 1 : 0); }
  if (fields.pollMinutes != null) { sets.push('poll_minutes = ?'); vals.push(Math.max(1, Math.round(Number(fields.pollMinutes) || 15))); }
  if (fields.recipients != null) { sets.push('recipients = ?'); vals.push(JSON.stringify(cleanRecipients(fields.recipients))); }
  if (fields.anchor != null) {
    const a = Number(fields.anchor);
    if (!Number.isFinite(a) || a <= 0) throw new Error('anchor must be a positive price');
    sets.push('anchor_ath = ?'); vals.push(a);
  }
  if (fields.config != null) {
    // A config change is a different ladder: reset the epoch state so stale
    // fired-rung bookkeeping can't suppress the new ladder's alerts.
    const cfg = validateConfig(fields.config);
    sets.push('config = ?'); vals.push(JSON.stringify(cfg));
    sets.push("entries_fired = '[]'", 'epoch_had_entry = 0', "exit_levels = '[]'", "exits_fired = '[]'");
  }
  if (!sets.length) return mon;
  db.prepare(`UPDATE ladder_monitors SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  return getMonitor(id);
}

function deleteMonitor(id) {
  db.prepare('DELETE FROM ladder_monitors WHERE id = ?').run(id);
}

function logEvent(monitorId, type, price, message, emailed) {
  db.prepare('INSERT INTO ladder_events (monitor_id, ts, type, price, message, emailed) VALUES (?, ?, ?, ?, ?, ?)').run(
    monitorId, Date.now(), type, price, message, emailed ? 1 : 0
  );
}

function recentEvents(monitorId, limit = 8) {
  return db
    .prepare('SELECT ts, type, price, message, emailed FROM ladder_events WHERE monitor_id = ? ORDER BY ts DESC, id DESC LIMIT ?')
    .all(monitorId, limit);
}

// ---- the check (evaluate + persist + notify) --------------------------------
async function checkMonitor(mon, price, now = Date.now()) {
  const { events, patch } = evaluate(mon, price, now);
  db.prepare(
    `UPDATE ladder_monitors SET anchor_ath = ?, entries_fired = ?, epoch_had_entry = ?, exit_levels = ?,
     exits_fired = ?, last_dca_month = ?, last_price = ?, last_checked_at = ? WHERE id = ?`
  ).run(
    patch.anchor_ath, patch.entries_fired, patch.epoch_had_entry, patch.exit_levels,
    patch.exits_fired, patch.last_dca_month, patch.last_price, patch.last_checked_at, mon.id
  );
  for (const ev of events) {
    let emailed = 0;
    if (ev.type !== 'sell-armed') {
      // sell-armed is bookkeeping context — log it, don't page anyone for it.
      const sent = await mailer.sendLadderNotice(mon, ev.subject, ev.message).catch((err) => {
        console.error(`Ladder notice dispatch failed for monitor ${mon.id}:`, err.message);
        return { emailed: 0 };
      });
      emailed = sent.emailed;
    }
    logEvent(mon.id, ev.type, price, ev.message, emailed);
  }
  return events;
}

// Scheduler hook: evaluate every ACTIVE monitor that is due by its own
// cadence, sharing one BTC price fetch per tick. Returns a summary.
async function tick(now = Date.now()) {
  const due = listMonitors().filter(
    (m) => m.active && (!m.last_checked_at || now - m.last_checked_at >= m.poll_minutes * 60_000)
  );
  if (!due.length) return { checked: 0, events: 0 };
  const prices = await pricing.fetchUsdPrices(['bitcoin']);
  const price = prices && prices.bitcoin;
  if (!Number.isFinite(price) || price <= 0) throw new Error('no BTC price available');
  let events = 0;
  for (const mon of due) {
    events += (await checkMonitor(mon, price, now)).length;
  }
  return { checked: due.length, events };
}

// ---- view (for the UI) ------------------------------------------------------
function monitorView(mon) {
  const cfg = mon.config;
  const price = mon.last_price;
  const dd = price && mon.anchor_ath ? (1 - price / mon.anchor_ath) * 100 : null;
  return {
    id: mon.id,
    name: mon.name,
    active: Boolean(mon.active),
    alertsEnabled: Boolean(mon.alerts_enabled),
    pollMinutes: mon.poll_minutes,
    recipients: mon.recipients,
    createdAt: mon.created_at,
    config: cfg,
    anchor: mon.anchor_ath,
    lastPrice: price,
    lastCheckedAt: mon.last_checked_at,
    drawdownPct: dd,
    entries: Array.from({ length: cfg.entryCount }, (_, r) => ({
      rung: r + 1,
      levelPct: entryLevelPct(cfg, r),
      priceLevel: mon.anchor_ath * (1 - entryLevelPct(cfg, r) / 100),
      fired: mon.entries_fired.includes(r),
    })),
    exits: mon.exit_levels.length
      ? mon.exit_levels.map((l, j) => ({ rung: j + 1, mult: exitLevelMult(cfg, j), priceLevel: l, fired: mon.exits_fired.includes(j) }))
      : Array.from({ length: cfg.exitCount }, (_, j) => ({
          rung: j + 1,
          mult: exitLevelMult(cfg, j),
          priceLevel: exitLevelMult(cfg, j) * mon.anchor_ath, // preview: not yet armed
          fired: false,
          armed: false,
        })),
    exitsArmed: mon.exit_levels.length > 0,
    events: recentEvents(mon.id),
  };
}

module.exports = {
  evaluate,
  validateConfig,
  createMonitor,
  updateMonitor,
  deleteMonitor,
  getMonitor,
  listMonitors,
  checkMonitor,
  tick,
  monitorView,
  recentEvents,
  CONFIG_FIELDS,
};
