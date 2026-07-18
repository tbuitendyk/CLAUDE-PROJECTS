const path = require('path');

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  port: num(process.env.PORT, 3000),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'semi-auto-balancer.sqlite'),

  // UI/API password. If empty, the app runs without authentication.
  appPassword: process.env.APP_PASSWORD || '',
  // Used to sign session cookies. Falls back to the password so sessions
  // survive restarts without extra setup.
  appSecret: process.env.APP_SECRET || process.env.APP_PASSWORD || 'semi-auto-balancer',

  // Default minutes between price polls for new profiles.
  defaultPollMinutes: num(process.env.POLL_MINUTES, 15),

  // Where alert emails go.
  alertEmailTo: process.env.ALERT_EMAIL_TO || '',
  alertEmailFrom: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER || '',

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    // For internal mail servers with self-signed certs (e.g. the iRedMail VM
    // reached over the host-only network) -- same trust decision the
    // mail-test.sh script makes.
    allowSelfSigned: process.env.SMTP_ALLOW_SELF_SIGNED === 'true',
  },

  coingeckoBase: process.env.COINGECKO_BASE || 'https://api.coingecko.com/api/v3',
  coingeckoApiKey: process.env.COINGECKO_API_KEY || '',

  // Phase 1.5: price held assets and top up daily history from the exchanges'
  // public market data (Kraken ticker/OHLC, Bitso fiat books), reserving
  // CoinGecko for fallback + the scanner. 'off' forces CoinGecko-only
  // (tests set this for determinism).
  exchangeMarketData: process.env.EXCHANGE_MARKET_DATA !== 'off',

  // Enables the screenshot-import feature (Claude vision).
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  // Telegram bot token override. Normally the token is entered in the UI and
  // stored in the settings table; set this only to pin it from the env.
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
};
