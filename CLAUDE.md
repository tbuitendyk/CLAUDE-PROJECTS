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
- **Hosting / deploy approach: NOT YET DECIDED.** The builder has no git/file
  interface, which conflicts with the dated-revert requirement — the fork
  (stay in MyWebsite Now vs. rebuild as code in git deployed to IONOS
  webspace) is with the owner. Do not scaffold deploy tooling until this is
  settled — then record the decision here and replace this bullet.

Note this deliberately differs from `www.buitendyk.ca` (the `website` branch),
which is served from the owner's IONOS VPS via the `deploy-website` action on
`deploy.buitendyk.ca`. This site is intended to use IONOS's own hosting
tooling instead, unless the owner decides otherwise.

Infra / deploy tooling for the VPS and the full security model live on the
`vps-access` branch (the control plane).
