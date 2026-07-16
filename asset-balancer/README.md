# Asset Balancer

A manual asset-rebalancing watcher with a web UI. You define **profiles** —
each one a flat pool of assets priced against an **index asset** (USD, BTC,
anything CoinGecko knows) — and give every asset a **target percentage** of
the pool, totalling 100. The app polls market prices on a schedule (default
every 15 minutes) and emails you the exact corrective market trades when an
asset's actual share drifts too far from its target. The app never touches
your funds: you execute the trades on the exchange, screenshot the balances,
and import the screenshot to set the new quantities.

## How the math works

- Every asset is valued in index-asset terms (USD price ÷ the index's USD
  price). One asset per profile can be checkmarked as the **tethered index
  asset** (e.g. USDT on a USD index): it is pinned to exactly 1, small
  market variation deliberately ignored.
- **Drift is relative to target.** Actual share = asset value ÷ pool total.
  Drift = (actual% − target%) / target%. The profile threshold applies to
  that relative drift, so a 10% threshold on a 56% target trips at ±5.6
  absolute points.
- **Alerts carry trades.** When an asset crosses its threshold, the email
  says exactly what to do — BUY/SELL, quantity in asset units, and the
  index-asset equivalent — sized to bring *that* asset back to its target.
  Assets inside their band are left alone (dust trades lose money to spread
  and slippage). Market orders; no slippage math.
- The **tethered index asset never gets a trade recommendation** and never
  triggers an alert alone — at least one base asset must breach. Its
  over/underweight amount is included in alert emails as a note only.
- An asset alerts once and re-arms after it converges back under half its
  threshold, or when new targets are set.
- **Notification state machine** (per profile): after an automatic alert the
  profile goes quiet (prices still update). Hitting **Poll now** re-checks —
  still drifted → one more notification, then quiet until a **screenshot
  import** is applied (which re-arms for *new* hits only). Both quiet states
  auto re-arm after 12 hours; a manual poll while waiting for an upload
  restarts the clock.
- **Recipients are per profile**: a toggle turns alerts on/off, and each
  profile carries its own list of email addresses — no global fallback; with
  no recipients, alerts only appear in the on-screen log. Each recipient can
  optionally add a WhatsApp number + [CallMeBot](https://www.callmebot.com)
  API key to get a WhatsApp notice alongside the email (free personal-use
  gateway; the recipient self-authorizes once by WhatsApping "I allow
  callmebot to send me messages" to +34 644 91 07 79).
- **The currency basket** measures unit growth independent of prices:
  `basket = Σ (current units ÷ snapshot units) × target weight`. It starts
  at 1.00000000 when targets are set (unit snapshot taken) and rises above 1
  as rebalancing accumulates more units of the underlying assets. Changing
  targets ("Set new targets") re-snapshots and resets it to 1.
- Adding or removing funds while preserving the basket number is a v2
  feature; for now all quantity changes move the basket.

## Running it

```bash
cd asset-balancer
npm install
cp .env.example .env      # edit: password, SMTP creds, alert address
set -a; source .env; set +a
npm start                 # serves the UI and starts the poller
```

Open `http://localhost:3000` (or wherever you deploy it).

### Deploying on the buitendyk.ca VPS

`sudo bash deploy/install.sh` installs it as the `asset-balancer` systemd
unit on `127.0.0.1:8091` (config in `/etc/asset-balancer/env`); the portal's
nginx config (on the `website` branch) proxies
`https://www.buitendyk.ca/balancer/` to it behind the site's Basic Auth.
The frontend uses relative API URLs, so it works both at `/` and under the
`/balancer/` prefix. From a cloud session, deploy via the deploy-control
endpoint: `{"action":"run-script","script":"deploy-balancer.sh"}` — see
CLAUDE.md at the branch root.

### Email (Gmail)

Create an App Password (Google Account → Security → 2-Step Verification →
App passwords), then set `SMTP_USER` to your Gmail address and `SMTP_PASS`
to the app password. `npm run test-email` sends a test message.

### Alternative: external cron

If you'd rather not keep the server running for polling, `npm run poll`
performs one poll-and-alert cycle and exits — suitable for a system cron
every 15 minutes. The web UI still needs the server running to be usable.

## Screenshot import

With `ANTHROPIC_API_KEY` set, each profile gains an **Import from
screenshot** section: upload (or photograph) a trading app's balances
screen and Claude vision (`claude-opus-4-8` with structured outputs)
extracts each holding — symbol, quantity, value. The app matches them to
the profile's assets by symbol and shows a preview: existing assets get a
quantity update, unknown ones offer an "add as new asset" with CoinGecko
candidates, and you tick what to apply. Costs roughly a cent or two per
import. Without the key the section is hidden and the endpoint returns 503.

## Pricing

Prices come from CoinGecko's free API (no key required; an optional demo key
in `COINGECKO_API_KEY` raises rate limits). The provider lives in
`lib/pricing.js` behind two functions (`fetchUsdPrices`, `searchCoins`), so a
stock/ETF source can be added later without touching the engine.

## Layout

```
server.js          Express app: auth, REST API, static frontend
lib/config.js      env-driven configuration
lib/db.js          SQLite schema (better-sqlite3, WAL)
lib/pricing.js     CoinGecko price + search provider
lib/balancer.js    polling engine, drift math, alert state
lib/mailer.js      nodemailer alerts + alert log
lib/scheduler.js   1-minute tick; profiles poll on their own cadence
public/            vanilla JS single-page UI
scripts/           poll-once and test-email utilities
data/              SQLite database (created at runtime, git-ignored)
```

## API sketch

All routes under `/api`, JSON, cookie-auth via `POST /api/login`.

- `GET /profiles`, `POST /profiles`, `PATCH|DELETE /profiles/:id`
- `GET /profiles/:id/state` — assets with allocation/drift, totals, basket,
  snapshots, alert log
- `POST /profiles/:id/assets`, `PATCH /assets/:id` (quantity, is_index),
  `DELETE /assets/:id`
- `POST /profiles/:id/targets` — set new target allocations (must total 100;
  resets the currency basket)
- `POST /profiles/:id/poll` — poll now
- `POST /profiles/:id/import-screenshot` — parse a balances screenshot
- `GET /search-coins?q=...`, `GET /assets/:id/history`
- `POST /test-email`
