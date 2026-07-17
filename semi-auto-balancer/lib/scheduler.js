const { pollProfiles } = require('./balancer');
const { sendAlertEvents } = require('./mailer');
const { syncDueAccounts } = require('./sync');

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
  };
  tick();
  return setInterval(tick, 60_000);
}

module.exports = { startScheduler };
