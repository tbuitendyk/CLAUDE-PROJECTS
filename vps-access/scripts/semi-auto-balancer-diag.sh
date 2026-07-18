#!/usr/bin/env bash
# semi-auto-balancer-diag.sh -- read-only diagnostics for the semi-auto
# balancer (Phase 1.5 exchange sync): linked accounts with masked keys and
# the last sync's per-endpoint capability note, pending flows, recent synced
# trades/flows, and per-profile asset state. Mirrors balancer-diag.sh for
# the old system. Never prints API secrets. Runs as root via run-script.
set -euo pipefail
MODE="${1:-full}"

cd /opt/semi-auto-balancer

# Compact analysis mode: ONLY the composition-lab + tuner tables for one
# profile (arg = "analysis-<profileId>"), so output fits the deploy
# endpoint's 8KB stdout cap. Anything else runs the full diagnostics.
if [[ "$MODE" == analysis-* ]]; then
  PID="${MODE#analysis-}" node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');
const pid = Number(process.env.PID);
const latest = (kind) => {
  const row = db.prepare("SELECT created_at, result FROM analysis_results WHERE kind=? AND profile_id=? ORDER BY id DESC LIMIT 1").get(kind, pid);
  return row ? { at: row.created_at, r: JSON.parse(row.result || 'null') } : null;
};
const p = db.prepare('SELECT name, threshold_pct, fee_pct, spread_pct FROM profiles WHERE id=?').get(pid);
console.log(`profile ${pid} "${p.name}" threshold=${p.threshold_pct}% fee=${p.fee_pct} spread=${p.spread_pct}`);
console.log('assets:', db.prepare('SELECT symbol,target_pct,is_index,buy_frozen,freeze_override FROM assets WHERE profile_id=? ORDER BY is_index DESC, target_pct DESC').all(pid).map(a=>`${a.symbol}:${a.target_pct}${a.is_index?'(idx)':''}${a.buy_frozen?(a.freeze_override?'[frz/ovr]':'[FRZ]'):''}`).join(' '));

const tune = latest('tune-threshold');
if (tune && tune.r) {
  const r = tune.r;
  console.log(`\n== TUNER @ ${new Date(tune.at).toISOString()} gran=${r.stamp&&r.stamp.granularity} bars=${r.stamp&&r.stamp.bars} ==`);
  console.log(`reco=${r.recommendation?r.recommendation.x+'%':'NONE'} currentX=${r.currentX} hold_value=${r.hold.valueGrowthPct.toFixed(2)} plateau=${JSON.stringify(r.plateau)}`);
  for (const w of r.warnings||[]) console.log('warn:', w);
  for (const g of r.grid) console.log(`  X=${String(g.x).padEnd(4)} basket=${g.netBasketGrowthPct.toFixed(2).padStart(7)} value=${g.valueGrowthPct.toFixed(2).padStart(7)} trades=${String(g.tradeCount).padStart(4)} fees=${g.feesPct.toFixed(2)}`);
}

const comp = latest('compose');
if (comp && comp.r) {
  const r = comp.r;
  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '?');
  const win = (o) => o ? `${f2(o.value)}(hold${f2(o.hold)})x${o.x==null?'-':o.x}` : '?';
  // Mode-polymorphic mix line: REGIME (deep venues) shows per-type edges +
  // worst/avg; FOLDS (shallow venues) shows walk-forward fold harvest.
  const mixLine = (m) => {
    const a = m.assets.map(x=>x.symbol+':'+x.pct).join(' ');
    const flag = m.recommended ? '★' : ' ';
    if (m.mode === 'regime') {
      const pt = m.perType || {};
      const types = ['bull','bear','range'].filter(t=>pt[t]!=null).map(t=>`${t.slice(0,2)}${f2(pt[t])}`).join(' ');
      return `${flag}${a} | types ${m.typesPositive}/${m.typesPresent} [${types}] worst=${f2(m.consistency)} avg=${f2(m.average)} hold=${win(m.holdout)} full=${win(m.full)}`;
    }
    return `${flag}${a} | folds ${m.positiveFolds}/${m.nFolds} [${(m.foldEdges||[]).map(f2).join(',')}] hold=${win(m.holdout)} full=${win(m.full)}`;
  };
  console.log(`\n== COMPOSE @ ${new Date(comp.at).toISOString()} mode=${r.mode}${r.noHarvest?' NO-HARVEST':''} ==`);
  console.log(`combos=${JSON.stringify(r.combos)} window=${JSON.stringify(r.window)}`);
  const u=r.universe||{}; console.log(`universe covered=${u.covered}/${u.considered} venue=${u.venue} windowDays=${u.windowDays} notOnVenue=[${(u.notOnVenue||[]).join(',')}]`);
  if (r.regime) console.log(`regime byType=${JSON.stringify(r.regime.byType)}`);
  for (const wmsg of r.warnings||[]) console.log('warn:', wmsg);
  if (r.screen) {
    console.log('kept:  '+r.screen.filter(s=>s.kept).map(s=>`${s.symbol}:${s.soloTrain.toFixed(1)}`).join(' '));
    console.log('weeded:'+r.screen.filter(s=>!s.kept).map(s=>`${s.symbol}:${s.soloTrain.toFixed(1)}`).join(' '));
  }
  if (r.currentMix) console.log('CURRENT(ref) '+mixLine(r.currentMix));
  for (const m of (r.mixes||[]).slice(0,10)) console.log('MIX '+mixLine(m));
}
JS
  exit 0
