# CLAUDE.md — `semi-auto-balancer` branch (semi-auto balancer service)


## Working style (all sessions)

Confirm the task before building. **Don't assume a direction, write a pile of
code, and burn tokens producing the wrong thing.** When anything is ambiguous or
a detail is unstated, ask one quick clarifying question and get clear alignment
first — then do the work.

- If the task is genuinely unambiguous, just do it — no needless confirmation friction.
- If there's a real fork or a missing detail, check in briefly before spending effort.
- Verify facts instead of guessing (e.g., check an address/mailbox/branch exists
  rather than assuming its spelling).

This repo is split **one project per branch**. This branch carries the
**semi-auto balancer** (`semi-auto-balancer/`): the successor to the asset
balancer on the frozen `balancer` branch. It was forked from `balancer` at
f90ce6f so the old system keeps running in production untouched while this one
is built with "definite moves, no hybrid pieces". The roadmap, phase status,
and all design decisions live in `semi-auto-balancer/PLAN.md` — read it before
building anything here.

Core system (inherited, still true): Node.js service (Express + SQLite +
Nodemailer + Claude vision) polling CoinGecko per-profile. Each profile is one
flat pool of assets with target allocation percentages (totalling 100, incl. an
optional "tethered" index asset pinned 1:1; the index denomination derives from
the checkmarked tethered asset). Chained (splice-continuous) currency basket
and value index survive target changes, deposits/withdrawals, and index
switches — only trading and market moves affect them; `value_started_at` dates
the track record and feeds the annualized (compounding) rate. Notifications
are per-profile (email + optional Telegram via the official Bot API — one
bot for the app, token in the settings table, per-recipient chat ids;
replaced CallMeBot WhatsApp, which was unreliable) with the
armed → notified state machine (12h timeout; "Poll now" = universal reset).

What this branch changes (see PLAN.md for full detail and status):
- **Thresholds calibrated to price moves** — `threshold_pct` = price-move
  sensitivity X%; per-asset effective drift threshold `X(1−w)/(1+wX)`.
- **Local price-history cache + cost model** (per-profile fee/spread %),
  CoinGecko monthly-quota ledger, async job runner.
- **Backtested threshold tuning** (advisory sweep, basket AND value plateau).
- **Read-only exchange sync** (Kraken/Bitso: balances, trades, ledger →
  reconciliation; multi-year exchange history layers over CoinGecko's 365d).
- **Safety rails** (structural-break buy-freeze, stablecoin depeg watch).
- **Composition advisor** (capped inverse-vol target suggestions) and a
  **top-N candidate scanner**.
- Everything is advisory-with-apply. Nothing trades or changes settings itself.

Runs as the `semi-auto-balancer` systemd unit (node on `127.0.0.1:8092`,
deployed to `/opt/semi-auto-balancer`, config in `/etc/semi-auto-balancer/env`).
Ports on the box: 8088 dubber, 8090 deploy-control, 8091 old balancer (frozen),
**8092 semi-auto balancer**. The frontend uses relative API URLs; the eventual
public face is a proxy path on www.buitendyk.ca (website branch), pending.

Tests are permanent: `semi-auto-balancer/tests/`, run with `npm test`.

## Deploy

SSH is blocked from cloud sessions; deploys go through the HTTPS endpoint:
`POST https://deploy.buitendyk.ca/run`, header
`Authorization: Bearer $DEPLOY_API_TOKEN`, body
`{"action":"run-script","script":"deploy-semi-auto-balancer.sh"}` (script on
the `vps-access` branch; it syncs `origin/semi-auto-balancer` and runs
`semi-auto-balancer/deploy/install.sh`). `{"action":"status"}` = overall health.

The old balancer keeps deploying from `deploy-balancer.sh` / `origin/balancer`
— maintenance fixes only there, no features. Cutover criteria are in PLAN.md.

Loop: commit to `semi-auto-balancer` → "deploy the semi-auto balancer".

Infra / deploy tooling and the security model live on the `vps-access` branch.
