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

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  usd_price REAL NOT NULL,
  rel_price REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_history_asset_ts ON price_history(asset_id, ts);

-- One row per asset currently over its allocation-drift threshold; prevents
-- an email every poll. Cleared when the asset converges back toward target
-- or when new targets are set.
CREATE TABLE IF NOT EXISTS alloc_alerts (
  asset_id INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  triggered_at INTEGER NOT NULL,
  drift_rel_pct REAL NOT NULL
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

-- Deposits/withdrawals: external quantity changes recorded so they splice
-- past the basket/value indexes instead of corrupting them.
CREATE TABLE IF NOT EXISTS flows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  deltas TEXT NOT NULL,              -- JSON [{asset_id, symbol, delta}]
  note TEXT
);

-- Local daily price-history cache (Phase 0). One row per asset per UTC day
-- (ts = 00:00 UTC ms). INSERT OR REPLACE on fetch so the partial trailing
-- point CoinGecko returns (live price at request time) is overwritten by the
-- real close on the next top-up. Backtests, safety rails, and the scanner all
-- read from here instead of hitting the API.
CREATE TABLE IF NOT EXISTS daily_prices (
  coingecko_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  usd_price REAL NOT NULL,
  PRIMARY KEY (coingecko_id, ts)
);

-- App-wide key/value settings (e.g. the Telegram bot token, entered in the
-- UI and shared by every profile's notifications).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- CoinGecko monthly call ledger: the demo tier's binding constraint is
-- 10,000 calls/month, so every request (success or error) is counted.
CREATE TABLE IF NOT EXISTS cg_ledger (
  month TEXT PRIMARY KEY,   -- '2026-07'
  calls INTEGER NOT NULL DEFAULT 0
);

-- Persisted results of long-running analysis jobs (threshold sweeps, scans)
-- so a deploy/restart doesn't discard a finished run.
CREATE TABLE IF NOT EXISTS analysis_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,        -- 'tune-threshold' | 'scan' | ...
  created_at INTEGER NOT NULL,
  params TEXT,               -- JSON: inputs the result was computed from
  result TEXT                -- JSON payload
);

-- Phase 1.5: one read-only exchange account per profile (Kraken or Bitso).
-- Keys live server-side only, are never sent back whole (masked to the last
-- 4 chars in every API response), and carry no trade/withdraw permissions by
-- construction (user checklist in EXCHANGES.md). Watermarks start at link
-- time so history from before the link never floods in — the quantities at
-- link time are the baseline the reconciliation explains forward from.
CREATE TABLE IF NOT EXISTS exchange_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  venue TEXT NOT NULL,                        -- 'kraken' | 'bitso'
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  auto_flows INTEGER NOT NULL DEFAULT 0,      -- 1 = detected flows apply without confirmation
  enabled INTEGER NOT NULL DEFAULT 1,
  sync_minutes INTEGER NOT NULL DEFAULT 60,
  last_trade_ts INTEGER NOT NULL,             -- high-water marks (unix ms)
  last_ledger_ts INTEGER NOT NULL,
  last_sync_at INTEGER,
  last_sync_status TEXT,                      -- 'ok' | error message
  last_sync_note TEXT,                        -- JSON: unmapped balances, unexplained residuals
  created_at INTEGER NOT NULL
);

-- Raw synced trades, deduped by the venue's trade id. These are the record
-- that explains quantity changes with NO splice (trading is the harvest
-- registering) and the sample the fee calibration reads from.
CREATE TABLE IF NOT EXISTS exchange_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES exchange_accounts(id) ON DELETE CASCADE,
  venue_trade_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  pair TEXT,
  side TEXT,
  price REAL,
  cost REAL,
  fee REAL,
  fee_currency TEXT,
  fee_pct REAL,              -- realized fee as % of trade value (calibration input)
  deltas TEXT NOT NULL,      -- JSON [{code, delta}] as applied to quantities
  raw TEXT,
  UNIQUE(account_id, venue_trade_id)
);
CREATE INDEX IF NOT EXISTS idx_exchange_trades_account_ts ON exchange_trades(account_id, ts);

-- Deposits/withdrawals detected from the venue ledger. They wait as pending
-- confirmations (a wrong flow splice silently corrupts the basket) unless the
-- account is set to auto_flows; confirming applies the exact-amount splice
-- via recordFlow with the flow's real timestamp.
CREATE TABLE IF NOT EXISTS pending_flows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES exchange_accounts(id) ON DELETE CASCADE,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  venue_ref TEXT NOT NULL,   -- venue ledger/funding/withdrawal id
  ts INTEGER NOT NULL,       -- real event timestamp from the venue
  kind TEXT NOT NULL,        -- 'deposit' | 'withdrawal'
  code TEXT NOT NULL,        -- normalized venue currency code
  asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  amount REAL NOT NULL,      -- signed quantity delta
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | applied | dismissed
  raw TEXT,
  UNIQUE(account_id, venue_ref)
);

