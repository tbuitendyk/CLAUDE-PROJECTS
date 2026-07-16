const nodemailer = require('nodemailer');
const config = require('./config');
const db = require('./db');
const { sendWhatsApp } = require('./whatsapp');

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
  return Boolean(transporter);
}

// All balancer mail presents as "Manual Asset Balancer", regardless of how
// the env spells the from address (bare, or "Name <addr>").
function fromHeader() {
  const raw = (config.alertEmailFrom || config.smtp.user || '').trim();
  const m = raw.match(/<([^>]+)>/);
  return { name: 'Manual Asset Balancer', address: m ? m[1] : raw };
}

function fmt(n, digits = 6) {
  return Number(n).toPrecision(digits);
}

// Trade quantities need enough precision to be executable but shouldn't be
// 15-digit noise.
function fmtQty(n) {
  return Number(Number(n).toPrecision(8)).toString();
}

function parseRecipients(profile) {
  try {
    const list = JSON.parse(profile.recipients || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function buildText(event) {
  const { profile, alerts, indexNote } = event;
  const idx = profile.index_asset.toUpperCase();

  const lines = alerts.map((al) => {
    const sym = al.asset.symbol.toUpperCase();
    const state = al.driftRelPct > 0 ? 'overweight' : 'underweight';
    return [
      `${sym} is ${state}`,
      `  actual ${al.actualPct.toFixed(2)}% of pool vs target ${al.targetPct}% ` +
        `(drift ${al.driftRelPct >= 0 ? '+' : ''}${al.driftRelPct.toFixed(1)}% of target, threshold ${profile.threshold_pct}%)`,
      `  -> ${al.action} ${fmtQty(al.quantity)} ${sym}  (≈ ${fmt(al.indexAmount)} ${idx})`,
    ].join('\n');
  });

  let noteText = '';
  if (indexNote) {
    const dir = indexNote.deltaIndex >= 0 ? 'overweight' : 'underweight';
    noteText =
      `\n\nNote: index asset ${indexNote.symbol.toUpperCase()} is ${dir} by ` +
      `${fmt(Math.abs(indexNote.deltaIndex))} ${idx} ` +
      `(actual ${indexNote.actualPct.toFixed(2)}% vs target ${indexNote.targetPct}%) — no trade recommended; ` +
      `it absorbs the residual from the trades above.`;
  }

  return (
    `Profile "${profile.name}" — rebalance trade${alerts.length > 1 ? 's' : ''}, market orders sized at current prices:\n\n` +
    lines.join('\n\n') +
    noteText +
    '\n\nAfter trading, take a screenshot of your balances and import it in the balancer to set the new quantities.'
  );
}

// Delivers one notification event per profile: on-screen alert log always;
// email + WhatsApp per the profile's own recipient list (no global fallback).
async function sendAlertEvents(events) {
  const logStmt = db.prepare(
    'INSERT INTO alert_log (profile_id, message, ts, emailed) VALUES (?, ?, ?, ?)'
  );

  for (const event of events) {
    const { profile, alerts } = event;
    if (alerts.length === 0) continue;
    const text = buildText(event);
    const recipients = profile.alerts_enabled ? parseRecipients(profile) : [];
    const emails = recipients.map((r) => (r.email || '').trim()).filter(Boolean);

    let emailed = 0;
    if (emails.length > 0 && emailConfigured()) {
      try {
        await transporter.sendMail({
          from: fromHeader(),
          to: emails.join(', '),
          subject: `[Asset Balancer] ${profile.name}: ${alerts.length} rebalance trade${alerts.length > 1 ? 's' : ''} to make`,
          text,
        });
        emailed = 1;
      } catch (err) {
        console.error(`Alert email failed for profile ${profile.id}:`, err.message);
      }
    }

    // WhatsApp notices ride along for recipients that configured them.
    for (const r of recipients) {
      if (!r.whatsapp_phone || !r.whatsapp_key) continue;
      const notice =
        `Asset Balancer: ${alerts.length} rebalance trade${alerts.length > 1 ? 's' : ''} needed on "${profile.name}"` +
        (r.email ? ' — details in your email.' : ` — ${alerts.map((a) => `${a.action} ${a.asset.symbol.toUpperCase()}`).join(', ')}.`);
      try {
        await sendWhatsApp(r.whatsapp_phone, r.whatsapp_key, notice);
      } catch (err) {
        console.error(`WhatsApp notice failed for profile ${profile.id}:`, err.message);
        // Surface the failure in the on-screen alert log so a dead key or
        // wrong phone format is visible without shell diagnostics.
        logStmt.run(
          profile.id,
          `WhatsApp notice to ${r.whatsapp_phone} FAILED: ${err.message}`,
          Date.now(),
          0
        );
      }
    }

    logStmt.run(profile.id, text, Date.now(), emailed);
  }
}

async function sendTestEmail() {
  if (!emailConfigured() || !config.alertEmailTo) {
    throw new Error('SMTP or ALERT_EMAIL_TO not configured');
  }
  await transporter.sendMail({
    from: fromHeader(),
    to: config.alertEmailTo,
    subject: '[Asset Balancer] Test email',
    text: 'Email delivery from the asset balancer is working.',
  });
}

module.exports = { sendAlertEvents, sendTestEmail, emailConfigured, buildText, fromHeader };
