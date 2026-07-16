# Asset Balancer

A manual asset-rebalancing watcher with a web UI. You define **profiles** —
each one a group of assets priced against an **index asset** (USD, BTC,
anything CoinGecko knows) — and organize those assets into **sets**. The app
polls market prices on a schedule (default every 15 minutes), keeps a history
of each asset's value relative to the index, and when any two assets in the
same set drift apart by more than the profile's **threshold percentage**
(relative to their recorded baselines), it emails you a rebalance signal.

You then rebalance manually — the app never touches your funds — and click
**"Rebalanced"** to accept current prices as the new baseline.

## How the math works

- Every asset's *relative price* = its USD price ÷ the index asset's USD
  price. (If the index is `usd`, relative price is just the USD price.)
- When an asset is first added (or after a rebalance), its current relative
  price is stored as its **baseline**.
- Each poll, for every pair of assets `A, B` in the same set the app computes:

  ```
  divergence = (relA / baselineA) / (relB / baselineB) − 1
  ```

  i.e. how far A and B have drifted *apart* since the baseline. If
  `|divergence| ≥ threshold%`, that's a rebalance signal → email.
- Signals don't repeat every poll: a pair alerts once and re-arms only after
  it converges back under half the threshold, or after you reset baselines.

## Running it

```bash
cd asset-balancer
npm install
cp .env.example .env      # edit: password, SMTP creds, alert address
set -a; source .env; set +a
npm start                 # serves the UI and starts the poller
```

Open `http://localhost:3000` (or wherever you deploy it). To link it from
buitendyk.ca, either host it on a subdomain (e.g. `balancer.buitendyk.ca`
behind your reverse proxy) or reverse-proxy a path to it.

### Email (Gmail)

Create an App Password (Google Account → Security → 2-Step Verification →
App passwords), then set `SMTP_USER` to your Gmail address and `SMTP_PASS`
to the app password. `npm run test-email` sends a test message.

### Alternative: external cron

If you'd rather not keep the server running for polling, `npm run poll`
performs one poll-and-alert cycle and exits — suitable for a system cron
every 15 minutes. The web UI still needs the server running to be usable.

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
- `GET /profiles/:id/state` — assets + latest prices + sets + alert log
- `POST /profiles/:id/assets`, `DELETE /assets/:id`
- `POST /profiles/:id/sets`, `PATCH|DELETE /sets/:id`
- `POST /profiles/:id/poll` — poll now
- `POST /profiles/:id/rebalance` — reset baselines (optional `set_id`)
- `GET /search-coins?q=...`, `GET /assets/:id/history`
- `POST /test-email`
