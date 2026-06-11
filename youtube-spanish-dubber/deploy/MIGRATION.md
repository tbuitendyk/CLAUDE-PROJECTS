# Migrating the dubber to a new box (e.g. fresh Debian 12)

The app is built to be re-provisioned, not hand-migrated: `deploy/install.sh`
stands up everything (system deps, venv, ML models, the standalone yt-dlp +
PO-token binaries, systemd units), and the source of truth lives in GitHub. The
only state that must be **carried over** is a handful of secrets; everything
else (downloaded models, the `data/` work dir, the binaries) regenerates on the
first deploy.

Why migrate rather than dist-upgrade in place: a fresh **Debian 12** box gets
OpenSSL 3 (so `bgutil-pot` runs and PO tokens work) and Python 3.11 (a modern
stack), which fixes the whole "frozen yt-dlp / no OpenSSL 3" class of problems at
the root — and you build it beside the old box and cut over, risking nothing
until DNS flips.

## Secrets to copy (the only durable state)

From the old `/opt/youtube-dubber/` to the new one (e.g. `scp`/`rsync` over SSH):

| File | What it is | Notes |
| --- | --- | --- |
| `.env` | Service config + any overrides (voice, privacy, `DUBBER_DUCK_VOLUME`, …) | Hand-managed; `install.sh` never overwrites an existing one. |
| `secrets/client_secret.json` | Google OAuth client (Desktop app) for uploads | Re-usable as-is. |
| `secrets/token.json` | YouTube upload refresh token | Re-usable; skips the one-time `cli authorize` step. |
| `secrets/youtube_cookies.txt` | yt-dlp download cookies (throwaway account) | Re-usable until it expires; re-export if downloads start bot-walling. |

Nothing else needs copying — `data/`, model caches, `bin/`, and
`yt-dlp-plugins/` are all rebuilt by `install.sh`.

## Steps

1. **Provision** a Debian 12 (Bookworm) VPS.
2. **Bootstrap the infra** from the `vps-access` branch (the deploy runner /
   `deploy.buitendyk.ca` endpoint, nginx, the auth/security model). The dubber
   deploy rides on top of that.
3. **Deploy the code**: trigger `deploy-dubber` (runs `install.sh`) and
   `deploy-website`. On Debian 12, `install.sh` auto-enables `bgutil-pot` (its
   `libssl.so.3` need is satisfied) and uses yt-dlp's full clients — no
   `DUBBER_YTDLP_PLAYER_CLIENTS` drop-in, full quality. (On an older box it would
   instead skip the provider and pin the token-exempt clients.)
4. **Copy the secrets** above into the new `/opt/youtube-dubber/`, `chown` them
   to the `dubber` user, then `restart-dubber`.
5. **Re-point DNS** (root, `www`, `deploy`) to the new IP and **re-issue TLS**
   (Let's Encrypt / certbot) for the same names.
6. **Verify**: `systemctl is-active bgutil-pot youtube-dubber`, then run a
   "Preview transcript first" on a known video — it should download cleanly.
7. **Cut over** (flip DNS), confirm, then decommission the old box.

## Later: bringing it home (Debian 12 VM + reverse tunnel)

Plan 2 reuses all of the above: run the same `install.sh` inside a Debian 12 VM
on home hardware, then add an `autossh -R` reverse tunnel from the VM to an
Oracle Always-Free instance (ARM A1 shape is the most stable) which forwards
public 80/443 into the tunnel; DNS points at the Oracle static IP. The dubber
setup itself is identical — only the ingress changes.
