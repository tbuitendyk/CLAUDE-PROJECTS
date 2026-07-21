const { pollProfiles } = require('./balancer');
const { serviceOn } = require('./settings');
const { sendAlertEvents } = require('./mailer');

// Ticks once a minute; each profile decides for itself whether it is due
// based on its own poll_minutes. Failures (network, rate limit) are logged
// and retried on the next tick.
function startScheduler() {
  let wasOn = null;
  const tick = async () => {
    try {
      const on = serviceOn();
      if (on !== wasOn) {
        if (on === false) console.log(`[${new Date().toISOString()}] service OFF — polling and notifications suspended`);
        else if (wasOn === false) console.log(`[${new Date().toISOString()}] service ON — polling resumed`);
        wasOn = on;
      }
      if (!on) return;
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
