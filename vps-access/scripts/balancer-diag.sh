#!/usr/bin/env bash
# balancer-diag.sh -- diagnostics for the asset balancer notification
# pipeline. Read-only by default: notification-related service log lines,
# per-profile notification state + recipients (WhatsApp keys redacted), and
# recent alert-log rows. With arg "watest" it additionally sends ONE test
# WhatsApp notice through CallMeBot to every recipient that has WhatsApp
# configured, printing the gateway's raw response (this is the only
# non-read-only mode). Runs as root via run-script.
set -euo pipefail
MODE="${1:-diag}"

echo "== asset-balancer service =="
systemctl --no-pager --lines 0 status asset-balancer | head -5 || true
echo
echo "== notification-related log lines (last 48h) =="
journalctl -u asset-balancer --since "48 hours ago" --no-pager 2>/dev/null \
  | grep -iE 'whatsapp|alert|notification|failed|error' | tail -n 40 || echo "(none)"
echo

cd /opt/asset-balancer
MODE="$MODE" node <<'JS'
const db = require('better-sqlite3')('/opt/asset-balancer/data/balancer.sqlite');
const profiles = db.prepare(
  'SELECT id,name,alerts_enabled,notify_state,notify_state_at,last_polled_at,threshold_pct,recipients FROM profiles'
).all();
console.log('== profiles ==');
for (const p of profiles) {
  let recipients = [];
  try { recipients = JSON.parse(p.recipients || '[]'); } catch {}
  console.log(JSON.stringify({
    id: p.id, name: p.name,
    alerts_enabled: p.alerts_enabled,
    notify_state: p.notify_state,
    notify_state_at: p.notify_state_at ? new Date(p.notify_state_at).toISOString() : null,
    last_polled_at: p.last_polled_at ? new Date(p.last_polled_at).toISOString() : null,
    threshold_pct: p.threshold_pct,
    recipients: recipients.map((r) => ({
      email: r.email,
      whatsapp_phone: r.whatsapp_phone || '(none)',
      whatsapp_key: r.whatsapp_key ? '***' + String(r.whatsapp_key).slice(-3) : '(none)',
    })),
  }, null, 1));
}
console.log('== active alloc_alerts ==', db.prepare('SELECT COUNT(*) c FROM alloc_alerts').get().c);
console.log('== alert_log (last 5) ==');
for (const a of db.prepare('SELECT ts,emailed,message FROM alert_log ORDER BY ts DESC LIMIT 5').all()) {
  console.log(new Date(a.ts).toISOString(), 'emailed=' + a.emailed, '|', a.message.split('\n')[0]);
}

async function probe(phone, key, label) {
  const url = 'https://api.callmebot.com/whatsapp.php' +
    `?phone=${encodeURIComponent(phone)}` +
    `&text=${encodeURIComponent('Asset Balancer: WhatsApp test (' + label + ')')}` +
    `&apikey=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const body = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`${label} [${phone}]: HTTP ${res.status} | ${body.slice(0, 220)}`);
  } catch (e) {
    console.log(`${label} [${phone}]: FAILED ${e.message}`);
  }
}

if (process.env.MODE === 'watest' || process.env.MODE === 'waformats') {
  (async () => {
    console.log('== live CallMeBot test (' + process.env.MODE + ') ==');
    let sent = 0;
    for (const p of profiles) {
      let recipients = [];
      try { recipients = JSON.parse(p.recipients || '[]'); } catch {}
      for (const r of recipients) {
        if (!r.whatsapp_phone || !r.whatsapp_key) continue;
        sent++;
        const stored = r.whatsapp_phone.trim();
        if (process.env.MODE === 'watest') {
          await probe(stored, r.whatsapp_key, 'as-stored');
          continue;
        }
        // waformats: try the common phone-format variants the key might be
        // bound to. Mexican numbers sometimes register as +521XXXXXXXXXX.
        const bare = stored.replace(/^\+/, '');
        const variants = new Map();
        variants.set('as-stored', stored);
        variants.set('no-plus', bare);
        if (/^\+?52(?!1)/.test(stored)) {
          variants.set('mx-521', '+521' + bare.slice(2));
          variants.set('mx-521-no-plus', '521' + bare.slice(2));
        }
        for (const [label, phone] of variants) {
          await probe(phone, r.whatsapp_key, label);
          await new Promise((res) => setTimeout(res, 2000)); // be polite to the free gateway
        }
      }
    }
    if (!sent) console.log('no recipients have WhatsApp configured -- nothing to test');
  })();
}
JS
