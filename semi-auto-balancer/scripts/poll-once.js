// Runs one poll cycle and exits. Useful for testing or for running the
// balancer from an external cron instead of the built-in scheduler.
const { pollProfiles } = require('../lib/balancer');
const { sendAlertEvents } = require('../lib/mailer');

(async () => {
  const { polled, events } = await pollProfiles({ force: true });
  console.log(`Polled ${polled} profile(s); ${events.length} notification(s).`);
  if (events.length > 0) await sendAlertEvents(events);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
