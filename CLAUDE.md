# CLAUDE.md — `website` branch (www.buitendyk.ca portal)

This repo is split **one project per branch**. This branch carries only the
website (`www.buitendyk.ca/`): the static portal **and** the dubber's web UI
(`sites/www.buitendyk.ca/dubber/` → `index.html`, `dubber.js`, `style.css`),
which the portal serves at `/dubber/`. nginx proxies `/dubber/api/` to the
dubber backend on `127.0.0.1:8088`.

**The dubber's backend is NOT here.** The Python service lives on the `dubber`
branch. Backend/pipeline changes ship via `deploy-dubber`; the dubber **screen**
ships from here via `deploy-website`.

## Deploy

SSH is blocked from cloud sessions; deploys go through the HTTPS endpoint:
`POST https://deploy.buitendyk.ca/run`, header
`Authorization: Bearer $DEPLOY_API_TOKEN`, body `{"action":"deploy-website"}`.
That action self-syncs `origin/website` and runs
`www.buitendyk.ca/deploy/install.sh`. `{"action":"status"}` shows health.

Loop: commit to `website` (here or directly on GitHub) → "deploy the site".

Infra / deploy tooling and the full security model live on the `vps-access` branch.
