# CLAUDE.md — `balancer` branch (asset-balancer service)

## Working style (all sessions)

Confirm the task before building. **Don't assume a direction, write a pile of
code, and burn tokens producing the wrong thing.** When anything is ambiguous or
a detail is unstated, ask one quick clarifying question and get clear alignment
first — then do the work.

- If the task is genuinely unambiguous, just do it — no needless confirmation friction.
- If there's a real fork or a missing detail, check in briefly before spending effort.
- Verify facts instead of guessing (e.g., check an address/mailbox/branch exists
  rather than assuming its spelling).

This repo is split **one project per branch**. This branch carries only the
asset balancer (`asset-balancer/`): a Node.js service (Express + SQLite +
Nodemailer) that polls CoinGecko on a per-profile schedule, tracks each
asset's value relative to a profile's index asset, and emails a rebalance
signal when two assets in the same set drift apart past the profile's
threshold. It runs as the `asset-balancer` systemd unit (node on
`127.0.0.1:8091`, deployed to `/opt/asset-balancer`, config in
`/etc/asset-balancer/env`).

The app serves its **own** web UI (`asset-balancer/public/`) — unlike the
dubber, no part of it lives on the `website` branch. The portal proxies
`https://www.buitendyk.ca/balancer/` → `127.0.0.1:8091` behind the site's
HTTP Basic Auth (nginx config on the `website` branch); the frontend uses
relative API URLs so it works both at `/` locally and under `/balancer/`.
Ports on the box: 8088 dubber, 8090 deploy-control, **8091 balancer**.

## Deploy

SSH is blocked from cloud sessions; deploys go through the HTTPS endpoint:
`POST https://deploy.buitendyk.ca/run`, header
`Authorization: Bearer $DEPLOY_API_TOKEN`, body
`{"action":"run-script","script":"deploy-balancer.sh"}`.
That script (on the `vps-access` branch) syncs `origin/balancer` into its own
checkout and runs `asset-balancer/deploy/install.sh`, which restarts the
service. `{"action":"status"}` shows overall health.

The tile + `/balancer/` proxy on www.buitendyk.ca ship separately via
`{"action":"deploy-website"}` (they live on the `website` branch).

Loop: commit to `balancer` (here or directly on GitHub) → "deploy the balancer".

Infra / deploy tooling and the full security model live on the `vps-access` branch.
