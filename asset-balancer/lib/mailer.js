const nodemailer = require('nodemailer');
const config = require('./config');
const db = require('./db');

let transporter = null;
if (config.smtp.host && config.smtp.user) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
    tls: config.smtp.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
  });
}

function emailConfigured() {
  return Boolean(transporter && config.alertEmailTo);
}

function fmt(n, digits = 6) {
  return Number(n).toPrecision(digits);
}

// Trade quantities need enough precision to be executable but shouldn't be
// 15-digit noise.
function fmtQty(n) {
  return Number(Number(n).toPrecision(8)).toString();
}

async function sendAlerts(alerts) {
  if (alerts.length === 0) return;

  const lines = alerts.map((al) => {
    const sym = al.asset.symbol.toUpperCase();
    const idx = al.profile.index_asset.toUpperCase();
    const state = al.driftRelPct > 0 ? 'overweight' : 'underweight';
    return [
      `Profile "${al.profile.name}": ${sym} is ${state}`,
      `  actual ${al.actualPct.toFixed(2)}% of pool vs target ${al.targetPct}% ` +
        `(drift ${al.driftRelPct >= 0 ? '+' : ''}${al.driftRelPct.toFixed(1)}% of target, threshold ${al.profile.threshold_pct}%)`,
      `  -> ${al.action} ${fmtQty(al.quantity)} ${sym}  (≈ ${fmt(al.indexAmount)} ${idx})`,
    ].join('\n');
  });

  const text =
    `Rebalance signal${alerts.length > 1 ? 's' : ''} — market orders, sized at current prices:\n\n` +
    lines.join('\n\n') +
    '\n\nAfter trading, take a screenshot of your balances and import it in the balancer to set the new quantities.';

  const logStmt = db.prepare(
    'INSERT INTO alert_log (profile_id, message, ts, emailed) VALUES (?, ?, ?, ?)'
  );

  let emailed = 0;
  if (emailConfigured()) {
    try {
      await transporter.sendMail({
        from: config.alertEmailFrom || config.smtp.user,
        to: config.alertEmailTo,
        subject: `[Asset Balancer] ${alerts.length} rebalance trade${alerts.length > 1 ? 's' : ''} to make`,
        text,
      });
      emailed = 1;
    } catch (err) {
      console.error('Failed to send alert email:', err.message);
    }
  } else {
    console.warn('Email not configured; alert logged only.');
  }

  const ts = Date.now();
  for (let i = 0; i < alerts.length; i++) {
    logStmt.run(alerts[i].profile.id, lines[i], ts, emailed);
  }
}

async function sendTestEmail() {
  if (!emailConfigured()) throw new Error('SMTP or ALERT_EMAIL_TO not configured');
  await transporter.sendMail({
    from: config.alertEmailFrom || config.smtp.user,
    to: config.alertEmailTo,
    subject: '[Asset Balancer] Test email',
    text: 'Email delivery from the asset balancer is working.',
  });
}

module.exports = { sendAlerts, sendTestEmail, emailConfigured };
