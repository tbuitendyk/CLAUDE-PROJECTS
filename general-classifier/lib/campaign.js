// CAMPAIGN NAME (owner order, 2026-08-04): a high-level analysis name the
// owner sets once; every run launched while it is set carries it, so the
// saved-runs list shows at a glance which runs belong to the same cycle of
// tests. Stored on disk so it survives reloads and restarts; cleared by
// setting it empty.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'campaign.json');

// Letters, numbers, spaces, dashes, dots; trimmed; max 40 chars. Anything
// else is refused loudly — the name rides in ids' company and in every list.
function sanitizeCampaign(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return '';
  if (s.length > 40) throw new Error('campaign name: 40 characters at most');
  if (!/^[A-Za-z0-9 ._-]+$/.test(s)) {
    throw new Error('campaign name: letters, numbers, spaces, dots and dashes only');
  }
  return s;
}

function getCampaign() {
  try {
    const v = JSON.parse(fs.readFileSync(FILE, 'utf8')).name;
    return typeof v === 'string' && v ? v : '';
  } catch {
    return '';
  }
}

function setCampaign(raw) {
  const name = sanitizeCampaign(raw);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify({ name, setAt: new Date().toISOString() }));
  fs.renameSync(tmp, FILE);
  return name;
}

module.exports = { sanitizeCampaign, getCampaign, setCampaign };
