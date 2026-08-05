# v1.0.0 requirements (owner, 2026-08-05 — end of content stream)

Constraints from CLAUDE.md apply throughout: **GitHub-native everything, zero
Claude dependency, transferable to the client's GitHub**; live changes only
with owner permission; owner material = guidance, not template.

## 1. Hidden-live publishing under `/dev-ver`

- The coded site goes live on the real domain but "hidden": temporary
  publishing root **`https://www.uniontradingacademy.com/dev-ver/`**.
- Domain root `/` gets a neutral placeholder (equivalent of today's
  construction page) until launch; flipping v1 to `/` is one deploy later.
- Keep `/dev-ver` out of search: `robots.txt` disallow + `noindex` meta +
  `X-Robots-Tag` where available. Not secret, just unlisted.

## 2. Self-hosted video

- The landing video (~10 min, file pending from owner) should play on OUR
  domain — no visible third-party site — via a plain `<video>` player
  (poster + MP4/H.264; optional WebM). Hosted on the IONOS webspace.
- Size note: GitHub hard-limits files to 100 MB; target ≤ ~95 MB encode
  (720p H.264 ~1–1.3 Mbps fits 10 min) so the video can live in git and
  deploy with Actions. If the delivered file is bigger: re-encode, or keep
  media out of git and upload once by SFTP (documented either way).

## 3. Booking + data capture, automated

- Funnel (per mockups/sketch): landing (video + CTA) → cuestionario →
  calendario → gracias/confirmación.
- Zero-backend integrations only (static site): form vendor + Calendly-style
  scheduler embeds, chained by redirects. Candidate stacks (owner picks —
  see decision log): Calendly free with invitee questions; Tally.so free
  form → redirect to Calendly; native-looking form posting to a Google
  Apps Script → Google Sheets. All free tiers; accounts belong to the
  client so the project transfers cleanly.

## 4. WhatsApp follow-up (no Business API, free)

- Business API is out (cost/availability). ToS-safe pattern: the PROSPECT
  initiates via **wa.me click-to-chat** links with pre-filled text (e.g.
  thank-you page button: "Confirma tu sesión por WhatsApp" prefilled with
  name/date). Once the prospect messages first, the team replies freely
  from a normal phone/WhatsApp (the free WhatsApp Business *app* is
  optional polish, not required).
- No unofficial automation gateways (account-ban + ToS risk) — manual
  replies, structured by the prefilled messages.

## 5. E-payments

- Client wants to accept payments. Static-site pattern: hosted **payment
  links** (no backend, no PCI scope) — Mercado Pago (MX-native) and/or
  Stripe Payment Links; buttons on the site link out to hosted checkout.
  Requires the client to open the merchant account; site ships with a
  stub/placeholder until credentials exist.

## 6. Versioned deploys + timestamped production backups (GitHub-native)

- **Deploy**: GitHub Actions workflow (manual `workflow_dispatch` and/or
  push-to-branch) that publishes the site over SFTP to the IONOS webspace
  (`accessXXX.webspace-data.io:22`, credentials in GitHub repo secrets).
  Deploying a PRIOR commit/branch = revert to that date.
- **Backup**: workflow that mirrors the CURRENT live webspace into a
  timestamped `backup/YYYYMMDD-HHMM` branch (and/or tag) in GitHub before
  each deploy and on demand.
- Both live in `.github/workflows/` in this repo → transfer to the client's
  GitHub = fork/move repo + set two secrets. No VPS, no Claude.

## Hosting decision (updated recommendation)

Requirements 1, 2 and 6 need real webspace (path root, ~100+ MB media,
SFTP pull/push). **IONOS shared Web Hosting** (Standard tier suffices:
~MXN $40/mo promo / $80 renewal, 100 GB NVMe, SFTP+SSH, wildcard SSL,
1 email account) replaces the earlier Deploy Now-free suggestion — Deploy
Now's 50 MB free tier can't hold the video and its model can't pull live
state down for backups. Needs owner/client action: add the product to the
client's IONOS account and point the domain at the new webspace (domain
currently rides the MyWebsite Now Plus contract; the builder contract can
be cancelled at the client's discretion once v1 is live).

## Decision log

| # | Decision | Status |
|---|----------|--------|
| 1 | Hosting product (Web Hosting vs Deploy Now paid) | OPEN — owner |
| 2 | Form/booking stack (Calendly-only / Tally+Calendly / Sheets) | OPEN — owner |
| 3 | Payment provider (Mercado Pago / Stripe / PayPal) | OPEN — client |
| 4 | WhatsApp = wa.me click-to-chat + manual replies | proposed |
| 5 | Site build proceeds as static HTML/CSS/JS in this repo | decided (owner 2026-08-04) |
