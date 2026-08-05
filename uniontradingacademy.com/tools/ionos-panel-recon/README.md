# IONOS panel recon (read-only)

Headless-browser tooling for inspecting the owner's IONOS panel from a Claude
cloud session. **Strictly read-only: never click publish/save/edit/DNS
actions.** Credentials are provided by the owner in-session and MUST NEVER be
committed to git — `recon.js` reads them from a scratchpad file outside the
repo.

## Why this exists

The cloud sandbox routes outbound HTTPS through a TLS-re-terminating egress
layer, and stock Playwright/Chromium fails against it two different ways.
Verified findings (2026-08-04) so you don't re-debug them:

- **Explicit env proxy (`HTTPS_PROXY`) path breaks Chromium TLS**: the CONNECT
  tunnel opens, then the relay resets Chromium's large post-quantum (ML-KEM)
  ClientHello (`SOCKET_READ_ERROR os_error=104`). Long-running Chromium picks
  the env proxy up automatically on Linux (no desktop proxy service), so it
  hits this even without proxy flags.
- **Direct connections work** — the sandbox transparently intercepts :443 and
  handles that handshake fine — but Chromium must trust the interception CA,
  or every page is `ERR_CERT_AUTHORITY_INVALID`. (One-shot `--dump-dom` runs
  masked both problems; don't trust them as a health check.)

## Setup (per fresh container)

```sh
apt-get update && apt-get install -y libnss3-tools
cd /root/.pki && csplit -sz -f cacert- /root/.ccr/ca-bundle.crt \
  '/-----BEGIN CERTIFICATE-----/' '{*}' \
  && n=0; for f in cacert-*; do \
       certutil -d sql:/root/.pki/nssdb -A -t "C,," -n "ccr-ca-$n" -i "$f"; \
       n=$((n+1)); done; rm -f cacert-*
# (run a throwaway chromium once first if ~/.pki/nssdb does not exist yet,
#  or create it with certutil -N --empty-password -d sql:/root/.pki/nssdb)
```

Launch the long-lived browser (**`--no-proxy-server` is the load-bearing
flag**), with `$S` = the session scratchpad dir:

```sh
setsid nohup /opt/pw-browsers/chromium --headless=new --no-sandbox \
  --disable-gpu --no-proxy-server --remote-debugging-port=9222 \
  --user-data-dir=$S/ionos-profile --window-size=1440,900 --lang=es-MX \
  > $S/chromium.log 2>&1 < /dev/null &
```

Write `$S/.uta-creds.json` (`{"user": "...", "pass": "..."}`, chmod 600) from
the owner-supplied credentials, adjust the `S` constant in `recon.js` to the
session's scratchpad path, then drive it:

```sh
NODE_PATH=/opt/node22/lib/node_modules node recon.js <step> [args]
```

Steps: `landing` · `fill-login` · `token <6-digit-code>` · `state` ·
`goto <url> <tag>` · `links` · `shot-full <tag>` · `click-text <text> <tag>`.
Screenshots land next to the script's `OUT` dir.

## Login flow state (2026-08-04)

- `https://presence.ionos.mx/` bare returns IONOS's 404 page — enter via
  `https://my.ionos.mx/` → redirects to `login.ionos.mx` (email-first form).
- `fill-login` submits the email; IONOS then demands a **6-digit code emailed
  to the account address** (new-device check) at `login.ionos.mx/emailconfirmation`
  — get the code from the owner, then run `token <code>` (it also completes a
  password step after, if IONOS asks).
- Killing stray instances: `for p in $(pgrep -f "^/opt/pw-browsers/chromium"); do kill $p; done`
  (broad `pkill -f` patterns match the Claude CLI process and get refused).

## Once inside (the actual goals)

1. Inventory contracts/products: does the account have ONLY MyWebsite Now, or
   also webspace/Web Hosting (SFTP)? → settles the deploy target
   (webspace-SFTP vs Deploy Now). Record in the branch CLAUDE.md.
2. Full-page captures of the MyWebsite Now site **preview** (desktop + phone
   widths, every page: Inicio / Proyectos / Contáctanos) into `../../reference/`
   as the faithful-rebuild source. Use the preview ("Vista previa") URL, NOT
   the editor canvas (avoids accidental edits; the editor may also need
   WebSockets, which the sandbox egress does not support).