-- One row per splice (target change / flow / explicit reset): the index
-- levels and weights at that moment. Behind-the-scenes record for future
-- analysis of which asset mixes performed best.
CREATE TABLE IF NOT EXISTS basket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,                -- 'targets' | 'flow' | 'reset'
  basket REAL,                       -- chained basket level at the splice
  value_index REAL,                  -- chained value index at the splice
  weights TEXT,                      -- JSON {symbol: target_pct} after the event
  note TEXT
);
`);

// Columns added after the first release; bring existing databases up to date.
function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('assets', 'quantity', 'quantity REAL NOT NULL DEFAULT 0');
ensureColumn('assets', 'target_pct', 'target_pct REAL NOT NULL DEFAULT 0');
// Tethered index asset: priced 1:1 with the profile's index (e.g. USDT for a
// USD index). At most one per profile.
ensureColumn('assets', 'is_index', 'is_index INTEGER NOT NULL DEFAULT 0');
// Unit snapshot for the currency-basket calculation; taken when targets are set.
ensureColumn('assets', 'basket_units', 'basket_units REAL');
// One-time backfill for databases that predate basket_units: an existing
// profile that already has targets was showing a basket (~1.0) under the old
// engine, so snapshot the current quantities as the unit baseline. That keeps
// the basket reading continuous (base 1.0 x qty/qty = 1.0) instead of blanking
// out until the next "set targets". Idempotent: only fills NULLs, and only for
// profiles that actually have a target set.
db.exec(`
  UPDATE assets SET basket_units = quantity
  WHERE basket_units IS NULL
    AND EXISTS (
      SELECT 1 FROM assets a2
      WHERE a2.profile_id = assets.profile_id AND a2.target_pct > 0
    );
`);
ensureColumn('profiles', 'basket_started_at', 'basket_started_at INTEGER');
// Chain-linking: displayed basket = basket_base x (weighted unit ratios).
// Splices (target changes, flows) fold the current level into basket_base
// and re-snapshot, so the number is continuous across structural changes.
ensureColumn('profiles', 'basket_base', 'basket_base REAL NOT NULL DEFAULT 1');
// Same idea for the value-growth index (time-weighted return): displayed
// growth compounds value_base x (total_rel / value_snap_rel) across flows.
ensureColumn('profiles', 'value_base', 'value_base REAL NOT NULL DEFAULT 1');
ensureColumn('profiles', 'value_snap_rel', 'value_snap_rel REAL');
ensureColumn('profile_snapshots', 'value_index', 'value_index REAL');
// When the value index was anchored at 1.0 (the "start" that growth and the
// annualized/compounding rate are measured from). Preserved across splices
// (deposits, target changes, index switches) so the track record is continuous.
ensureColumn('profiles', 'value_started_at', 'value_started_at INTEGER');
// Backfill for profiles anchored before this column existed: the anchor moment
// is the first snapshot that carries a value_index, so the start date and the
// growth % stay mutually consistent.
db.exec(`
  UPDATE profiles SET value_started_at = (
    SELECT MIN(ts) FROM profile_snapshots
    WHERE profile_id = profiles.id AND value_index IS NOT NULL
  )
  WHERE value_started_at IS NULL AND value_snap_rel IS NOT NULL;
`);
// Per-profile notifications: master toggle, recipient list (JSON array of
// {email, telegram_chat_id}), and the notification state machine
// (armed -> notified -> awaiting_upload, with 12h timeouts back to armed).
ensureColumn('profiles', 'alerts_enabled', "alerts_enabled INTEGER NOT NULL DEFAULT 1");
ensureColumn('profiles', 'recipients', "recipients TEXT NOT NULL DEFAULT '[]'");
ensureColumn('profiles', 'notify_state', "notify_state TEXT NOT NULL DEFAULT 'armed'");
ensureColumn('profiles', 'notify_state_at', 'notify_state_at INTEGER');
ensureColumn('profile_snapshots', 'basket', 'basket REAL');
// Cost model (Phase 0): per-profile trading costs, used by every backtest and
// advisory feature. fee = taker fee % per leg (Kraken 0.38, Bitso 0.36 —
// set per profile in the UI); spread = estimated half-spread+slippage % per
// leg. Zero is a legal value (fee-free venue), so validation is >= 0.
ensureColumn('profiles', 'fee_pct', 'fee_pct REAL NOT NULL DEFAULT 0.38');
ensureColumn('profiles', 'spread_pct', 'spread_pct REAL NOT NULL DEFAULT 0.10');
// Phase 3 safety rails: structural-break buy-freeze (engine suppresses BUY
// alerts while set; sells unaffected) and the latched depeg flag.
ensureColumn('assets', 'buy_frozen', 'buy_frozen INTEGER NOT NULL DEFAULT 0');
ensureColumn('assets', 'frozen_at', 'frozen_at INTEGER');
ensureColumn('assets', 'freeze_reason', 'freeze_reason TEXT');
ensureColumn('assets', 'depegged', 'depegged INTEGER NOT NULL DEFAULT 0');

// Sets were removed from the design (one flat asset pool per profile);
// drop the leftover tables from earlier versions.
db.exec(`
DROP TABLE IF EXISTS set_members;
DROP TABLE IF EXISTS sets;
DROP TABLE IF EXISTS active_alerts;
`);

module.exports = db;
