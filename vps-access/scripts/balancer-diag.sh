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

if (process.env.MODE === 'watest') {
  (async () => {
    console.log('== live CallMeBot test ==');
    let sent = 0;
    for (const p of profiles) {
      let recipients = [];
      try { recipients = JSON.parse(p.recipients || '[]'); } catch {}
      for (const r of recipients) {
        if (!r.whatsapp_phone || !r.whatsapp_key) continue;
        sent++;
        const url = 'https://api.callmebot.com/whatsapp.php' +
          `?phone=${encodeURIComponent(r.whatsapp_phone)}` +
          `&text=${encodeURIComponent('Asset Balancer: WhatsApp test notice for profile "' + p.name + '"')}` +
          `&apikey=${encodeURIComponent(r.whatsapp_key)}`;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
          const body = (await res.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          console.log(`profile ${p.id} -> ${r.whatsapp_phone}: HTTP ${res.status} | ${body.slice(0, 300)}`);
        } catch (e) {
          console.log(`profile ${p.id} -> ${r.whatsapp_phone}: FAILED ${e.message}`);
        }
      }
    }
    if (!sent) console.log('no recipients have WhatsApp configured -- nothing to test');
  })();
}
JS
