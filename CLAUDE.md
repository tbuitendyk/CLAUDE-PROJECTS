# CLAUDE.md — `docs-web` branch (docs.homeandofficemicro.com)

This repo is split **one project per branch**. This branch carries only the
`docs.homeandofficemicro.com` static-publishing project, nested under
`docs-web/`:

- `docs-web/sites/docs.homeandofficemicro.com/` — the published content
  (browseable via nginx `autoindex`; the whole site is behind HTTP Basic Auth)
- `docs-web/nginx/` — the vhost + the SNI-map patch line
- `docs-web/deploy/` — `deploy-docs.sh` (publish) and `issue-cert.sh` (TLS)

## How it's served

Same VPS as everything else, behind the host nginx **stream/SNI router** on
`:443` (`map $ssl_preread_server_name $backend`): `docs.homeandofficemicro.com`
→ `127.0.0.1:4431`, where this vhost terminates TLS and serves
`/var/www/docs.homeandofficemicro.com`. Leave the map's `default` route alone —
it carries everything else to the iRedMail VM.

## Deploy

**Not wired into the deploy-control endpoint** (there is no `deploy-docs`
action). Deployment is a root step on the box:

```bash
# as root on the VPS, from a checkout of this branch:
cd docs-web
bash deploy/deploy-docs.sh      # rsyncs content, installs the vhost, nginx -t + reload
```

`deploy-docs.sh` rsyncs `sites/…` → `/var/www/docs.homeandofficemicro.com`,
installs the vhost, checks the SNI map has the `:4431` route, then reloads
nginx. One-time prereqs it expects: a DNS A record, a Let's Encrypt cert
(`deploy/issue-cert.sh`, manual DNS-01 — does NOT auto-renew), and the htpasswd
file (`htpasswd -c /etc/nginx/htpasswd/docs.homeandofficemicro.com <user>`).

To drive deploys through the endpoint instead, add a wrapper under
`vps-access/scripts/` and call it with the `run-script` action (see the
`vps-access` branch).

Infra / deploy endpoint + full security model live on the `vps-access` branch.
