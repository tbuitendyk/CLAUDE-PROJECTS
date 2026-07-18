const nodemailer = require('nodemailer');
const config = require('./config');
const db = require('./db');
const { sendTelegram, telegramConfigured } = require('./telegram');
const { indexLabelForProfile } = require('./balancer');

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

// All balancer mail presents as "Semi-Auto Balancer", regardless of how
// the env spells the from address (bare, or "Name <addr>").
function fromHeader() {
  const raw = (config.alertEmailFrom || config.smtp.user || '').trim();
  const m = raw.match(/<([^>]+)>/);
  return { name: 'Semi-Auto Balancer', address: m ? m[1] : raw };
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
  const idx = indexLabelForProfile(profile.id);

  const lines = alerts.map((al) => {
    const sym = al.asset.symbol.toUpperCase();
    const state = al.driftRelPct > 0 ? 'overweight' : 'underweight';
    return [
      `${sym} is ${state}`,
      `  actual ${al.actualPct.toFixed(2)}% of pool vs target ${al.targetPct}% ` +
        `(drift ${al.driftRelPct >= 0 ? '+' : ''}${al.driftRelPct.toFixed(1)}% of target, trigger ±${al.thresholdPct != null ? al.thresholdPct.toFixed(1) : profile.threshold_pct}% ` +
        `≈ a ${profile.threshold_pct}% price move)`,
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

  // With a linked read-only exchange account the loop closes itself: the
  // next sync picks up the fills and re-arms. Otherwise, screenshot import.
  const hasExchange = db
    .prepare('SELECT 1 FROM exchange_accounts WHERE profile_id = ? AND enabled = 1')
    .get(profile.id);
  const followUp = hasExchange
    ? 'After trading, nothing else to do — the next exchange sync picks up the fills, updates quantities, and re-arms notifications.'
    : 'After trading, take a screenshot of your balances and import it in the balancer to set the new quantities.';

  return (
    `Profile "${profile.name}" — rebalance trade${alerts.length > 1 ? 's' : ''}, market orders sized at current prices:\n\n` +
    lines.join('\n\n') +
    noteText +
    '\n\n' +
    followUp
  );
}

// Delivers one notification event per profile: on-screen alert log always;
// email + Telegram per the profile's own recipient list (no global fallback).
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
          // Timestamped so mail apps never thread new alerts into an old
          // conversation (threads display the original sender's name).
          subject:
            `[Semi-Auto Balancer] ${profile.name}: ${alerts.length} rebalance trade${alerts.length > 1 ? 's' : ''} to make ` +
            `(${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
          text,
        });
        emailed = 1;
      } catch (err) {
        console.error(`Alert email failed for profile ${profile.id}:`, err.message);
      }
    }

    // Telegram notices ride along for recipients that configured a chat id.
    for (const r of recipients) {
      if (!r.telegram_chat_id) continue;
      const notice =
        `Semi-Auto Balancer: ${alerts.length} rebalance trade${alerts.length > 1 ? 's' : ''} needed on "${profile.name}"` +
        (r.email ? ' — details in your email.' : ` — ${alerts.map((a) => `${a.action} ${a.asset.symbol.toUpperCase()}`).join(', ')}.`);
      try {
        if (!telegramConfigured()) throw new Error('bot token not configured');
        await sendTelegram(r.telegram_chat_id, notice);
      } catch (err) {
        console.error(`Telegram notice failed for profile ${profile.id}:`, err.message);
        // Surface the failure in the on-screen alert log so a dead token or
        // wrong chat id is visible without shell diagnostics.
        logStmt.run(
          profile.id,
          `Telegram notice to chat ${r.telegram_chat_id} FAILED: ${err.message}`,
          Date.now(),
          0
        );
      }
    }

    logStmt.run(profile.id, text, Date.now(), emailed);
  }
}

// Full-profile status report, sent on demand regardless of breach state —
// all balances, values, allocations, and the currency basket. Doubles as a
// live test of the whole comms path (email + Telegram).
async function sendStatusReport(profile, view) {
  const { assets, totals } = view;
  const idx = indexLabelForProfile(profile.id);
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const money = (n) =>
    n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const lines = [];
  lines.push(`Profile "${profile.name}" status — ${ts} UTC`);
  lines.push('');
  if (totals.basket != null) {
    const unitPct = (totals.basket - 1) * 100;
    lines.push(
      `Currency basket: ${totals.basket.toFixed(8)} (${unitPct >= 0 ? '+' : ''}${unitPct.toFixed(4)}% units)`
    );
  } else {
    lines.push('Currency basket: — (no targets set yet)');
  }
  lines.push(
    `Value (${idx}): ${fmt(totals.totalRel)}` +
      (totals.growthPct != null
        ? ` (${totals.growthPct >= 0 ? '+' : ''}${totals.growthPct.toFixed(2)}% since start)`
        : '') +
      ` · $${money(totals.totalUsd)} USD`
  );
  const breached = assets.filter((a) => a.breached && !a.is_index).length;
  lines.push(
    `Notifications: ${profile.alerts_enabled ? 'enabled' : 'DISABLED'} · state ${profile.notify_state || 'armed'} · ` +
      `sensitivity ~${profile.threshold_pct}% price move · ${breached} asset(s) over trigger`
  );
  lines.push('');
  lines.push('Assets:');
  const ordered = [...assets].sort(
    (a, b) => (b.is_index ? 1 : 0) - (a.is_index ? 1 : 0) || (b.valueUsd || 0) - (a.valueUsd || 0)
  );
  for (const a of ordered) {
    const sym = a.symbol.toUpperCase() + (a.is_index ? ' (index)' : '');
    const drift =
      a.driftRelPct != null
        ? `${a.driftRelPct >= 0 ? '+' : ''}${a.driftRelPct.toFixed(1)}%${a.breached ? ' OVER' : ''}`
        : '—';
    lines.push(
      `- ${sym}: qty ${fmtQty(a.quantity)} · value $${money(a.valueUsd)}` +
        (a.actualPct != null ? ` (${a.actualPct.toFixed(2)}% of pool)` : '') +
        ` · target ${a.target_pct || 0}% · drift ${drift}`
    );
  }
  const text = lines.join('\n');

  const recipients = parseRecipients(profile);
  const emails = recipients.map((r) => (r.email || '').trim()).filter(Boolean);
  const result = { emailedTo: [], telegramOk: 0, telegramFailed: [], errors: [] };

  if (emails.length > 0 && emailConfigured()) {
    try {
      await transporter.sendMail({
        from: fromHeader(),
        to: emails.join(', '),
        subject: `[Semi-Auto Balancer] ${profile.name} status (${ts} UTC)`,
        text,
      });
      result.emailedTo = emails;
    } catch (err) {
      result.errors.push(`email: ${err.message}`);
    }
  } else if (emails.length > 0) {
    result.errors.push('email: SMTP not configured on the server');
  }

  for (const r of recipients) {
    if (!r.telegram_chat_id) continue;
    // No dollar balances on Telegram -- just the (unitless) basket ratio.
    const notice =
      `Semi-Auto Balancer: status report for "${profile.name}" — basket ` +
      `${totals.basket != null ? totals.basket.toFixed(8) : 'n/a'}.` +
      (r.email ? ' Full report emailed to you.' : '');
    try {
      if (!telegramConfigured()) throw new Error('bot token not configured');
      await sendTelegram(r.telegram_chat_id, notice);
      result.telegramOk++;
    } catch (err) {
      result.telegramFailed.push(r.telegram_chat_id);
      result.errors.push(`Telegram ${r.telegram_chat_id}: ${err.message}`);
    }
  }

  db.prepare('INSERT INTO alert_log (profile_id, message, ts, emailed) VALUES (?, ?, ?, ?)').run(
    profile.id,
    `Status report requested — email to [${result.emailedTo.join(', ') || 'none'}], ` +
      `Telegram ok ${result.telegramOk}, failed ${result.telegramFailed.length}` +
      (result.errors.length ? ` | ${result.errors.join(' | ')}` : ''),
    Date.now(),
    result.emailedTo.length > 0 ? 1 : 0
  );
  return result;
}

async function sendTestEmail() {
  if (!emailConfigured() || !config.alertEmailTo) {
    throw new Error('SMTP or ALERT_EMAIL_TO not configured');
  }
  await transporter.sendMail({
    from: fromHeader(),
    to: config.alertEmailTo,
    subject: `[Semi-Auto Balancer] Test email (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
    text: 'Email delivery from the semi-auto balancer is working.',
  });
}

module.exports = {
  sendAlertEvents,
  sendStatusReport,
  sendTestEmail,
  emailConfigured,
  buildText,
  fromHeader,
};
