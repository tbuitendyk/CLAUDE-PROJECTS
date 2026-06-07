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
- **Docs & projects** — `docs.homeandofficemicro.com` (external) and the
  **Spanish Video Dubber** control panel (`/dubber/`, on this site).

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

It does **not** obtain TLS certificates — this VPS already has a process for
that (e.g. `certbot`/Let's Encrypt), so just point it at `www.buitendyk.ca`
and `buitendyk.ca`:

```bash
sudo certbot --nginx -d www.buitendyk.ca -d buitendyk.ca
```

(Run certbot before or after `install.sh` — nginx just needs the certificate
files to exist at the paths in the config before it can start serving HTTPS
for this site; adjust `ssl_certificate`/`ssl_certificate_key` in
`nginx/www.buitendyk.ca.conf` if your certs live somewhere else.)

Make sure DNS for both `buitendyk.ca` and `www.buitendyk.ca` points at this
VPS, and that the `youtube-spanish-dubber` service is installed and running
on `127.0.0.1:8088` (see [its README](../youtube-spanish-dubber/README.md))
so `/dubber/api/` has something to proxy to.

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
