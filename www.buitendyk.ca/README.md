# www.buitendyk.ca

The portal site for `https://www.buitendyk.ca` — a single front door that
ties together the tools and projects hosted on this VPS (and elsewhere),
plus a control panel sub-page for the
[`youtube-spanish-dubber`](../youtube-spanish-dubber/) service.

> This is a self-contained sub-project of the `claude-projects` repo — every
> path below is relative to this directory (`www.buitendyk.ca/`).

It's a plain static site: HTML/CSS/vanilla JS, no build step, no
third-party fonts or CDNs, no framework. Served directly by nginx.

## Structure

```
www.buitendyk.ca/
├── sites/www.buitendyk.ca/   # the static site itself (deployed as-is)
│   ├── index.html            # portal home page — links out to every tool
│   ├── assets/style.css      # shared dark-theme stylesheet
│   └── dubber/               # control panel for the Spanish video dubber
│       ├── index.html
│       └── dubber.js
├── nginx/www.buitendyk.ca.conf   # site config (HTTPS, static files, proxy)
├── deploy/install.sh             # deployment script
└── README.md
```

## Pages

### Home (`/`)

Links to:
- **Bible lookup tools** — `bible.buitendyk.ca/lookup`,
  `kjv.buitendyk.ca/lookup`, `vp.buitendyk.ca/busca` (external, hosted
  elsewhere on the same VPS).
- **Docs & projects** — `docs.homeandofficemicro.com` (external) plus the
  tools hosted on this site (`/dubber/`, `/balancer/`, `/semibalancer/`,
  `/classifier/`, `/uts/`, `/safe-encryption/`).
