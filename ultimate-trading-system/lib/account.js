// WHAT THIS ACCOUNT PAYS TO TRADE, AND WHERE THAT NUMBER COMES FROM
// (owner order, 2026-09-18).
//
// The owner's words: "this is going to be by trading account, and trading
// accounts are configured under setup | account, so you need to build
// something into the Account tab at least for now as the source of the
// FEE_PER_LEG constant that's NOT in code but given by the user. at this point
// we support trading only on Binance, so the exchange record under Account
// needs to indicate at least a basic Binance trading profile, and under that
// the Binance FEE_PER_LEG with the option to use as the system default under
// Compute. then you need to make sure that your new column that makes an
// earnings claim is referencing the user value".
//
// WHY THIS FILE EXISTS. Until today the cost of getting in and out was a
// constant in lib/paper.js and nothing on any screen could move it, while
// every figure on the Coins screens was measured against it and one column --
// windows paid -- makes an earnings claim out of it directly. That is exactly
// what RULE FIVE forbids: a number the system acts on that the owner cannot
// reach. The fee belongs to the account, because it is what the venue charges
// THIS account, and venues and tiers differ.
//
// THREE RULES, the same three lib/compute.js keeps:
//
//   * THE LIST OF EXCHANGES COMES FROM HERE, NEVER FROM THE PAGE. One exists
//     today. A second one appears in every dropdown on its own the day it is
//     added here, with nobody editing a screen.
//
//   * A STORED NUMBER IS READ, OR IT IS A LIE. systemFee() is what the Coins
//     screens count against, and it reports whether the owner set it or
//     whether the built-in is standing in. Nothing pretends.
//
//   * NOTHING IS TYPED TWICE. The fee is entered in one place, on Account.
//     Compute shows which one is in force and points back here; it does not
//     offer a second box that could disagree with the first.
//
// It lives in data/settings.json beside the compute choices because it is the
// same kind of thing: how this installation is configured, as against what it
// has measured.
const fs = require('fs');
const path = require('path');
const { feeRate, FEE_PER_LEG } = require('./paper');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');

// THE EXCHANGES THIS SYSTEM CAN TRADE ON. One today, and saying so is the
// truth rather than a placeholder.
const EXCHANGES = [{ id: 'binance', label: 'Binance' }];

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (_) { return {}; }
}

// THE SAME ATOMIC WRITE THE OTHER SETTINGS USE. Read, change, write beside,
// rename over -- so a crash mid-write leaves the old file, never half of one.
function writeSettings(change) {
  const settings = readSettings();
  change(settings);
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  const tmp = `${SETTINGS_FILE}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 1));
  fs.renameSync(tmp, SETTINGS_FILE);
  return settings;
}

// EVERY EXCHANGE, WITH WHAT THE OWNER SET ON IT. A fee that was never set
// reads null, not the built-in: "not set" and "set to the built-in figure" are
// different facts and the screen says which.
function exchanges() {
  const s = readSettings();
  const stored = s.account_exchanges || {};
  const def = s.account_fee_default || null;
  return EXCHANGES.map((e) => {
    const mine = stored[e.id] || {};
    return {
      id: e.id,
      label: e.label,
      feePerLeg: Number.isFinite(mine.feePerLeg) ? mine.feePerLeg : null,
      roundTripPct: Number.isFinite(mine.feePerLeg) ? 100 * 2 * mine.feePerLeg : null,
      isDefault: def === e.id,
    };
  });
}

// SETTING ONE. The fee goes through paper.feeRate, which is the guard that
// refuses a dollar amount typed where a fraction belongs -- 0.125 entered as
// 0.125 instead of 0.00125 would charge a hundred times the real cost, and
// every number on every screen would move with it.
function setExchange(id, { feePerLeg, isDefault } = {}) {
  const known = EXCHANGES.find((e) => e.id === String(id));
  if (!known) {
    throw new Error(`"${id}" is not an exchange this system knows — it knows ${EXCHANGES.map((e) => e.id).join(', ')}`);
  }
  if (feePerLeg != null) feeRate(Number(feePerLeg), `the fee each way on ${known.label}`);
  writeSettings((s) => {
    const all = s.account_exchanges || (s.account_exchanges = {});
    const mine = all[known.id] || (all[known.id] = {});
    if (feePerLeg != null) mine.feePerLeg = Number(feePerLeg);
    if (isDefault === true) s.account_fee_default = known.id;
    // UNTICKING IT CLEARS THE DEFAULT ONLY IF IT IS THIS ONE'S. Otherwise
    // saving one exchange would quietly take the default off another.
    if (isDefault === false && s.account_fee_default === known.id) s.account_fee_default = null;
  });
  return exchanges().find((e) => e.id === known.id);
}

// WHAT THE SYSTEM CHARGES ITSELF, AND WHERE IT CAME FROM. Every reader that
// used to reach for the constant asks this instead, and prints `from` beside
// the figure so a number on a screen is never unattributable.
//
// THE BUILT-IN IS NOT A SECOND SETTING. It is what stands in until the owner
// has entered theirs, and `set: false` says so on every screen that shows it.
// Refusing outright instead would take every Coins figure off the screen for
// the sake of a number that has been right all along.
function systemFee() {
  const chosen = exchanges().find((e) => e.isDefault && e.feePerLeg != null);
  if (chosen) {
    return {
      set: true,
      exchange: chosen.id,
      from: chosen.label,
      feePerLeg: chosen.feePerLeg,
      roundTripPct: 100 * 2 * chosen.feePerLeg,
    };
  }
  return {
    set: false,
    exchange: null,
    from: 'the built-in figure',
    feePerLeg: FEE_PER_LEG,
    roundTripPct: 100 * 2 * FEE_PER_LEG,
  };
}

// The round trip as a percent, which is the unit every window figure on the
// Coins screens is already in.
function roundTripPct() { return systemFee().roundTripPct; }

module.exports = { EXCHANGES, exchanges, setExchange, systemFee, roundTripPct };
