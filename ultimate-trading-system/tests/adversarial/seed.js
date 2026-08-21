// Seed a sandbox with data that is REAL, so the front-door sweep exercises
// each address's actual working rather than its "nothing here" reply.
//
// Everything is made by calling the system's own code — createSetup, the real
// candle-file shape, the real journal event names — so a seed that has drifted
// out of date fails loudly here instead of quietly producing records the
// system will not recognise.
//
// The sweep reports how many addresses answered "nothing here" before and
// after. If that number does not fall, the seeding did nothing and the extra
// coverage is imaginary.
const fs = require('fs');
const path = require('path');

const HOUR = 3600000;

function candleMonth(year, mon) {
  const start = Date.UTC(year, mon - 1, 1);
  const hours = (Date.UTC(mon === 12 ? year + 1 : year, mon === 12 ? 0 : mon, 1) - start) / HOUR;
  const rows = [];
  for (let i = 0; i < hours; i++) {
    const p = 100 + Math.sin(i / 11) * 8;
    rows.push({ ts: start + i * HOUR, open: p, high: p + 1, low: p - 1, close: p + 0.4, quoteVolume: 5000 });
  }
  return rows;
}

// Runs INSIDE the sandbox, so it writes to the sandbox's own data folder.
function seed(sandbox) {
  const data = path.join(sandbox, 'data');
  const cache = path.join(data, 'cache');
  fs.mkdirSync(cache, { recursive: true });
  const pairs = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
  for (const sym of pairs) {
    for (const mon of [1, 2, 3]) {
      fs.writeFileSync(path.join(cache, `${sym}-1h-2024-${String(mon).padStart(2, '0')}.json`),
        JSON.stringify(candleMonth(2024, mon)));
    }
  }

  const { GEOMETRIES } = require(path.join(sandbox, 'lib', 'dataset.js'));
  const geometry = Object.keys(GEOMETRIES)[0];
  const configSnapshot = {
    combo: { trade: 'BTCUSDT', ctx1: 'ETHUSDT', ctx2: 'BNBUSDT', size: 3 },
    branch: { geometry, decision: 'argmax', band: 0.5, weekdaysOnly: false },
    stage: 'slim',
    members: [{ model: 'logreg', view: 'full' }],
    cell: { quorum: 1, entry: 'market', gate: 'directional', dMult: 1, tHours: 8, trailMult: 2, armMult: 1 },
    configVersion: 'seed-v1',
  };

  // Written through the system's own door, so the record is exactly the shape
  // the system makes.
  // Point the setups module at THIS sandbox for the length of the write, then
  // put the environment back. Leaving it set would follow the next sandbox's
  // server into a folder belonging to a sandbox that no longer exists.
  const prevSetupsDir = process.env.GC_SETUPS_DIR;
  process.env.GC_SETUPS_DIR = path.join(data, 'live', 'setups');
  const setups = require(path.join(sandbox, 'lib', 'live', 'setups.js'));
  let made;
  try {
    made = setups.createSetup({
      id: 'seed-book-one',
      name: 'seeded book',
      ownerId: 'adversarial-suite',
      configSnapshot,
      clipUsd: 100,
      stopPct: 0.02,
      trainPolicy: { mode: 'rolling' },
    });
  } finally {
    if (prevSetupsDir === undefined) delete process.env.GC_SETUPS_DIR;
    else process.env.GC_SETUPS_DIR = prevSetupsDir;
  }

  // A journal with real events in it, using the event names read out of
  // lib/live/view.js.
  const pilot = path.join(data, 'pilot');
  fs.mkdirSync(pilot, { recursive: true });
  const evs = [
    { event: 'ENTRY_FILL', setup_id: made.id, chunk_start: 1, side: 'long', qty: 1, price: 100, utc: '2024-02-01T00:00:00Z', fill_deviation: 0.001, fee_quote: 0.1 },
    { event: 'EXIT_FILL', setup_id: made.id, chunk_start: 1, side: 'long', pnl: 4.25, utc: '2024-02-01T08:00:00Z', fee_quote: 0.1 },
    { event: 'ENTRY_FILL', setup_id: made.id, chunk_start: 2, side: 'short', qty: 1, price: 104, utc: '2024-02-02T00:00:00Z', fill_deviation: -0.002, fee_quote: 0.1 },
    { event: 'PNL_MTM', setup_id: 'box', price: 103.5, utc: '2024-02-02T04:00:00Z' },
    { event: 'BALANCE', setup_id: 'box', margin_level: 3.2, utc: '2024-02-02T04:00:00Z' },
  ];
  fs.writeFileSync(path.join(pilot, 'journal.jsonl'), `${evs.map((e) => JSON.stringify(e)).join('\n')}\n`);

  return { setupId: made.id, pairs, months: 3, events: evs.length };
}

module.exports = { seed };
