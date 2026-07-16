# CLAUDE.md — `website` branch (www.buitendyk.ca portal)

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
website (`www.buitendyk.ca/`): the static portal **and** the dubber's web UI
(`sites/www.buitendyk.ca/dubber/` → `index.html`, `dubber.js`, `style.css`),
which the portal serves at `/dubber/`. nginx proxies `/dubber/api/` to the
dubber backend on `127.0.0.1:8088`.

**The dubber's backend is NOT here.** The Python service lives on the `dubber`
branch. Backend/pipeline changes ship via `deploy-dubber`; the dubber **screen**
ships from here via `deploy-website`.

The portal also fronts the **asset balancer** (`balancer` branch): nginx
proxies the whole `/balancer/` prefix to its Node service on
`127.0.0.1:8091`, behind the same site Basic Auth as the dubber's API.
Unlike the dubber, the balancer's UI is served by its own service — this
branch carries only the tile on the portal homepage and the nginx location.
The service ships via `{"action":"run-script","script":"deploy-balancer.sh"}`.

## Deploy

SSH is blocked from cloud sessions; deploys go through the HTTPS endpoint:
`POST https://deploy.buitendyk.ca/run`, header
`Authorization: Bearer $DEPLOY_API_TOKEN`, body `{"action":"deploy-website"}`.
That action self-syncs `origin/website` and runs
`www.buitendyk.ca/deploy/install.sh`. `{"action":"status"}` shows health.

Loop: commit to `website` (here or directly on GitHub) → "deploy the site".

Infra / deploy tooling and the full security model live on the `vps-access` branch.
