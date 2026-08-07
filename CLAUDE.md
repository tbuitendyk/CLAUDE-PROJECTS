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
- **HARD REQUIREMENT (owner, 2026-08-05): zero Claude dependency.** The site,
  its deploys, maintenance, and revert path must be fully functional from the
  GitHub project alone (GitHub-native tooling only), so the whole project can
  later transfer to the client's GitHub. No VPS/deploy-control coupling, no
  Claude-specific glue in the pipeline.
- **Design inputs:** owner supplied material as *guidance* for v1.0.0 —
  explicitly NOT a hard template; interpret intent, confirm direction. The
  content stream CLOSED 2026-08-05; raw material in
  `uniontradingacademy.com/reference/v1-material/`.
- **v1 scope:** `uniontradingacademy.com/REQUIREMENTS.md` — hidden-live
  publishing under `/dev-ver`, self-hosted video, automated booking/capture,
  wa.me WhatsApp follow-up, payment links, and GitHub-Actions deploy +
  timestamped-backup scripting. Hosting recommendation updated there:
  shared Web Hosting (webspace/SFTP), superseding the Deploy Now-free idea
  (video size + live-state backups rule the free tier out).
- **Account inventory (updated 2026-08-05, later):** the client's IONOS
  account now holds THREE contracts — `113205858 IONOS MyWebsite Now Plus`
  (builder; `uniontradingacademy.com` rides on it as "Dominio adicional",
  renews 02/08/2027), `113205853 IONOS marketingRadar`, and **`113249653
  IONOS Web Hosting Plus`** (purchased 2026-08-05: $20 MXN/mes × 6, then
  $120/mes; 200 GB webspace, SFTP) — the deploy target. A second domain
  `orderflowvolumeprofile.com` was taken during hosting checkout and serves
  as the interim dev domain until `uniontradingacademy.com` is re-pointed.
  Beware the name collision: "MyWebsite Now Plus" (builder) ≠ "Web Hosting
  Plus" (webspace) — both end in "Plus", both ~$20 promos.
- **Webspace LIVE + setup done (2026-08-06 ~09:40 UTC):** provisioning
  finished — the hosting panel opens (195 GB webspace) and
  `orderflowvolumeprofile.com` was issued (expires 06/08/2027). Completed
  in-panel per the owner-approved plan: SFTP-only account **`su1412725`** @
  **`access-5021100334.webspace-host.com`** port 22 (base dir `/`, note
  "GitHub Actions deploy (UTA site)"; password lives ONLY in the session
  scratchpad and the GitHub secret — never in git), and the domain is
  connected to webspace dir **`/site`** (panel confirmed "Se ha establecido
  la conexión del dominio con el espacio web"). (Secrets set by owner
  2026-08-06 eve; pipeline verified live — see PIPELINE LIVE bullet.)
- **Provisioning shuffle + restore (2026-08-06 afternoon UTC):** when the
  order finished provisioning it ALSO executed a domain reorganization —
  panel notifications "Transferencia de dominio en tu ID de cliente" /
  "Información sobre tu pedido: uniontradingacademy.com". Net effect:
  `uniontradingacademy.com` moved contracts 113205858 → 113249653, was cut
  from the builder, and currently has **NO DNS records** (site was never
  published, so nothing user-visible was lost); the automation also
  re-pointed `orderflowvolumeprofile.com` at MyWebsite NOW, silently
  undoing the morning webspace connection. Restored ~14:15 UTC:
  `orderflowvolumeprofile.com` → webspace `/site` reconnected
  (panel-confirmed; SFTP account unaffected). SSL for the interim domain
  self-provisioned during the day — real Sectigo wildcard
  `*.orderflowvolumeprofile.com`, strict TLS verifies; no action was
  needed. Re-pointing `uniontradingacademy.com` (now conveniently already
  on the hosting contract) awaits owner sign-off on v1 content.
- **ICANN verification:** no in-panel confirm exists — the link arrives by
  email to the registrant address **`uniontrading777@gmail.com`** (Reg-C:
  UnionTrading Academy / Francisco Javier Espinosa Magana, León MX). The
  client must open that mailbox and click the IONOS verification link.
