const db = require('./db');
const { getDailyHistory } = require('./history');
const exsource = require('./exsource');

// Phase 3 safety rails.
//
// Structural-break buy-freeze: when an asset's current drawdown blows past
// an envelope derived from its own recovered history — or it crashes ≥40%
// inside 7 days — BUY alerts for it are suppressed AT THE ENGINE (they
// neither email, nor mark alloc_alerts, nor consume the armed state).
// SELLS are unaffected; unfreeze is automatic at 0.75× the trigger or
// manual in the UI. Known, accepted false positives: Mar-2020-BTC-style
// capitulations freeze buys mid-crash. Bounded: advisory-only, sells still
// flow, one click to override.
//
// Depeg watch: pegged coins with a real market quote drifting outside
// $0.98–1.02. Valuation stays pinned 1:1 — the user decides what to do.
//
// Both alert channels are LATCHED (once on entry, once on recovery) and
// routed like status reports — recipients + alerts_enabled honored, the
// armed→notified machine BYPASSED.

const ENVELOPE_FACTOR = 1.25;
const ENVELOPE_MIN_PCT = 40;
const ENVELOPE_MAX_PCT = 85;
const MIN_HISTORY_DAYS = 180;
const MIN_EPISODE_DD = 0.2; // recovered drawdowns smaller than 20% carry no signal
const FAST_CRASH_DROP = 0.4; // ≥40% down...
const FAST_CRASH_DAYS = 7; // ...within 7 days
const UNFREEZE_FRACTION = 0.75;
const DEPEG_LOW = 0.98;
const DEPEG_HIGH = 1.02;
const DEPEG_EXIT_LOW = 0.99; // hysteresis: recover well inside the band
const DEPEG_EXIT_HIGH = 1.01;

// Pegged COINS with a real market quote ('usd'/'fiat:usd' have none).
const PEGGED_COINS = new Set([
  'tether', 'usd-coin', 'dai', 'binance-usd', 'true-usd', 'usdd',
  'first-digital-usd', 'paxos-standard', 'gemini-dollar',
]);

// Drawdown episodes under the trailing-high convention (same peak
// convention entering and leaving): an episode runs peak → trough → first
// return to the peak. Returns recovered episodes' depths plus the depth of
// the still-open (right-censored) episode, if any.
function drawdownEpisodes(prices) {
  let peak = -Infinity;
  let troughInEpisode = null;
  const recovered = [];
  let open = null;
  for (const p of prices) {
    if (!(p > 0)) continue;
    if (p >= peak) {
      if (troughInEpisode != null && peak > 0) {
        recovered.push(1 - troughInEpisode / peak);
      }
      peak = p;
      troughInEpisode = null;
    } else {
      troughInEpisode = troughInEpisode == null ? p : Math.min(troughInEpisode, p);
    }
  }
  if (troughInEpisode != null && peak > 0) {
    open = 1 - troughInEpisode / peak;
  }
  return { recovered, open };
}

// The freeze envelope for one asset from its daily USD closes, or null when
// the rule is skipped (thin history / no meaningful recovered drawdown).
function computeEnvelope(prices) {
  if (!prices || prices.length < MIN_HISTORY_DAYS) return null;
  const { recovered } = drawdownEpisodes(prices);
  const meaningful = recovered.filter((d) => d >= MIN_EPISODE_DD);
  if (meaningful.length === 0) return null;
  const deepest = Math.max(...meaningful);
  return Math.min(ENVELOPE_MAX_PCT, Math.max(ENVELOPE_MIN_PCT, deepest * 100 * ENVELOPE_FACTOR));
}

// Current state of one asset given its daily series and the latest live
// price: current drawdown from the trailing high, and the fast-crash flag.
function currentStress(prices, livePrice) {
  const all = livePrice > 0 ? [...prices, livePrice] : prices;
  let peak = -Infinity;
  for (const p of all) if (p > peak) peak = p;
  const last = all[all.length - 1];
  const currentDDPct = peak > 0 ? (1 - last / peak) * 100 : 0;
  const recentWindow = prices.slice(-FAST_CRASH_DAYS);
  const recentHigh = Math.max(...recentWindow, 0);
  const fastCrash = recentHigh > 0 && last <= recentHigh * (1 - FAST_CRASH_DROP);
  return { currentDDPct, fastCrash };
}

