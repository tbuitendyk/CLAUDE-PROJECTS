# VPS access for Claude Code sessions

Scoped access from Claude Code cloud sessions to the production VPS, so the
dev → deploy → test cycle happens in one place instead of by copy-paste relay.

> ## ⚠️ Which mechanism to use
>
> **SSH does not work from Claude Code cloud sessions.** Their egress is forced
> through an HTTP/HTTPS proxy; raw SSH on port 22 is dropped at the TCP layer
> (verified by socket probe: 80/443 connect instantly, 22 times out). So the
> SSH kit below (`setup-claude-access.sh` + `session-setup.sh`) **cannot be
> driven from a cloud session.** It's still useful for *you* SSHing from your
> own workstation, and it builds the `claude-deploy` user + helper that the
> HTTPS path reuses.
>
> **The live mechanism for Claude is the HTTPS deploy-control endpoint** —
> see [HTTPS deploy endpoint](#https-deploy-endpoint-the-cloud-path) below.
> HTTPS sails through the proxy, so a cloud session can reach it with `curl`.

The SSH user (`claude-deploy`), its `/usr/local/sbin/claude-deploy` helper, and
the sudoers gating are the shared foundation both paths use. Set those up first
(`setup-claude-access.sh`), then add the HTTPS endpoint on top.

## Repo layout (one branch per project)

The monorepo is split so each project has its own branch — pick the matching
branch per session:

| Branch | Holds | Deployed by |
|---|---|---|
| `dubber` | `youtube-spanish-dubber/` — the dubbing service (backend) | `deploy-dubber` |
| `website` | `www.buitendyk.ca/` — the portal, incl. the dubber's web UI at `/dubber/` | `deploy-website` |
| `vps-access` | this tooling (helper, deploy-control, nginx, installers) | applied by hand (see install steps) |

`deploy-website` and `deploy-dubber` each fetch + hard-reset the deploy checkout
to their own branch before running its `install.sh`, so a deploy is a single
call that always ships the latest of the correct branch. Note the dubber spans
two branches: its **backend** is on `dubber`, its **web UI** is on `website`
(served by the portal) — so a UI-only change deploys via `deploy-website`.

## The security model in one paragraph

Claude sessions connect as a dedicated **`claude-deploy`** user — key-only
login, locked password, no port/agent forwarding. That user can read service
logs (`journalctl`) and anything world-readable, and can run **exactly one
command as root**: `sudo claude-deploy <action>`, a root-owned helper script
with a fixed seven-action menu (`sync`, `deploy-website`, `deploy-dubber`,
`restart-dubber`, `status`, `maint-report`, `run-script`). Nothing else on the box — mail server, certs,
databases, other sites — is reachable with elevated rights. On top of that,
every SSH command Claude runs goes through the normal Claude Code permission
prompt, so you see and approve each one before it executes (as long as you
stay in the default permission mode and don't allowlist `ssh`).

One honest caveat: `sync` + `deploy-*` runs whatever is on the git branch as
root (the `install.sh` scripts), and `run-script` runs whatever is committed
under `vps-access/scripts/` as root. That was already true of the manual
workflow — the real trust boundary is the branch content, which you review as
commits and approve as commands. `run-script` deliberately accepts only a
validated *name* resolved inside that fixed directory — never inline commands —
so the reviewed commit remains the only way code reaches the box. Conventions
for scripts: `vps-access/scripts/README.md`.

## Setup

### 0. Snapshot the server

Take an IONOS image/snapshot first, so there's a known-good restore point.

### 1. Generate a keypair (on your own machine)

```bash
ssh-keygen -t ed25519 -C claude-deploy@claude-code -f claude_deploy_key -N ""
```

This creates `claude_deploy_key` (private — never goes on the VPS, never in
git) and `claude_deploy_key.pub` (public).

### 2. Run the VPS-side setup (as root, on the VPS)

```bash
cd /root/claude-projects
git fetch origin vps-access
git reset --hard origin/vps-access
sudo bash vps-access/setup-claude-access.sh "$(cat /path/to/claude_deploy_key.pub)"
```

Idempotent — safe to re-run. **Before closing your root session**, test from
your own machine:

```bash
ssh -i claude_deploy_key claude-deploy@homsionos01.homeandofficemicro.com 'sudo claude-deploy status'
```

### 3. Collect the two secret values

```bash
# (a) the private key, base64-encoded to survive env-var handling:
base64 -w0 claude_deploy_key

# (b) the host key, to pin the server's identity:
ssh-keyscan -t ed25519 homsionos01.homeandofficemicro.com 2>/dev/null
```

### 4. Configure the Claude Code environment

At [claude.ai/code](https://claude.ai/code) → your environment for this repo
(docs: <https://code.claude.com/docs/en/claude-code-on-the-web>):

| Setting | Value |
|---|---|
| Secret `VPS_SSH_PRIVATE_KEY_B64` | output of step 3(a) |
| Secret `VPS_SSH_HOST_KEY` | output of step 3(b) |
| Network policy | must allow outbound SSH (port 22) — the proxied/limited policies only pass HTTP(S) |
| Setup script | **paste the contents of `session-setup.sh` directly** (see note) |

> **Why paste, not reference by path?** This kit lives only on the
> `vps-access` branch, but the environment's setup script runs in
> *every* session regardless of which branch it checks out (dubber work,
> portal work, etc.). If the setup script said `bash vps-access/session-setup.sh`,
> it would fail on every branch that doesn't carry this folder. Pasting the
> script body directly into the environment's setup-script field makes SSH
> access work from any session with no dependency on a repo file. `session-setup.sh`
> in this folder is the canonical, version-controlled copy to paste from.

### 5. Test from your workstation

From your own machine (NOT a cloud session — SSH can't egress from those):

```bash
ssh -i claude_deploy_key claude-deploy@homsionos01.homeandofficemicro.com 'sudo claude-deploy status'
```

You should see the dubber + nginx health.

## Day-to-day SSH usage (from your workstation)

```bash
ssh vps 'journalctl -u youtube-dubber -n 100'        # read logs (no sudo)
ssh vps 'sudo claude-deploy deploy-website'          # syncs the 'website' branch, then deploys
ssh vps 'sudo claude-deploy deploy-dubber'           # syncs the 'dubber' branch, then deploys
ssh vps 'sudo claude-deploy restart-dubber'          # also kills a RUNNING dub job
ssh vps 'sudo claude-deploy sync vps-access'         # refresh the infra checkout
ssh vps 'sudo claude-deploy status'
```

### Updating this helper

`setup-claude-access.sh` writes `/usr/local/sbin/claude-deploy`, so after
editing the helper on the `vps-access` branch, re-apply it **as root** on the
box (idempotent; note the `claude-deploy` user itself can't run setup — only a
real admin/root SSH session can):

```bash
# as root on the VPS:
cd /root/claude-projects
git fetch origin vps-access && git reset --hard origin/vps-access
sudo bash vps-access/setup-claude-access.sh "$(cat /home/claude-deploy/.ssh/authorized_keys)"
```

---

## HTTPS deploy endpoint (the cloud path)

This is what a Claude Code **cloud session** uses, since SSH can't get out but
HTTPS can. It fronts the *same* `claude-deploy` helper with a tiny local
service + nginx, reachable at `https://deploy.buitendyk.ca/run`.

```
cloud session → curl https://deploy.buitendyk.ca/run  (Bearer token)
              → nginx (TLS + rate limit)
              → 127.0.0.1:8090 deploy-control service  (runs as claude-deploy)
              → sudo claude-deploy <action>
```

### Components (all in `vps-access/`)

| File | Role |
|---|---|
| `deploy-control/server.py` | ~120-line stdlib service; bearer auth, action whitelist, runs the helper |
| `deploy-control/deploy-control.service` | systemd unit; runs as `claude-deploy`, reads the token from `/etc/deploy-control/env` |
| `nginx/deploy.buitendyk.ca.conf` | TLS vhost + rate limit, proxies to the local service |
| `install-deploy-control.sh` | installs all of the above; **won't touch nginx until a cert exists** |

### Install (as root, from a `vps-access` checkout)

Prereq: `setup-claude-access.sh` has already run (creates the user + helper).

```bash
sudo bash vps-access/install-deploy-control.sh
```

It installs + starts the local service (safe — loopback only), prints a
generated **bearer token once**, and then either enables the nginx vhost (if a
cert is already present) or stops and lists the remaining manual steps: a DNS
record for `deploy.buitendyk.ca`, a line in the `nginx.conf` SNI stream map,
and a TLS cert (see below). Re-run the script after those and it finishes the
nginx side.

### Cert automation

The existing certs on this box use `authenticator = manual` + DNS-01 (verified
via `/etc/letsencrypt/renewal/*.conf`): a TXT record is created by hand each
renewal, which is why they need quarterly attention — **manual DNS-01 cannot
auto-renew.** Two ways forward for `deploy.buitendyk.ca`:

* **Match the current setup (manual, unblocks today):**
  `certbot certonly --manual --preferred-challenges dns -d deploy.buitendyk.ca`
* **Automate (the real fix):** if the DNS host has an API, use its certbot DNS
  plugin (e.g. `certbot-dns-ionos`) so certbot writes the TXT record itself,
  add `--deploy-hook "systemctl reload nginx"`, and the cert renews hands-off.
  The same plugin can retrofit the three existing certs, retiring the quarterly
  chore entirely.

### Configure the Claude Code environment

Add the token as an env var (the only secret needed for this path):

```
DEPLOY_API_TOKEN=<the token the installer printed>
```

Set **Network access** to allow `deploy.buitendyk.ca` (Custom + the default
package list, or Full). No setup script or SSH key is needed for this path.

### How Claude calls it

```bash
TOKEN="$DEPLOY_API_TOKEN"
BASE="https://deploy.buitendyk.ca/run"
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

curl -fsS -X POST "$BASE" "${H[@]}" -d '{"action":"status"}'
curl -fsS -X POST "$BASE" "${H[@]}" -d '{"action":"deploy-website"}'   # self-syncs the 'website' branch
curl -fsS -X POST "$BASE" "${H[@]}" -d '{"action":"deploy-dubber"}'    # self-syncs the 'dubber' branch
curl -fsS -X POST "$BASE" "${H[@]}" -d '{"action":"restart-dubber"}'
curl -fsS -X POST "$BASE" "${H[@]}" -d '{"action":"maint-report"}'     # read-only host diagnostics (disk/mem/agent)
curl -fsS -X POST "$BASE" "${H[@]}" -d '{"action":"run-script","script":"smoke.sh"}'  # committed scripts in vps-access/scripts/ only
curl -fsS -X POST "$BASE" "${H[@]}" -d '{"action":"run-script","script":"delete-branch.sh"}'                              # list stale claude/* branches
curl -fsS -X POST "$BASE" "${H[@]}" -d '{"action":"run-script","script":"delete-branch.sh","arg":"claude/old-x"}'         # delete one
curl -fsS -X POST "$BASE" "${H[@]}" -d '{"action":"sync","branch":"vps-access"}'   # only to refresh infra tooling
```

Each returns JSON: `{ok, action, exit_code, stdout, stderr}`.

## TODO: automate certificate renewal (retire the quarterly chore)

**Current state.** Every cert (kjv/bible/vp, www + buitendyk.ca, docs.\*, and
the new deploy.\*) is issued by **manual DNS-01**. DNS is self-hosted on two
boxes edited **by hand in parallel** — BIND on an Oracle Cloud Linux VM, and
Microsoft DNS on a Windows Server 2008 R2 VM. Neither is a master; there is no
AXFR between them. Manual DNS-01 can't auto-renew, which is the every-90-days
task. Two viable ways to fix it:

### Option 1 — HTTP-01, by reclaiming port 80 for nginx (simplest end state)

Today host `:80` is held by VirtualBox NAT (forwarded into a guest), so the host
nginx can't answer ACME HTTP-01 challenges. If nginx instead **owns `:80` and
reverse-proxies to the guest by Host header**, then `certbot --nginx` (or
`--webroot`) auto-renews every cert with no DNS involvement.

- **Reclaim the port:** drop the `host:80 → guest:80` VBox NAT forward; make the
  guest reachable another way (host-only/internal network with nginx →
  `guest_ip:80`, or NAT the guest to a non-80 host port and proxy to it); let
  nginx `listen 80` with a server block per hostname.
- **Pros:** simplest renewals, no TSIG/RFC2136, no DNS-server changes; bonus
  HTTP→HTTPS redirects and central L7 routing.
- **Cons:** production rework of VirtualBox networking — the guest currently on
  `:80` must stay reachable, so it needs a careful maintenance window.

### Option 2 — automated DNS-01 via RFC2136 against the BIND box

Keep DNS-01, but let certbot write the `_acme-challenge` TXT itself.

- Run **certbot-dns-rfc2136** pointed at the BIND (Oracle Linux) box with a TSIG
  key; add `--deploy-hook "systemctl reload nginx"`.
- Because the two DNS servers are hand-synced with **no AXFR**, don't require the
  Windows box to take dynamic updates. Instead **CNAME each
  `_acme-challenge.<host>`** (added once, by hand, on both servers — fits the
  current workflow) to a name in a small zone the BIND box is authoritative for
  and accepts dynamic updates on — the standard acme-challenge delegation trick.
  certbot then updates **only** BIND; the Windows box is never touched.
- Open BIND's `:53` to the IONOS VPS, add an `update-policy` granting the TSIG
  key rights to just the challenge names.
- **Pros:** no change to port 80 / VirtualBox; works with the current TLS
  topology as-is.
- **Cons:** TSIG + BIND `update-policy` + a one-time CNAME per host; more moving
  parts than Option 1.

**Recommendation.** If you're open to reworking the port-80 / VirtualBox routing,
Option 1 is the cleaner long-term shape. If `:80` must stay forwarded to the
guest, Option 2 automates renewals without touching it. Either retrofits all
existing certs, ending the manual cycle.

## Revoking access

```bash
# on the VPS, as root:
# -- HTTPS path --
systemctl disable --now deploy-control.service
rm -f /etc/systemd/system/deploy-control.service /etc/nginx/sites-enabled/deploy.buitendyk.ca.conf
rm -rf /opt/deploy-control /etc/deploy-control
systemctl daemon-reload && nginx -t && systemctl reload nginx
# -- SSH path / shared foundation --
userdel -r claude-deploy
rm -f /etc/sudoers.d/claude-deploy /usr/local/sbin/claude-deploy \
      /etc/ssh/sshd_config.d/claude-deploy.conf
```

…and delete the `DEPLOY_API_TOKEN` (and any `VPS_SSH_*`) secrets from the
Claude Code environment.