- **Email** — `mail.homeandofficemicro.com/mail` (Roundcube webmail) and
  `mail.homeandofficemicro.com/iredadmin` (mailbox/domain administration).
  Both external, served by the iRedMail stack. Note that iRedMail runs on
  **this same VPS** — every hostname here resolves to one IP — so its
  certificate is managed alongside the others; see
  [TLS certificates](#tls-certificates).

Add more cards to the relevant `.card-grid` in `index.html` as new tools and
projects come online.

### Dubber control panel (`/dubber/`)

A page for submitting English YouTube videos to the
[`youtube-spanish-dubber`](../youtube-spanish-dubber/) service and tracking
their progress. It talks to that service's HTTP API through this site's
`/dubber/api/` reverse-proxy path (see "Auth gate" below).

- Enter a source video URL and pick a target Spanish locale.
- Submitted jobs appear as cards below the form and poll
  `GET /dubber/api/jobs/{id}` every few seconds until they finish (showing
  the published YouTube link) or fail (showing the error).
- The destination YouTube channel is fixed — whichever channel the dubber
  service is authorized for on the server (its own one-time setup step, see
  that project's README). This site has no notion of "which channel"; it's
  a single pre-authorized destination by design, keeping the whole thing
  simple and avoiding any need to juggle per-request credentials.

#### Auth gate ("ghosted" submit button)

Submitting a dub triggers a real download → dub → publish pipeline that
posts a real video to a real YouTube channel — so the action is locked
behind the same kind of site credentials used elsewhere on this VPS (e.g.
`docs.homeandofficemicro.com`): **HTTP Basic Auth**, enforced by nginx.

The mechanism, end to end:

1. `nginx/www.buitendyk.ca.conf` puts `auth_basic` + `auth_basic_user_file`
   on the `/dubber/api/` location, which reverse-proxies to the dubber
   service on `127.0.0.1:8088`. Anonymous requests to that path get a `401`
   with a `WWW-Authenticate: Basic` challenge.
2. On page load, `dubber.js` calls `GET /dubber/api/healthz`. A `200` means
   the browser already has cached credentials for this origin (e.g. from
   visiting another Basic-Auth-protected path on the same site); a
   `401`/`403` means it doesn't yet.
3. While locked, the submit button is rendered **"ghosted"** — visible, with
   its label and styling intact, but `disabled` and dimmed — so visitors can
   see exactly what the tool does without being able to trigger it. A
   "Sign in" button is shown instead.
4. Clicking "Sign in" simply re-issues the `healthz` check, which makes the
   browser pop its native Basic Auth prompt (triggered by the `401`). Once
   the visitor enters valid credentials, the browser caches them for this
   origin and automatically attaches them to every subsequent request —
   including the actual `POST /dubber/api/jobs` job submission — via
   `credentials: "same-origin"`.

No custom session/login backend is needed: the browser's native credential
cache *is* the session, and nginx is the only thing that needs to know the
password. All DOM updates use `textContent` (never `innerHTML`), so job
data returned by the API can't inject markup/scripts into the page.

## Deployment (Debian/Ubuntu VPS)

```bash
git clone <this-repo-url>
cd claude-projects/www.buitendyk.ca
sudo bash deploy/install.sh
```

The installer:
1. Installs `nginx` and `apache2-utils` (for `htpasswd`) via `apt`.
2. Syncs `sites/www.buitendyk.ca/` to `/var/www/www.buitendyk.ca`.
3. Installs and enables `nginx/www.buitendyk.ca.conf`.
4. Creates `/etc/nginx/.htpasswd-www-buitendyk-ca` (prompting you to choose
   a username/password) — unless it already exists, so re-running the
   installer won't clobber credentials you've set.
5. Tests and reloads nginx.

It does **not** obtain TLS certificates — nginx just needs the certificate
files to exist at the paths in `nginx/www.buitendyk.ca.conf` before it can
serve HTTPS for this site. See [TLS certificates](#tls-certificates) below
for how certs are issued and renewed on this box.

Make sure DNS for both `buitendyk.ca` and `www.buitendyk.ca` points at this
VPS, and that the `youtube-spanish-dubber` service is installed and running
on `127.0.0.1:8088` (see [its README](../youtube-spanish-dubber/README.md))
so `/dubber/api/` has something to proxy to.

## TLS certificates

All four public certs on this box lapsed in 2026 (kjv Aug 13, docs Aug 17,
www Sep 5, deploy Sep 8). This section records what was actually wrong and
how it was fixed, because the obvious diagnosis was not the right one.

### The topology (this is what makes it unusual)

Every hostname resolves to one IP. Port 443 is an SNI-based TCP **stream**
proxy (`map $ssl_preread_server_name $backend` in `nginx.conf`) forwarding to
per-site vhosts on `127.0.0.1:4430-4433`.

**Port 80 does not belong to nginx.** It is held by `VBoxNetNAT` and forwarded
into the iRedMail VirtualBox guest on `192.168.56.129`:

```
$ ss -ltnp | grep :80
LISTEN 0 5 74.208.226.14:80 users:(("VBoxNetNAT",pid=3180,...))
```

`sites-available/default` has `listen 80` but is not enabled, and could not
bind it anyway. So **the host cannot answer an HTTP-01 challenge on port 80**,
and `--webroot -w` pointed at a port-80 vhost cannot work here. Neither can
`--standalone`, which wants to bind port 80 itself.

### The actual root cause: `authenticator = manual`

All four renewal confs carried `authenticator = manual` — issued by hand,
never able to renew unattended:

```
PluginError('An authentication script must be provided with
--manual-auth-hook when using the manual plugin non-interactively.')
```

`certbot.timer` was enabled and firing daily the whole time; `certbot.service`
just failed on every run. Four certs expiring on four different dates is the
signature of this, not of four separate mistakes. Check it with:

```bash
systemctl status certbot.service          # failed, while the timer is healthy
grep -H ^authenticator /etc/letsencrypt/renewal/*.conf
```

### The fix: answer the challenge on 443, not 80

The guest that owns port 80 redirects the challenge back out, preserving
hostname and path:

```
http://www.buitendyk.ca/.well-known/acme-challenge/T
  -> 301 https://www.buitendyk.ca/.well-known/acme-challenge/T
```

which returns to the public 443, through the SNI stream proxy, into the
host's own vhost. Let's Encrypt follows up to 10 redirects and
[does not validate certificates](https://letsencrypt.org/docs/challenge-types/)
along the way — so expired certs do not block this, and serving the challenge
from the **`:443` vhosts** is sufficient. No port-80 change, no guest access.

`/etc/nginx/snippets/acme-challenge.conf`, included after every `server_name`
in the four host vhosts:

```nginx
location ^~ /.well-known/acme-challenge/ {
    auth_basic off;
    allow all;
    default_type "text/plain";
    root /var/www/letsencrypt;
    try_files $uri =404;
    access_log off;
}
```

`^~` so it outranks any regex location (e.g. a `location ~ /\.` dotfile
deny). `auth_basic off` is what lets `docs.homeandofficemicro.com` renew at
all — it has server-level Basic Auth that otherwise 401s the challenge.

Then re-issue with the same cert name, which rewrites the renewal conf to the
webroot authenticator — that, not the new certificate, is the actual repair:

```bash
certbot certonly --webroot -w /var/www/letsencrypt \
  --cert-name www.buitendyk.ca -d www.buitendyk.ca -d buitendyk.ca \
  --non-interactive --agree-tos
```

### Doing it again

Automated on the `vps-access` branch; run via the deploy endpoint:

- `cert-audit.sh` — read-only. Certbot inventory, timer state, authenticator
  per cert, last failures, vhost layout.
- `cert-acme-setup.sh` — creates the webroot, installs the snippet, includes
  it in the four vhosts, then **verifies every hostname returns 200 over the
  real public URL** and exits non-zero if not.
- `cert-renew.sh` — re-verifies the challenge path, dry-runs all four against
  staging, and only then requests anything, so a broken host cannot burn
  Let's Encrypt's 5-per-week duplicate limit.

Verify from outside — `Verify return code: 0 (ok)` is the only acceptable
answer:

```bash
for h in buitendyk.ca www.buitendyk.ca bible.buitendyk.ca kjv.buitendyk.ca \
         vp.buitendyk.ca docs.homeandofficemicro.com deploy.buitendyk.ca; do
  echo | openssl s_client -servername "$h" -connect "$h:443" 2>&1 \
    | grep -E "Verify return code|notAfter"
done
```

### Automatic renewal (and the two things that make it real)

`certbot.timer` runs daily and, now that the authenticator is `webroot`,
actually completes. Two pieces make that trustworthy:

**A deploy hook, or renewal silently doesn't take effect.**
`certonly --webroot` writes new files and does not touch the running server.
Without a hook, nginx keeps serving the old certificate from memory, and
around day 90 starts serving an **expired** one while `certbot certificates`
still reports everything healthy. `/etc/letsencrypt/renewal-hooks/deploy/`:

```sh
#!/bin/sh
set -e
if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    logger -t certbot-deploy "reloaded nginx for ${RENEWED_DOMAINS:-unknown}"
else
    logger -t certbot-deploy "NGINX CONFIG TEST FAILED - not reloading"
    exit 1
fi
```

Hooks in that directory run only when a certificate actually renews.

**A watchdog, because the original failure was silent for months.**
`/usr/local/sbin/cert-expiry-watch`, on a daily timer, emails via the
existing `support@` path only when something is wrong. It checks:

- `certbot.service` in a failed state — exactly what sat unnoticed
- `certbot.timer` not active
- any certificate under 21 days
- **the cert on disk vs. the cert nginx is actually serving** — served older
  than disk is the precise signature of a renewal that succeeded but never
  got reloaded, and it is the one thing `certbot certificates` cannot show

Install or re-run (idempotent) with `cert-autorenew-harden.sh`; check by hand
with `cert-expiry-watch --report`, which prints status and always mails:

```
cert status:
  deploy.buitendyk.ca              disk=89d served=89d
  docs.homeandofficemicro.com      disk=89d served=89d
  kjv.buitendyk.ca                 disk=89d served=89d
  www.buitendyk.ca                 disk=89d served=89d
```

`disk` and `served` matching is the healthy state.

### Two traps worth remembering

**Backups in `sites-enabled` are live config.** nginx loads *every* file in
that directory regardless of extension. A
`www.buitendyk.ca.conf.before-svc.20260824-232951` symlink pointing at the
same file as `www.buitendyk.ca.conf` made nginx parse it twice — the source
of the `conflicting server name on 127.0.0.1:4432` warnings. Backups belong
outside the tree (`/root/cert-fix-backup/`).

**`systemctl reload nginx` is graceful.** Old workers keep serving the
previous config briefly, so a probe immediately after a reload can hit a
stale worker and 404 while the next request succeeds. Retry before believing
a post-reload failure.

### iRedMail (`mail.homeandofficemicro.com`) — done

Mail does **not** run on the host. The stream map's `default` route sends
everything unmatched — `mail.homeandofficemicro.com` and the apex
`homeandofficemicro.com` — to `192.168.56.129:443`, a VirtualBox guest
(`HOMSMAIL03`, Debian 12, FQDN `mail.homeandofficemicro.com`). That guest also
owns public `:80` through `VBoxNetNAT`, which is why the host can never answer
HTTP-01 for anything.

It used to serve iRedMail's stock self-signed certificate (`C=CN/GuangDong`,
valid to 2033), so webmail and iRedAdmin warned in every browser. It now
carries a real Let's Encrypt cert covering both names.

**Getting in.** The host reaches the guest over SSH on `vboxnet0` with a
dedicated passphrase-less key, `/root/.ssh/id_mailcert`, restricted in the
guest's `authorized_keys` to `from="192.168.56.1"`. The host's normal
`id_ed25519` is passphrase-protected and therefore useless to an unattended
script — the symptom is misleading, because sshd logs `Server accepts key`
(the key *was* authorized) and the client still fails:

```
Load key "/root/.ssh/id_ed25519": incorrect passphrase supplied
debug1: Server accepts key: ... ED25519 SHA256:/fHoQO7fiem...
Permission denied (publickey,password).
```

Don't strip the passphrase off a shared key to fix that; mint a separate one.

**The `:80` trap again.** iRedMail's `:80` block is `server_name _; return 301
https://$host$request_uri;` at **server** level, so — exactly as on the host —
a location added there is unreachable. Rather than restructure iRedMail's
shipped config, the challenge is served from the guest's `:443` vhost and the
`:80` redirect carries it there.

**Installed with symlinks, not config edits.** nginx (`templates/ssl.tmpl`),
Postfix (`smtpd_tls_cert_file`) and Dovecot (`ssl_cert`) all already read the
same two paths, so one pair of symlinks moves all three — and an iRedMail
upgrade can't overwrite it:

```bash
chmod 0755 /etc/letsencrypt/{live,archive}   # or Postfix/Dovecot can't read the key
ln -sfn /etc/letsencrypt/live/mail.homeandofficemicro.com/fullchain.pem \
        /etc/ssl/certs/iRedMail.crt
ln -sfn /etc/letsencrypt/live/mail.homeandofficemicro.com/privkey.pem \
        /etc/ssl/private/iRedMail.key
```

A deploy hook in the guest restarts nginx, Postfix and Dovecot on renewal.
**Verify the mail ports, not just HTTPS** — a service that didn't reload keeps
serving the old cert from memory, and mail clients would still warn while a
browser looked fine:

```
25  smtp      CN=mail.homeandofficemicro.com  issuer=YE1  Dec 7 02:35:16 2026
587 smtp      CN=mail.homeandofficemicro.com  issuer=YE1  Dec 7 02:35:16 2026
465 implicit  CN=mail.homeandofficemicro.com  issuer=YE1  Dec 7 02:35:16 2026
143 imap      CN=mail.homeandofficemicro.com  issuer=YE1  Dec 7 02:35:16 2026
993 implicit  CN=mail.homeandofficemicro.com  issuer=YE1  Dec 7 02:35:16 2026
995 implicit  CN=mail.homeandofficemicro.com  issuer=YE1  Dec 7 02:35:16 2026
```

Scripts on `vps-access`: `cert-mail-audit.sh` (read-only),
`cert-mail-genkey.sh`, `cert-mail-setup.sh` (prepares, requests nothing),
`cert-mail-issue.sh`, `cert-mail-verify.sh`.

Because this cert lives in the guest, the host watchdog can't see it on disk —
it checks those two hostnames over the network instead, so a lapse there
surfaces the same way as the rest.

`www.homeandofficemicro.com` remains **excluded**: it has no DNS A record, and
one unresolvable name fails the whole issuance. Add the record first if you
ever want it covered.

## Updating

After editing files under `sites/www.buitendyk.ca/`, redeploy with:

```bash
cd claude-projects/www.buitendyk.ca
git pull
sudo bash deploy/install.sh
```

(`rsync --delete` keeps the deployed copy in sync, including removed files.)
For nginx-config-only changes, you can skip straight to `sudo nginx -t &&
sudo systemctl reload nginx` after copying the updated file into
`/etc/nginx/sites-available/`.
