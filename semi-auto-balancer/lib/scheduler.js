const db = require('./db');
const { pollProfiles } = require('./balancer');
const { sendAlertEvents, sendSafetyNotice } = require('./mailer');
const { syncDueAccounts } = require('./sync');
const safety = require('./safety');
const { getDailyHistory } = require('./history');
const hourlyData = require('./hourly');

let hourlyCollectRunning = false;

// Daily-cache freshness for the safety rails: the freeze envelope reads
// daily closes from the cache, so active assets get one top-up per day
// (mostly exchange-sourced — near-zero CG quota).
async function refreshDailyCacheDue() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'safety_history_at'").get();
  if (row && Date.now() - Number(row.value) < 22 * 3600e3) return false;
  const ids = db
    .prepare("SELECT DISTINCT coingecko_id FROM assets WHERE target_pct > 0 AND is_index = 0 AND coingecko_id NOT IN ('usd','fiat:usd')")
    .all();
  for (const { coingecko_id } of ids) {
    try {
      await getDailyHistory(coingecko_id, 730);
    } catch (err) {
      console.error(`daily refresh failed for ${coingecko_id}:`, err.message);
    }
  }
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('safety_history_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(String(Date.now()));
  return true;
}

async function runSafetyChecks() {
  await refreshDailyCacheDue();
  // Freeze evaluation is pure DB reads (cache + last polled price);
  // depeg needs one exchange ticker round for held pegged coins.
  const transitions = [...safety.evaluateFreezes(), ...(await safety.evaluateDepegs())];
  for (const t of transitions) {
    const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(t.asset.profile_id);
    if (!profile) continue;
    const text = safety.noticeText(t);
    console.log(`[safety] ${text}`);
    await sendSafetyNotice(profile, text);
  }
}

// Ticks once a minute; each profile decides for itself whether it is due
// based on its own poll_minutes, and each linked exchange account based on
// its own sync_minutes. Failures (network, rate limit) are logged and
// retried on the next tick.
function startScheduler() {
  const tick = async () => {
    try {
      // Exchange syncs run before the poll so freshly-applied fills are
      // re-valued (and possibly re-alerted) in the same tick.
      const synced = await syncDueAccounts();
      const changed = synced.filter(
        (s) => s.summary.tradesApplied > 0 || s.summary.autoAppliedFlows > 0
      );
      for (const s of changed) {
        await pollProfiles({ force: true, profileId: s.profileId }).catch(() => {});
        console.log(
          `[${new Date().toISOString()}] synced account ${s.accountId}: ` +
            `${s.summary.tradesApplied} trade(s), ${s.summary.newPendingFlows} pending flow(s)`
        );
      }
    } catch (err) {
      console.error('Exchange sync tick failed:', err.message);
    }
    try {
      const { polled, events } = await pollProfiles();
      if (polled > 0) {
        console.log(`[${new Date().toISOString()}] polled ${polled} profile(s), ${events.length} notification(s)`);
      }
      if (events.length > 0) await sendAlertEvents(events);
    } catch (err) {
      console.error('Poll failed:', err.message);
    }
    try {
      // Safety rails run after the poll so freeze/crash checks see the
      // freshest polled prices.
      await runSafetyChecks();
    } catch (err) {
      console.error('Safety check failed:', err.message);
    }
    // Hourly cache top-ups, ~once a day per asset through each one's
    // persisted source. Guarded so a slow first backfill can't overlap
    // itself across ticks.
    if (!hourlyCollectRunning && hourlyData.collectDue()) {
      hourlyCollectRunning = true;
      hourlyData
        .collectHourly()
        .then((r) => {
          const filled = r.filter((x) => x.rows > 0);
          if (filled.length > 0) {
            console.log(
              `[${new Date().toISOString()}] hourly top-up: ` +
                filled.map((x) => `${x.id}+${x.rows}(${x.source})`).join(' ')
            );
          }
        })
        .catch((err) => console.error('Hourly collect failed:', err.message))
        .finally(() => {
          hourlyCollectRunning = false;
        });
    }
  };
  tick();
  return setInterval(tick, 60_000);
}

module.exports = { startScheduler };