fi

echo "== semi-auto-balancer service =="
systemctl --no-pager --lines 0 status semi-auto-balancer | head -5 || true
echo
echo "== sync-related log lines (last 24h) =="
journalctl -u semi-auto-balancer --since "24 hours ago" --no-pager 2>/dev/null \
  | grep -iE 'sync|adopt|flow|kraken|bitso|error|failed' | tail -n 30 || echo "(none)"
echo

node <<'JS'
const db = require('better-sqlite3')('/opt/semi-auto-balancer/data/semi-auto-balancer.sqlite');

console.log('== exchange accounts ==');
const accounts = db.prepare(
  'SELECT id, profile_id, venue, api_key, enabled, auto_flows, sync_minutes, last_trade_ts, last_ledger_ts, last_sync_at, last_sync_status, last_sync_note FROM exchange_accounts'
).all();
for (const a of accounts) {
  let note = null;
  try { note = JSON.parse(a.last_sync_note || 'null'); } catch { note = a.last_sync_note; }
  console.log(JSON.stringify({
    id: a.id, profile_id: a.profile_id, venue: a.venue,
    api_key: '...' + String(a.api_key).slice(-4),
    enabled: a.enabled, auto_flows: a.auto_flows, sync_minutes: a.sync_minutes,
    last_sync_at: a.last_sync_at ? new Date(a.last_sync_at).toISOString() : null,
    last_sync_status: a.last_sync_status,
    note,
    watermarks: {
      trade: new Date(a.last_trade_ts).toISOString(),
      ledger: new Date(a.last_ledger_ts).toISOString(),
    },
  }, null, 1));
}

console.log('== pending flows (latest 10) ==');
for (const f of db.prepare('SELECT id, profile_id, ts, kind, code, amount, status FROM pending_flows ORDER BY ts DESC LIMIT 10').all()) {
  console.log(JSON.stringify({ ...f, ts: new Date(f.ts).toISOString() }));
}

console.log('== synced trades (latest 5) ==');
for (const t of db.prepare('SELECT account_id, ts, pair, side, price, cost, fee, fee_pct FROM exchange_trades ORDER BY ts DESC LIMIT 5').all()) {
  console.log(new Date(t.ts).toISOString(), `acct=${t.account_id}`, t.pair, t.side,
    `price=${t.price} cost=${t.cost} fee=${t.fee} fee_pct=${t.fee_pct}`);
}

console.log('== flows (latest 5) ==');
for (const f of db.prepare('SELECT profile_id, ts, deltas, note FROM flows ORDER BY ts DESC LIMIT 5').all()) {
  console.log(new Date(f.ts).toISOString(), `profile=${f.profile_id}`, f.deltas, '|', f.note || '');
}

console.log('== latest tune-threshold results ==');
const tuneRows = db.prepare(
  "SELECT profile_id, created_at, result FROM analysis_results WHERE kind = 'tune-threshold' AND id IN (SELECT MAX(id) FROM analysis_results WHERE kind = 'tune-threshold' GROUP BY profile_id)"
).all();
for (const row of tuneRows) {
  let r = null;
  try { r = JSON.parse(row.result || 'null'); } catch {}
  if (!r) continue;
  console.log(`-- profile ${row.profile_id} @ ${new Date(row.created_at).toISOString()} ` +
    `reco=${r.recommendation ? r.recommendation.x + '%' : 'NONE'} bars=${r.stamp && r.stamp.bars} ` +
    `fee=${r.stamp && r.stamp.feePct} spread=${r.stamp && r.stamp.spreadPct}`);
  for (const w of r.warnings || []) console.log('   warn:', w);
  console.log(`   hold: value=${r.hold.valueGrowthPct.toFixed(2)} maxDD=${r.hold.maxValueDrawdownPct.toFixed(1)}`);
  for (const g of r.grid) {
    console.log(`   X=${String(g.x).padEnd(4)} basket=${g.netBasketGrowthPct.toFixed(2).padStart(7)} ` +
      `value=${g.valueGrowthPct.toFixed(2).padStart(7)} dd=${g.maxValueDrawdownPct.toFixed(1).padStart(5)} ` +
      `trades=${String(g.tradeCount).padStart(3)} fees=${g.feesPct.toFixed(2)}`);
  }
}

