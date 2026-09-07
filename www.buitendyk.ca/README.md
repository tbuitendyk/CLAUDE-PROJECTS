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

Every hostname on this VPS — `buitendyk.ca`, the `bible`/`kjv`/`vp`
subdomains, `docs.homeandofficemicro.com` and the iRedMail hosts — resolves
to a single IP and is fronted by one nginx. Port 443 is an SNI-based TCP
**stream** proxy (`map $ssl_preread_server_name $backend` in `nginx.conf`)
forwarding to per-site backends on `127.0.0.1`; port 80 is a normal `http{}`
server that redirects to HTTPS.

That topology dictates how certs must be issued.

### Use `--webroot`, never `--standalone`

`certbot --standalone` binds port 80 itself, so it requires stopping nginx —
which takes **every** site on the box down, not just the one being renewed.
Port 80 is also the only place plaintext HTTP is under our control, so it is
the correct ACME entry point even though 443 is a stream proxy. Issue and
renew with `--webroot` against a single shared directory:

```bash
sudo install -d -m 755 /var/www/letsencrypt/.well-known/acme-challenge
sudo chown -R www-data:www-data /var/www/letsencrypt

sudo certbot certonly --webroot -w /var/www/letsencrypt \
  --cert-name buitendyk.ca -d www.buitendyk.ca -d buitendyk.ca
```

### Two traps that silently break renewal

Both of these let a cert issue once and then quietly fail to renew ~60 days
later, which is exactly how three certs on this box lapsed in 2026.

**1. A server-level `return 301` swallows the ACME challenge.** nginx runs
server-context rewrite directives *before* it selects a location, so a
redirect written at server level hijacks `/.well-known/acme-challenge/` no
matter what location block you add. The redirect must live inside
`location /`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name buitendyk.ca www.buitendyk.ca;

    include /etc/nginx/snippets/acme-challenge.conf;

    location / { return 301 https://$host$request_uri; }   # NOT server-level
}
```

**2. HTTP Basic Auth returns 401 on the challenge path.** Any site gated by
`auth_basic` (this one's `/dubber/api/`, and all of
`docs.homeandofficemicro.com`) must exempt the ACME path, or Let's Encrypt
gets a 401 and validation fails.

Both are handled by one shared snippet — create
`/etc/nginx/snippets/acme-challenge.conf` and `include` it in **every**
`:80` and `:443` server block, including the `default_server`:

```nginx
location ^~ /.well-known/acme-challenge/ {
    auth_basic off;          # cancel any inherited Basic Auth
    allow all;               # cancel any inherited IP restriction
    default_type "text/plain";
    root /var/www/letsencrypt;
    try_files $uri =404;
    access_log off;
}
```

The `^~` prefix is required: it outranks regex locations, so a common
`location ~ /\.` dotfile-deny rule can't swallow `/.well-known/`.

For the record, an expired certificate does *not* itself block renewal —
Let's Encrypt's HTTP-01 validator follows HTTP→HTTPS redirects and
[does not validate certificates](https://letsencrypt.org/docs/challenge-types/)
along the way. Chasing an "expired cert deadlock" is a dead end; check the
two traps above instead.

### Verify before issuing

This must print `200` for every hostname. If it doesn't, certbot will fail:

```bash
echo ok | sudo tee /var/www/letsencrypt/.well-known/acme-challenge/probe
sudo nginx -t && sudo systemctl reload nginx

for h in buitendyk.ca www.buitendyk.ca bible.buitendyk.ca kjv.buitendyk.ca \
         vp.buitendyk.ca docs.homeandofficemicro.com \
         homeandofficemicro.com mail.homeandofficemicro.com; do
  printf '%-34s %s\n' "$h" \
    "$(curl -sL -o /dev/null -w '%{http_code}' \
       http://$h/.well-known/acme-challenge/probe)"
done
```

Then dry-run each cert before issuing for real:

```bash
sudo certbot certonly --webroot -w /var/www/letsencrypt --dry-run \
  --cert-name kjv.buitendyk.ca \
  -d kjv.buitendyk.ca -d bible.buitendyk.ca -d vp.buitendyk.ca
```

### iRedMail (`mail.homeandofficemicro.com`)

iRedMail ships a self-signed certificate, so webmail and iRedAdmin throw a
browser warning until it's replaced. Rather than editing
`/etc/nginx/templates/ssl.tmpl`, Postfix and Dovecot separately — which an
iRedMail upgrade can overwrite — point iRedMail's expected paths at the
Let's Encrypt files with symlinks, which is
[iRedMail's own recommended approach](https://docs.iredmail.org/letsencrypt.html):

```bash
sudo certbot certonly --webroot -w /var/www/letsencrypt \
  --cert-name mail.homeandofficemicro.com \
  -d mail.homeandofficemicro.com -d homeandofficemicro.com

# Required, or Postfix/Dovecot cannot read the key (0700 by default)
sudo chmod 0755 /etc/letsencrypt/{live,archive}

sudo ln -sf /etc/letsencrypt/live/mail.homeandofficemicro.com/fullchain.pem \
            /etc/ssl/certs/iRedMail.crt
sudo ln -sf /etc/letsencrypt/live/mail.homeandofficemicro.com/privkey.pem \
            /etc/ssl/private/iRedMail.key

sudo systemctl reload nginx && sudo systemctl restart postfix dovecot
```

The apex `homeandofficemicro.com` is included above because it currently has
no SNI map entry and falls through to the iRedMail backend.

### Keep renewals from lapsing again

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-services.sh >/dev/null <<'EOF'
#!/bin/sh
systemctl reload nginx
systemctl restart postfix dovecot
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-services.sh

sudo systemctl list-timers | grep -i certbot   # the timer must actually be active
sudo certbot renew --dry-run                   # exercises every renewal conf
```

If a renewal ever fails, `sudo certbot certificates` and
`/var/log/letsencrypt/letsencrypt.log` name the failing domain and reason;
`grep -r authenticator /etc/letsencrypt/renewal/*.conf` shows which method
each cert is configured to use.

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
