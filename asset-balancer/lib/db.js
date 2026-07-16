const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  index_asset TEXT NOT NULL DEFAULT 'usd',   -- coingecko id, or 'usd'
  threshold_pct REAL NOT NULL DEFAULT 5,     -- relative divergence that triggers an alert
  poll_minutes INTEGER NOT NULL DEFAULT 15,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_polled_at INTEGER,                    -- unix ms
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  coingecko_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  -- baseline relative price (in index units), set when the asset is added
  -- and reset on "rebalance"
  baseline_rel REAL,
  baseline_at INTEGER,
  UNIQUE(profile_id, coingecko_id)
);

CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS set_members (
  set_id INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY (set_id, asset_id)
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  usd_price REAL NOT NULL,
  rel_price REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_history_asset_ts ON price_history(asset_id, ts);

-- One row per (set, asset pair) currently over threshold; prevents an email
-- every poll. Cleared when the pair converges again or baselines are reset.
CREATE TABLE IF NOT EXISTS active_alerts (
  set_id INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  asset_a INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  asset_b INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  triggered_at INTEGER NOT NULL,
  drift_pct REAL NOT NULL,
  PRIMARY KEY (set_id, asset_a, asset_b)
);

CREATE TABLE IF NOT EXISTS alert_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  set_id INTEGER,
  message TEXT NOT NULL,
  ts INTEGER NOT NULL,
  emailed INTEGER NOT NULL DEFAULT 0
);

-- One row per profile per poll: total holdings value (USD and index units),
-- growth vs baseline, and the quantities held at that moment -- the record
-- of how the profile's value and holdings grow over time.
CREATE TABLE IF NOT EXISTS profile_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  total_usd REAL NOT NULL,
  total_rel REAL NOT NULL,          -- total value in index-asset units
  baseline_rel_total REAL,          -- same holdings valued at baseline prices
  growth_pct REAL,                  -- (total_rel / baseline_rel_total - 1) * 100
  quantities TEXT                   -- JSON {symbol: quantity}
);
CREATE INDEX IF NOT EXISTS idx_snapshots_profile_ts ON profile_snapshots(profile_id, ts);
`);

// Columns added after the first release; bring existing databases up to date.
function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('assets', 'quantity', 'quantity REAL NOT NULL DEFAULT 0');
ensureColumn('assets', 'target_pct', 'target_pct REAL NOT NULL DEFAULT 0');

module.exports = db;
