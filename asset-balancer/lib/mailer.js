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
  });
}

function emailConfigured() {
  return Boolean(transporter && config.alertEmailTo);
}

function fmt(n, digits = 6) {
  return Number(n).toPrecision(digits);
}

async function sendAlerts(alerts) {
  if (alerts.length === 0) return;

  const lines = alerts.map((al) => {
    const dir = al.divergencePct > 0 ? 'gained on' : 'lost against';
    return [
      `Profile "${al.profile.name}" / set "${al.set.name}":`,
      `  ${al.a.symbol.toUpperCase()} has ${dir} ${al.b.symbol.toUpperCase()} by ${Math.abs(al.divergencePct).toFixed(2)}% since baseline`,
      `  (threshold ${al.profile.threshold_pct}%, index: ${al.profile.index_asset})`,
      `  ${al.a.symbol.toUpperCase()}: baseline ${fmt(al.a.baseline_rel)} -> now ${fmt(al.relA)}`,
      `  ${al.b.symbol.toUpperCase()}: baseline ${fmt(al.b.baseline_rel)} -> now ${fmt(al.relB)}`,
    ].join('\n');
  });

  const text =
    `Rebalance signal${alerts.length > 1 ? 's' : ''}:\n\n` +
    lines.join('\n\n') +
    '\n\nOpen the balancer, rebalance manually, then hit "Rebalanced" to reset baselines.';

  const logStmt = db.prepare(
    'INSERT INTO alert_log (profile_id, set_id, message, ts, emailed) VALUES (?, ?, ?, ?, ?)'
  );

  let emailed = 0;
  if (emailConfigured()) {
    try {
      await transporter.sendMail({
        from: config.alertEmailFrom || config.smtp.user,
        to: config.alertEmailTo,
        subject: `[Asset Balancer] ${alerts.length} rebalance signal${alerts.length > 1 ? 's' : ''}`,
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
    logStmt.run(alerts[i].profile.id, alerts[i].set.id, lines[i], ts, emailed);
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
