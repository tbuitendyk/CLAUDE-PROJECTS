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
  (ionos.mx) account.
- **Mandate:** build and host the site using tools available from IONOS
  (ionos.mx). Claude runs the design, the owner signs off on direction.
- **Hosting / deploy approach: NOT YET DECIDED.** Candidates depend on what
  IONOS currently offers (webspace + SFTP, git-based deploys, etc.). Do not
  scaffold deploy tooling until this is settled with the owner — then record
  the decision here and replace this bullet.

Note this deliberately differs from `www.buitendyk.ca` (the `website` branch),
which is served from the owner's IONOS VPS via the `deploy-website` action on
`deploy.buitendyk.ca`. This site is intended to use IONOS's own hosting
tooling instead, unless the owner decides otherwise.

Infra / deploy tooling for the VPS and the full security model live on the
`vps-access` branch (the control plane).
