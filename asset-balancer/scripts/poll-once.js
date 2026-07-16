// Runs one poll cycle and exits. Useful for testing or for running the
// balancer from an external cron instead of the built-in scheduler.
const { pollProfiles } = require('../lib/balancer');
const { sendAlerts } = require('../lib/mailer');

(async () => {
  const { polled, alerts } = await pollProfiles({ force: true });
  console.log(`Polled ${polled} profile(s); ${alerts.length} alert(s).`);
  if (alerts.length > 0) await sendAlerts(alerts);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