- **Deploy trigger VERIFIED WORKING (2026-08-06 eve):** a commit changing
  the root `DEPLOY-REQUEST` marker on `uniontradingacademy` fires "UTA
  deploy site" — **from any committer, Claude sessions included** (proven:
  git-proxy push `a0789d8` → run 31131717160; GitHub-API commit `461ca8d`
  → run 31131844789; both event=push). Runs appear with ~10–60 s lag.
  Deploys the branch tip; ordinary site commits never auto-deploy; backup
  always runs on the marker path and tolerates a missing `/site` first
  time. Two earlier failed theories, so nobody re-litigates: (1) "Actions
  disabled" — false, owner confirmed allow-all was always on; the
  historical no-run on `b19e59f` was because that commit *introduced* the
  push trigger (new workflows register but don't fire on the push that
  adds them; every later marker commit fires). (2) "session pushes can't
  trigger CI" (briefly recorded here) — false; that conclusion came from
  polling the *unauthenticated* runs API while rate-limited (error bodies
  parsed as zero runs). Lesson: poll runs via authenticated MCP reads.
  Still true: API workflow_dispatch → 403 for the integration; tag pushes
  → 403 via git proxy; UTA workflows never appear in the Actions tab's
  left-hand workflow list (default branch is `vps-access`) — find runs
  under Actions → "All workflows". Runs 1–3 failed with empty secrets EVEN
  AFTER the owner stored them correctly (Secrets tab → Repository secrets):
  the backup job is a reusable-workflow call, and called workflows don't
  inherit caller secrets — fixed 2026-08-06 eve by adding `secrets:
  inherit` to the backup job in deploy-uta.yml (don't remove it).
  Owner-side config was right all along.
- **PIPELINE LIVE END-TO-END (2026-08-07T00:01Z):** first real deploy
  succeeded on `625da33` — backup branch `backup/20260806-235802`
  (first-run empty snapshot), site mirrored to `/site`, tag
  `deploy/20260807-000148`; `https://orderflowvolumeprofile.com/` (root
  placeholder) and `/dev-ver/` (full site) both serve HTTP 200 with real
  UTA content. Fixes that got it green: `secrets: inherit` on the backup
  call (`0b4df8a`) and stripping embedded quotes from lftp mirror paths
  (`625da33`) — keep both. Deploy loop henceforth: append a line to
  `DEPLOY-REQUEST` on this branch → ~2 min → live, with an automatic
  pre-deploy snapshot of the live webspace to a `backup/…` branch every
  time. (Sign-off arrived and the re-point happened 2026-08-07 — see the
  LAUNCH bullet; the ICANN mail click is still pending on the client.)
- **LAUNCHED (2026-08-07T15:00Z) — `https://uniontradingacademy.com/` is
  the canonical URL, HTTPS live, all redirects verified.** Owner chose the
  main domain to serve the full site at root with
  `orderflowvolumeprofile.com` redirecting to it. Done: `dev-ver/` promoted
  to site root, robots opened, `noindex` metas dropped (gracias keeps its);
  domain connected to webspace `/site`; DNS live (apex + www →
  74.208.236.33 / 2607:f1c0:100f:f000::200); WhatsApp click-to-chat ACTIVE
  (524792265252, owner tap-test confirmed).
- **THE SSL ROOT CAUSE — read this before debugging IONOS certs again.**
  The cert never "self-provisions" for a domain added to a contract later.
  Web Hosting Plus includes exactly **2 SSL Starter Wildcard slots**, and
  the 2026-08-06 provisioning shuffle had burned BOTH on
  `*.orderflowvolumeprofile.com` (the same domain, twice — two distinct
  certs, UUIDs `2ed558ae-…` and `18c78a23-…`). With the portfolio at
  "2 de 2 utilizados", the panel offered `uniontradingacademy.com` only
  PAID certs — the "Activar" button under Certificado SSL on the domain
  page just redirects to `ssl.ionos.mx/certificates/upsell`, and
  "Configurar certificado" is the same upsell in disguise. **The free fix:**
  Dominios & SSL → Certificados → row context menu → "Reasignar certificado
  SSL" → pick the target domain → accept terms. Owner approved
  2026-08-07; the duplicate (`18c78a23-…`) was reassigned and the cert
  installed within ~1 minute. Portfolio now correctly reads one wildcard
  per domain (orderflow → 02/02/2027, UTA → 03/02/2027). Ruled out along
  the way, so nobody re-checks: DNS, CAA (none), registry status (RDAP
  clean, identical to the working domain — the pending ICANN click does
  NOT block certs), and sandbox/proxy artifacts (SSL Labs externally
  confirmed zero certChains).
- **Redirect layer live** in `sites/uniontradingacademy.com/.htaccess`:
  any-orderflow-host → `https://uniontradingacademy.com/$1`, `www` → apex,
  `/dev-ver/*` → `/*`, then force-HTTPS. Rule ORDER matters: the orderflow
  hop must precede force-HTTPS so it works over plain HTTP (that domain's
  own TLS is not needed). Force-HTTPS uses `%{HTTPS} !=on`, verified
  loop-safe by a temporary PHP probe (Apache reports `HTTPS=on` +
  SERVER_PORT 443 directly; `X-Forwarded-Proto` is unset on HTTPS). Verified
  matrix: http apex, http/https www, http orderflow, and `/dev-ver/` all
  301 → `https://uniontradingacademy.com/` (200).
- **Interim-domain TLS gap: RESOLVED (2026-08-07T18:35Z).** Reassigning the
  duplicate cert left `https://orderflowvolumeprofile.com/` unable to
  complete TLS for ~3 h (cert still valid + "Asignado", but IONOS never
  reinstalled that vhost; no user impact since `http://` 301'd correctly).
  It did NOT self-heal. Owner-approved fix, worked in <4 min: Dominios &
  SSL → Certificados → the `*.orderflowvolumeprofile.com` row's context
  menu → **"Expedir un nuevo certificado"** → confirm (no checkbox; the
  panel notes a cert may be re-issued as often as needed, so this is safe
  and repeatable). Lesson: after ANY cert reassignment on this contract,
  re-issue the *other* domain's cert to force its vhost reinstall.
  Full matrix now green including https on BOTH domains.
- **Remaining functional gaps, all awaiting client account values** (see
  CONFIG.md): `CALENDLY_URL` (booking — last piece before the client can
  test-drive the whole funnel), `VIDEO_SRC` (file; yt-dlp + ffmpeg are
  installed and a YouTube/Drive link can be ingested), `MERCADOPAGO_LINK`
  (blocked on the offer/price decision; account is free to open, ~3.5–4%+IVA
  per charge, and only the public `mpago.la/…` link is ever needed — never
  credentials).
- **⚠ Domain flag (2026-08-05):** the panel shows `uniontradingacademy.com`
  needs registrant contact-data confirmation ("Se requiere confirmación de
  los datos de contacto") — an ICANN verification email must be actioned or
  the domain can eventually be suspended. Owner/client to click the link
  (resend available in Dominios & SSL).
- The included free email account for the domain is still not configured.
- **Design baseline captured:** full builder capture (exact DOM, all assets,
  full-page shots of all 5 pages) in
  `uniontradingacademy.com/reference/builder-capture/`.
- Panel access runbook lives in
  `uniontradingacademy.com/tools/ionos-panel-recon/` (sandbox-browser fixes —
  do not re-debug TLS/proxy from scratch). Credentials live in the session
  only and MUST NEVER be committed to git.

Note this deliberately differs from `www.buitendyk.ca` (the `website` branch),
which is served from the owner's IONOS VPS via the `deploy-website` action on
`deploy.buitendyk.ca`. This site is intended to use IONOS's own hosting
tooling instead, unless the owner decides otherwise.

Infra / deploy tooling for the VPS and the full security model live on the
`vps-access` branch (the control plane).