// Evaluate freeze/unfreeze transitions for every alertable asset. Reads the
// daily cache (refreshed by the scheduler's daily task) and each asset's
// latest polled price; makes NO network calls of its own. Returns the
// transitions so the caller can notify.
function evaluateFreezes() {
  const assets = db
    .prepare('SELECT * FROM assets WHERE target_pct > 0 AND is_index = 0')
    .all();
  const latestPrice = db.prepare(
    'SELECT usd_price FROM price_history WHERE asset_id = ? ORDER BY ts DESC LIMIT 1'
  );
  const transitions = [];
  for (const a of assets) {
    if (a.coingecko_id === 'usd' || a.coingecko_id === 'fiat:usd') continue;
    const rows = db
      .prepare('SELECT usd_price FROM daily_prices WHERE coingecko_id = ? ORDER BY ts')
      .all(a.coingecko_id);
    const prices = rows.map((r) => r.usd_price);
    if (prices.length === 0) continue;
    const live = latestPrice.get(a.id);
    const envelope = computeEnvelope(prices);
    const { currentDDPct, fastCrash } = currentStress(prices, live ? live.usd_price : null);

    const envelopeHit = envelope != null && currentDDPct >= envelope;
    const shouldFreeze = envelopeHit || fastCrash;

    if (!a.buy_frozen && shouldFreeze) {
      const reason = fastCrash && !envelopeHit
        ? `fast crash: ≥${FAST_CRASH_DROP * 100}% inside ${FAST_CRASH_DAYS} days`
        : `drawdown ${currentDDPct.toFixed(0)}% breached the ${envelope.toFixed(0)}% envelope (1.25× deepest recovered drawdown)`;
      db.prepare('UPDATE assets SET buy_frozen = 1, frozen_at = ?, freeze_reason = ? WHERE id = ?').run(
        Date.now(),
        reason,
        a.id
      );
      transitions.push({ kind: 'freeze', asset: a, reason, currentDDPct, envelope });
    } else if (a.buy_frozen && !shouldFreeze) {
      // Auto-unfreeze at 0.75× the trigger. Envelope freezes release when
      // the drawdown eases below 0.75× the envelope; fast-crash-only
      // freezes (no envelope) release when the crash condition clears and
      // the drawdown from the trailing high eases below 0.75× the crash size.
      const releaseAt = envelope != null ? envelope * UNFREEZE_FRACTION : FAST_CRASH_DROP * 100 * UNFREEZE_FRACTION;
      if (currentDDPct <= releaseAt) {
        db.prepare('UPDATE assets SET buy_frozen = 0, frozen_at = NULL, freeze_reason = NULL WHERE id = ?').run(a.id);
        transitions.push({ kind: 'unfreeze', asset: a, currentDDPct, releaseAt });
      }
    }
  }
  return transitions;
}

// Depeg check for held pegged coins. Prices come from the exchange ticker
// layer (the engine pins tethered valuation to 1:1, so the RAW market quote
// never lands in price_history — this is the one place it's fetched).
async function evaluateDepegs() {
  const assets = db
    .prepare('SELECT * FROM assets WHERE (target_pct > 0 OR quantity > 0 OR is_index = 1)')
    .all()
    .filter((a) => PEGGED_COINS.has(a.coingecko_id));
  if (assets.length === 0) return [];
  let prices = {};
  try {
    prices = await exsource.usdPrices([...new Set(assets.map((a) => a.coingecko_id))], []);
  } catch {
    return [];
  }
  const transitions = [];
  for (const a of assets) {
    const p = prices[a.coingecko_id];
    if (!(p > 0)) continue; // no exchange quote this round — no judgement
    if (!a.depegged && (p < DEPEG_LOW || p > DEPEG_HIGH)) {
      db.prepare('UPDATE assets SET depegged = 1 WHERE id = ?').run(a.id);
      transitions.push({ kind: 'depeg', asset: a, price: p });
    } else if (a.depegged && p >= DEPEG_EXIT_LOW && p <= DEPEG_EXIT_HIGH) {
      db.prepare('UPDATE assets SET depegged = 0 WHERE id = ?').run(a.id);
      transitions.push({ kind: 'repeg', asset: a, price: p });
    }
  }
  return transitions;
}

function noticeText(t) {
  const sym = t.asset.symbol.toUpperCase();
  switch (t.kind) {
    case 'freeze':
      return (
        `SAFETY: BUY alerts for ${sym} are FROZEN — ${t.reason}. ` +
        `Sells still alert normally. Auto-unfreezes when the drawdown eases (0.75× trigger), or unfreeze manually in the app. ` +
        `Advisory only: nothing was traded.`
      );
    case 'unfreeze':
      return `SAFETY: ${sym} buy-freeze LIFTED — drawdown eased to ${t.currentDDPct.toFixed(0)}% (release at ${t.releaseAt.toFixed(0)}%). BUY alerts flow again.`;
    case 'depeg':
      return (
        `SAFETY: ${sym} is trading at $${t.price.toFixed(4)} — outside the $${DEPEG_LOW.toFixed(2)}–${DEPEG_HIGH.toFixed(2)} peg band. ` +
        `Valuation in the app stays pinned 1:1; deciding what to do is yours.`
      );
    case 'repeg':
      return `SAFETY: ${sym} back inside the peg band at $${t.price.toFixed(4)}.`;
    default:
      return `SAFETY: ${t.kind} on ${sym}`;
  }
}

module.exports = {
  evaluateFreezes,
  evaluateDepegs,
  computeEnvelope,
  drawdownEpisodes,
  currentStress,
  noticeText,
  PEGGED_COINS,
};
