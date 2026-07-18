const db = require('./db');
const { getDailyHistory } = require('./history');
const exsource = require('./exsource');

// Phase 3 + 3.5 safety rails.
//
// Structural-break buy-freeze: BUY alerts for an asset are suppressed AT THE
// ENGINE (they neither email, nor mark alloc_alerts, nor consume the armed
// state) when it is IDIOSYNCRATICALLY breaking down — deep past its own
// envelope AND falling materially harder than the broad market — or it
// crashes ≥40% inside 7 days idiosyncratically, or it's an absolute
// catastrophe (>90% drawdown). SELLS are unaffected.
//
// Phase 3.5 — market-relative gate: a BROAD market drawdown (everything
// falling in tandem) must NOT freeze the whole pool, because that's exactly
// when rebalancing harvest is most valuable — you want to keep buying the
// relative losers and selling the relative winners. So the freeze compares
// each asset's drawdown to a blended market benchmark (BTC + the median of
// the cached universe) and only fires on the EXCESS. Assets falling with the
// market stay tradable; only names genuinely going to zero freeze.
// Auto-unfreeze when the drawdown eases (0.75× trigger) OR the asset catches
// back up to the market (excess falls below 0.6× the margin); manual
// override in the UI.
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
// Phase 3.5 market-relative gate.
const CATASTROPHE_PCT = 90; // absolute drawdown that freezes regardless of the market (dead is dead)
const IDIO_MARGIN_PCT = 20; // must be this many pp DEEPER than the market to count as idiosyncratic
const IDIO_RELEASE_FRAC = 0.6; // hysteresis: relative recovery releases once excess < 0.6× the margin
const MIN_MARKET_N = 3; // fewer cached benchmark coins than this → fall back to BTC-only, else absolute
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

