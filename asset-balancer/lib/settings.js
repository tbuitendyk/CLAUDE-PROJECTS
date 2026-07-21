const db = require('./db');

// Master service switch. OFF = no scheduled polls, no manual polls, no
// notifications — the web UI stays up (so the switch can be flipped back).
// Missing row = ON, so existing installs keep behaving until told otherwise.
function serviceOn() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'service_on'").get();
  return row ? row.value === '1' : true;
}

function setServiceOn(on) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('service_on', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(on ? '1' : '0');
  return serviceOn();
}

module.exports = { serviceOn, setServiceOn };
