const db = require('./db');
const config = require('./config');

// Telegram notices via the official Bot API — the CallMeBot WhatsApp
// replacement (free, no queue, no sender number to protect, errors are real
// JSON). One bot serves every profile: the token lives in the settings table
// (entered in the UI, masked after save) with the TELEGRAM_BOT_TOKEN env as
// an override. Each recipient opens the bot and sends /start once; their
// numeric chat id is what the recipient rows store ("Find chat IDs" in the
// UI reads getUpdates so nobody digs for it by hand).

const API = 'https://api.telegram.org';

function getToken() {
  if (config.telegramBotToken) return config.telegramBotToken;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'telegram_bot_token'").get();
  return row && row.value ? row.value : '';
}

function telegramConfigured() {
  return Boolean(getToken());
}

async function call(method, body, tokenOverride) {
  const token = tokenOverride || getToken();
  if (!token) throw new Error('Telegram bot token not configured');
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => null);
  if (!json || !json.ok) {
    throw new Error(`Telegram ${method}: ${(json && json.description) || `HTTP ${res.status}`}`);
  }
  return json.result;
}

async function sendTelegram(chatId, text) {
  return call('sendMessage', { chat_id: chatId, text });
}

// Verify a token by asking Telegram who the bot is; store it only if valid.
// An empty token clears the setting (falls back to the env override, if any).
async function setToken(token) {
  const trimmed = String(token || '').trim();
  if (!trimmed) {
    db.prepare("DELETE FROM settings WHERE key = 'telegram_bot_token'").run();
    return { cleared: true, configured: telegramConfigured() };
  }
  const me = await call('getMe', {}, trimmed);
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('telegram_bot_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(trimmed);
  return { username: me.username, configured: true };
}

function botStatus() {
  const token = getToken();
  return {
    configured: Boolean(token),
    tokenMasked: token ? `…${token.slice(-4)}` : null,
    fromEnv: Boolean(config.telegramBotToken),
  };
}

// Chats that have messaged the bot recently (getUpdates keeps ~24h), newest
// first and deduped — the "Find chat IDs" picker. Recipients just open the
// bot, hit /start, and click their name in the UI.
async function recentChats() {
  const updates = await call('getUpdates', { allowed_updates: ['message'] });
  const byId = new Map();
  for (const u of updates || []) {
    const m = u.message;
    if (!m || !m.chat) continue;
    const c = m.chat;
    byId.set(c.id, {
      chat_id: String(c.id),
      name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.title || '(unnamed)',
      username: c.username || null,
      last_text: (m.text || '').slice(0, 40),
      ts: (m.date || 0) * 1000,
    });
  }
  return [...byId.values()].sort((a, b) => b.ts - a.ts);
}

module.exports = { sendTelegram, telegramConfigured, setToken, botStatus, recentChats };