// Blended market-drawdown benchmark (Phase 3.5) from the daily cache: BTC's
// current drawdown averaged with the MEDIAN current drawdown across the
// cached universe (held assets + composition candidates), excluding
// stablecoins/fiat. In a tandem market drop both rise together, shrinking
// every asset's EXCESS drawdown so nothing trips the relative freeze — the
// pool keeps rebalancing. Median tempers the blend so BTC being the thing
// crashing doesn't blind the reference. Network-free; uses cached data only.
// Returns { blendPct, btcPct, medianPct, n }; blendPct null when the cache
// is too thin to judge (caller then falls back to absolute behavior).
function marketDrawdown() {
  const peaks = db
    .prepare('SELECT coingecko_id AS id, MAX(usd_price) AS hi, COUNT(*) AS n FROM daily_prices GROUP BY coingecko_id')
    .all();
  const lasts = db
    .prepare(
      `SELECT dp.coingecko_id AS id, dp.usd_price AS last FROM daily_prices dp
         JOIN (SELECT coingecko_id, MAX(ts) AS mt FROM daily_prices GROUP BY coingecko_id) m
           ON dp.coingecko_id = m.coingecko_id AND dp.ts = m.mt`
    )
    .all();
  const lastById = new Map(lasts.map((r) => [r.id, r.last]));
  const dds = [];
  let btc = null;
  for (const p of peaks) {
    if (p.n < MIN_HISTORY_DAYS) continue;
    if (p.id.startsWith('fiat:') || p.id === 'usd' || PEGGED_COINS.has(p.id)) continue;
    const last = lastById.get(p.id);
    if (!(p.hi > 0) || !(last > 0)) continue;
    const dd = (1 - last / p.hi) * 100;
    dds.push(dd);
    if (p.id === 'bitcoin') btc = dd;
  }
  if (dds.length === 0) return { blendPct: btc, btcPct: btc, medianPct: null, n: 0 };
  dds.sort((a, b) => a - b);
  const median = dds[Math.floor(dds.length / 2)];
  let blend;
  if (dds.length < MIN_MARKET_N) blend = btc != null ? btc : median;
  else blend = btc != null ? (btc + median) / 2 : median;
  return { blendPct: blend, btcPct: btc, medianPct: median, n: dds.length };
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
  // One market benchmark for the whole pass. Null blend (thin cache) → treat
  // the market as 0%, which reduces the relative gate to the old absolute
  // rule — safe when we lack the breadth to judge "with the market".
  const market = marketDrawdown();
  const marketDD = market.blendPct != null ? market.blendPct : 0;
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

    const excessDD = currentDDPct - marketDD; // how much deeper than the market
    const idiosyncratic = excessDD >= IDIO_MARGIN_PCT;
    const catastrophe = currentDDPct >= CATASTROPHE_PCT;
    const envelopeHit = envelope != null && currentDDPct >= envelope;
    // Only idiosyncratic breakdowns freeze; a catastrophe freezes regardless
    // (dead is dead). Assets falling WITH the market stay tradable.
    const shouldFreeze = catastrophe || (envelopeHit && idiosyncratic) || (fastCrash && idiosyncratic);

    if (!a.buy_frozen && shouldFreeze) {
      let reason;
      if (catastrophe && !(envelopeHit && idiosyncratic) && !(fastCrash && idiosyncratic)) {
        reason = `catastrophic drawdown ${currentDDPct.toFixed(0)}% (past the ${CATASTROPHE_PCT}% backstop, frozen regardless of the market)`;
      } else if (fastCrash && !(envelopeHit && idiosyncratic)) {
        reason = `fast idiosyncratic crash: ≥${FAST_CRASH_DROP * 100}% in ${FAST_CRASH_DAYS} days, ${excessDD.toFixed(0)}pp deeper than the market (${marketDD.toFixed(0)}%)`;
      } else {
        reason = `drawdown ${currentDDPct.toFixed(0)}% is ${excessDD.toFixed(0)}pp deeper than the market (${marketDD.toFixed(0)}%) and past the ${envelope.toFixed(0)}% envelope — idiosyncratic decline`;
      }
      db.prepare('UPDATE assets SET buy_frozen = 1, frozen_at = ?, freeze_reason = ? WHERE id = ?').run(
        Date.now(),
        reason,
        a.id
      );
      transitions.push({ kind: 'freeze', asset: a, reason, currentDDPct, envelope, marketDD, excessDD });
    } else if (a.buy_frozen) {
      // Auto-unfreeze (never while still a catastrophe) when EITHER the
      // absolute drawdown eases below 0.75× the trigger, OR the asset has
      // caught back up to the market (excess fell below 0.6× the margin) —
      // i.e. it's now moving WITH the market, so harvesting should resume.
      const stillCatastrophe = currentDDPct >= CATASTROPHE_PCT;
      const absReleaseAt = envelope != null ? envelope * UNFREEZE_FRACTION : FAST_CRASH_DROP * 100 * UNFREEZE_FRACTION;
      const absReleased = currentDDPct <= absReleaseAt;
      const relReleased = excessDD <= IDIO_MARGIN_PCT * IDIO_RELEASE_FRAC;
      if (!shouldFreeze && !stillCatastrophe && (absReleased || relReleased)) {
        db.prepare('UPDATE assets SET buy_frozen = 0, frozen_at = NULL, freeze_reason = NULL WHERE id = ?').run(a.id);
        transitions.push({
          kind: 'unfreeze',
          asset: a,
          currentDDPct,
          marketDD,
          excessDD,
          via: relReleased && !absReleased ? 'caught up to the market' : 'drawdown eased',
        });
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
        `Sells still alert normally. Auto-unfreezes when it recovers or catches back up to the market, or unfreeze manually in the app. ` +
        `Advisory only: nothing was traded.`
      );
    case 'unfreeze':
      return (
        `SAFETY: ${sym} buy-freeze LIFTED (${t.via}) — drawdown ${t.currentDDPct.toFixed(0)}% vs market ${t.marketDD.toFixed(0)}% ` +
        `(now ${t.excessDD.toFixed(0)}pp off the market). BUY alerts flow again.`
      );
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
  marketDrawdown,
  computeEnvelope,
  drawdownEpisodes,
  currentStress,
  noticeText,
  PEGGED_COINS,
};