console.log('== latest compose (composition lab) results ==');
const composeRows = db.prepare(
  "SELECT profile_id, created_at, result FROM analysis_results WHERE kind = 'compose' AND id IN (SELECT MAX(id) FROM analysis_results WHERE kind = 'compose' GROUP BY profile_id)"
).all();
{
  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '?');
  const day = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : '?');
  const win = (o) => (o ? `${f2(o.value)}(hold${f2(o.hold)},edge${f2(o.edge)})x${o.x == null ? '-' : o.x}` : '?');
  // Mode-polymorphic mix line: REGIME (deep venues, e.g. Kraken 4y) reports
  // per-market-type edges + worst(consistency)/avg; FOLDS (shallow venues,
  // e.g. Bitso) reports walk-forward fold harvest. ★ = recommended.
  const mixLine = (m) => {
    const a = m.assets.map((x) => x.symbol + ':' + x.pct).join(' ');
    const flag = m.recommended ? '★' : ' ';
    if (m.mode === 'regime') {
      const pt = m.perType || {};
      const types = ['bull', 'bear', 'range'].filter((t) => pt[t] != null).map((t) => `${t.slice(0,2)}${f2(pt[t])}`).join(' ');
      return `${flag}${a} | types ${m.typesPositive}/${m.typesPresent} [${types}] worst=${f2(m.consistency)} avg=${f2(m.average)} | hold=${win(m.holdout)} full=${win(m.full)}`;
    }
    return `${flag}${a} | folds ${m.positiveFolds}/${m.nFolds} edges[${(m.foldEdges || []).map(f2).join(',')}] | hold=${win(m.holdout)} full=${win(m.full)}`;
  };
  for (const row of composeRows) {
    let r = null;
    try { r = JSON.parse(row.result || 'null'); } catch {}
    if (!r) continue;
    const u = r.universe || {};
    const w = r.window || {};
    console.log(`-- profile ${row.profile_id} @ ${new Date(row.created_at).toISOString()} mode=${r.mode}${r.noHarvest ? ' NO-HARVEST' : ''}`);
    console.log(`   combos: ${JSON.stringify(r.combos)} · universe ${u.covered}/${u.considered} venue=${u.venue} notOnVenue=[${(u.notOnVenue||[]).join(',')}] windowDays=${u.windowDays}`);
    console.log(`   window: bars=${w.bars} inSample=${w.inSampleBars} holdout=${w.holdoutBars} folds=${w.nFolds} from=${day(w.from)} holdoutFrom=${day(w.holdoutFrom)}`);
    if (r.regime) console.log(`   regime byType: ${JSON.stringify(r.regime.byType)} swaths=${(r.regime.swaths||[]).map(s=>s.label[0]+s.days).join(' ')}`);
    for (const wmsg of r.warnings || []) console.log('   warn:', wmsg);
    if (r.screen) {
      console.log('   screen kept: ' + r.screen.filter(s=>s.kept).map(s=>`${s.symbol}:${s.soloTrain.toFixed(1)}`).join(' '));
      const weeded = r.screen.filter(s=>!s.kept);
      if (weeded.length) console.log('   screen weeded: ' + weeded.map(s=>`${s.symbol}:${s.soloTrain.toFixed(1)}`).join(' '));
    }
    if (r.currentMix) console.log('   CURRENT (ref): ' + mixLine(r.currentMix));
    for (const m of (r.mixes || []).slice(0, 8)) console.log('   ' + mixLine(m));
  }
}

console.log('== price paths (cached daily closes, active assets) ==');
for (const a of db.prepare('SELECT DISTINCT coingecko_id FROM assets WHERE target_pct > 0 OR is_index = 1').all()) {
  const s = db.prepare('SELECT COUNT(*) n, MIN(ts) f, MAX(ts) l FROM daily_prices WHERE coingecko_id = ?').get(a.coingecko_id);
  if (!s.n) { console.log(`${a.coingecko_id}: no cache (synthesized or unpriced)`); continue; }
  const first = db.prepare('SELECT usd_price FROM daily_prices WHERE coingecko_id = ? ORDER BY ts LIMIT 1').get(a.coingecko_id).usd_price;
  const last = db.prepare('SELECT usd_price FROM daily_prices WHERE coingecko_id = ? ORDER BY ts DESC LIMIT 1').get(a.coingecko_id).usd_price;
  const mm = db.prepare('SELECT MIN(usd_price) lo, MAX(usd_price) hi FROM daily_prices WHERE coingecko_id = ?').get(a.coingecko_id);
  console.log(`${a.coingecko_id}: ${s.n}d ${new Date(s.f).toISOString().slice(0,10)}→${new Date(s.l).toISOString().slice(0,10)} ` +
    `first=${first} last=${last} lo=${mm.lo} hi=${mm.hi} chg=${((last / first - 1) * 100).toFixed(1)}%`);
}

console.log('== profiles ==');
for (const p of db.prepare('SELECT id, name, notify_state, threshold_pct, value_started_at FROM profiles').all()) {
  const assets = db.prepare('SELECT symbol, quantity, target_pct, is_index FROM assets WHERE profile_id = ? ORDER BY id').all(p.id);
  console.log(JSON.stringify({
    id: p.id, name: p.name, notify_state: p.notify_state, threshold_pct: p.threshold_pct,
    value_started_at: p.value_started_at ? new Date(p.value_started_at).toISOString() : null,
    assets,
  }));
}
JS
