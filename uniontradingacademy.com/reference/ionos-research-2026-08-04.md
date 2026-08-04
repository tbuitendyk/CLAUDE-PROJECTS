# IONOS (ionos.mx) tooling research — 2026-08-04

Distilled from a verified web sweep of ionos.mx / ionos.com official pages and
docs (full agent output lived in the session; the durable facts are here).
Re-verify promo prices before purchase — they rotate.

## What the front page is built in

**MyWebsite Now** (site builder, `editor.mywebsite-now.com`) — plans Starter /
Plus / Pro (~MXN $100/$20/$340 promo). GUI/drag-and-drop only:

- **No FTP / file upload / webspace access at all** on builder contracts.
- Custom code limited to an HTML-embed widget + custom head code (not on the
  entry plan).
- No dated version history — an undo stack, not revertible snapshots.
- Plans bundle domain (year 1), wildcard SSL, 1 professional email.

Consequence: an offline-design → upload-versions → revert-to-date workflow
**cannot be implemented on MyWebsite Now**. Designs can only be hand-applied
in the editor.

## Products that DO fit a code-in-git site

- **Shared Web Hosting** (Standard/Plus/Premium/Ultimate, ~MXN $40–150 promo /
  $80–310 renewal; 100–500 GB NVMe): SFTP accounts (up to ~200) + full SSH on
  all current Linux plans, PHP 8.2–8.4, MariaDB, wildcard SSL, 1–5 email
  accounts, daily backups, **git pre-installed on the webspace**. SFTP/SSH
  connects on port 22 to a per-contract host `accessXXXXXXXXX.webspace-data.io`
  (shown in the control panel). On tariffs after 2024-08-29, accounts are
  created as "SFTP only" or "SFTP + SSH".
- **Deploy Now** (`ionos.mx/alojamiento/deploy-now` — note `/hosting/...` is a
  404 on the MX site): alive and sold in Mexico as of today. GitHub-only: a
  GitHub App injects `.github/workflows/deploy-now.yaml`; every push builds and
  deploys; per-branch staging preview URLs; automatic SSL + custom domains.
  Tiers: Basic free (3 projects, 50 MB/deploy, 1 staging), Pro ~MXN $50
  (1 GB, 5 staging), Professional ~MXN $150 (10 GB + 1 PHP project, 2 GB
  MariaDB). Static sites + PHP ≤ 8.3; **no Node SSR**; no email included.
  Caveat: product feature velocity slowed since 2023 (still maintained,
  Actions repos active through mid-2026); UI English-only.
- **Managed WordPress** (Start/Grow/Boost): still SFTP/SSH/WP-CLI, but
  WordPress-only.
- No relevant IONOS product found discontinued as of 2026-08-04.

## Deploy automation facts

- The IONOS Developer API covers **DNS, Domains, SSL only** — there is NO API
  for webspace file upload. The MX portal `developer.hosting.ionos.mx` exists
  and covers ionos.mx accounts (activation via `my.ionos.mx/shop/product/ionos-api`).
  IONOS also runs an MCP server (`mcp.ionos.com/mcp`, Personal Access Tokens).
- Realistic GitHub→IONOS deploy paths: (a) Deploy Now (only productized
  git-push path); (b) CI job pushing over SFTP/rsync-SSH to webspace
  (officially supported access, community-pattern recipes); (c) SSH into the
  webspace and `git pull` (git is officially pre-installed there).

## Domain / DNS / SSL / email

- Panel DNS freely edits A/AAAA/CNAME/MX/TXT/SRV/CAA; effective ~immediately,
  ≤1 h external propagation. Domain can point at any external server (or
  delegate to custom nameservers) while staying registered at IONOS.
- Bundled free wildcard SSL is IONOS-managed: auto-installs on IONOS
  webspace only, requires IONOS nameservers, not exportable. Let's Encrypt on
  an external server works (TXT/CAA supported; community-reported caveat: the
  active bundled cert can block LE issuance on the apex — deactivate it or fix
  CAA if that bites).
- Domain contracts include 1 email account (~2 GB, Mail Basic-type); MX
  records freely editable to any external mail host.

## Live-site state when checked

`https://uniontradingacademy.com/` → 503, IONOS "Construction" placeholder
(redirects to `www.`), server `IONOS Webserver`. The designed front page
exists only inside the MyWebsite Now editor (unpublished).
