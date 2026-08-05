# CLAUDE.md — `uniontradingacademy` branch (uniontradingacademy.com site)

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
Union Trading Academy website (`uniontradingacademy.com/`).

## The project

- **Domain:** `uniontradingacademy.com`, held in the owner's IONOS Mexico
  (ionos.mx) account, together with the web hosting.
- **Mandate:** build and host the site using tools available from IONOS
  (ionos.mx). Claude runs the design, the owner signs off on direction.
- **Owner's target workflow:** design offline (in this branch) with Claude,
  upload new versions deliberately, and ALWAYS retain the option to revert
  the live site to any prior date's configuration.

## Current state (verified 2026-08-04)

- The front page is designed (more or less) in **IONOS MyWebsite Now** — the
  site-builder at `editor.mywebsite-now.com` (es-MX locale). It is Spanish-
  language: "Union Trading Academy — Order Flow | Volume Profile | Trading
  Profesional"; nav Inicio / Proyectos / Contáctanos. Reference screenshot:
  `uniontradingacademy.com/reference/2026-08-04-mywebsite-editor-front-page.jpg`.
- That design is **not yet published**: `https://uniontradingacademy.com/`
  serves the IONOS "Construction" placeholder (HTTP 503, IONOS Webserver).
- **DO NOT change anything live (builder content, publish state, DNS, panel
  settings) without the owner's explicit permission.** Read-only inspection
  is fine.
- **DECIDED (owner, 2026-08-04): rebuild the site as code in git** on this
  branch, recreating the MyWebsite Now front-page design faithfully; the
  builder page becomes reference-only. Every published version must be a git
  commit so the live site can be reverted to any prior date's configuration.
- **Deploy target still open** (depends on what the IONOS contract includes):
  IONOS webspace via SFTP vs. IONOS Deploy Now. Owner provided read-only
  panel access in-session to inventory this — credentials live in the session
  only and MUST NEVER be committed to git. Record the target here once known.
- **Panel login paused mid-flow (2026-08-04):** login reached IONOS's
  new-device check, which emails a 6-digit code to the account address; owner
  will supply the code next session. Resume with
  `uniontradingacademy.com/tools/ionos-panel-recon/` (README has the full
  sandbox-browser runbook — do not re-debug TLS/proxy from scratch).

Note this deliberately differs from `www.buitendyk.ca` (the `website` branch),
which is served from the owner's IONOS VPS via the `deploy-website` action on
`deploy.buitendyk.ca`. This site is intended to use IONOS's own hosting
tooling instead, unless the owner decides otherwise.

Infra / deploy tooling for the VPS and the full security model live on the
`vps-access` branch (the control plane).
