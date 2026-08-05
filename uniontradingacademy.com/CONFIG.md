# Wiring checklist — what to connect, where, and how

Everything the site needs that is NOT code lives here. The site works today
with all values empty (buttons hide or fall back gracefully); fill them as
the client's accounts come online. **No secrets in git, ever** — SFTP
credentials go only into GitHub repo Secrets.

## 1. Site configuration (edit one file)

`sites/uniontradingacademy.com/dev-ver/assets/js/config.js`:

| Key | What | Example |
|-----|------|---------|
| `WHATSAPP_NUMBER` | Academy's WhatsApp, country code, no `+` | `5215512345678` |
| `CALENDLY_URL` | Client's Calendly event URL | `https://calendly.com/uniontradingacademy/sesion-estrategica` |
| `VIDEO_SRC` | Self-hosted landing video | `assets/media/presentacion.mp4` |
| `MERCADOPAGO_LINK` | Mercado Pago hosted-checkout link | `https://mpago.la/...` |

## 2. Client accounts to create (all free to open)

- **Calendly** (free plan): one event "Sesión de Consultoría" (45 min, zona
  Ciudad de México). Add the qualification questions as invitee questions
  (edad, objetivo, ingresos aproximados, principales retos — from
  `reference/v1-material/01-landing-copy.txt` and the funnel PDF). Set the
  event's redirect after booking to `https://www.uniontradingacademy.com/dev-ver/gracias/`.
- **Mercado Pago**: merchant account; create a payment link when the offer
  and price are defined.
- **WhatsApp**: any normal number works (wa.me); the free WhatsApp Business
  *app* is optional polish.

## 3. IONOS (client account) — one-time actions

1. Buy **Web Hosting** (Standard tier is enough) in the panel.
2. Create an SFTP account (type "SFTP only") — note host
   (`accessXXXXXXXXX.webspace-data.io`), user, password.
3. Create a folder `site` in the webspace root and point the domain
   `uniontradingacademy.com` at it (domain → destination → webspace folder).
4. The included wildcard SSL should attach automatically once the domain
   targets the webspace.

## 4. GitHub repo settings (for the workflows)

- Secrets (Settings → Secrets and variables → Actions → Secrets):
  `UTA_SFTP_HOST`, `UTA_SFTP_USER`, `UTA_SFTP_PASSWORD`.
- Optional variable: `UTA_REMOTE_DIR` (defaults to `/site`).

## 5. Operating the site (no Claude required)

- **Deploy**: Actions → "UTA deploy site" → Run workflow → choose the ref
  (default `uniontradingacademy`). It backs up the live site first, mirrors
  the ref up, and tags the deploy (`deploy/YYYYMMDD-HHMMSS`).
- **Backup on demand**: Actions → "UTA backup live site" → creates branch
  `backup/YYYYMMDD-HHMMSS` containing exactly what is live.
- **Revert to any prior date**: run "UTA deploy site" with an older
  `deploy/…` tag or any `backup/…` branch as the ref.
- **Launch day** (later): move `dev-ver/` content to the site root in a
  commit (and drop the `noindex` metas + robots `Disallow`), then deploy.

## 6. Video file

Target ≤ 95 MB so it can live in git (GitHub's hard limit is 100 MB/file):
10 min at 720p H.264 ~1–1.3 Mbps fits. Place it at
`sites/uniontradingacademy.com/dev-ver/assets/media/presentacion.mp4`,
set `VIDEO_SRC`, commit, deploy. If the delivered file is larger,
re-encode it (or upload it once by SFTP outside git and still set
`VIDEO_SRC`).

## 7. Pending content from the client

- Legal pages: real razón social, domicilio, RFC, contact email
  (`dev-ver/aviso-legal/`, `dev-ver/privacidad/` — marked `[PENDIENTE]`).
- Social profile URLs (footer/social icons are placeholders until then).
- The 10-minute video and the short thank-you-page video.
