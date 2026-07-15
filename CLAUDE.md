# CLAUDE.md — `vps-access` branch (infra / deploy tooling + control plane)

This repo is split **one project per branch**. This branch carries only the VPS
access and deploy tooling; the products live on their own branches:

| Branch | Project | Deploy action |
|---|---|---|
| `dubber` | `youtube-spanish-dubber/` — dubbing service (backend) | `deploy-dubber` |
| `website` | `www.buitendyk.ca/` — portal + dubber web UI at `/dubber/` | `deploy-website` |
| `vps-access` | this tooling (helper, deploy-control, nginx, installers) | re-run setup as root (below) |

This is also the **control-plane branch**: cross-branch / "universal" changes to
the working environment are driven from sessions with `vps-access` selected.

## Driving the VPS (how deploys happen)

SSH (port 22) is blocked from Claude Code cloud sessions — everything goes
through the HTTPS endpoint:

- `POST https://deploy.buitendyk.ca/run` — header `Authorization: Bearer $DEPLOY_API_TOKEN` (in env)
- Body `{"action":"<action>"}` (+ `"branch":"<name>"` for `sync`)
- Actions: `status`, `sync`, `deploy-website`, `deploy-dubber`, `restart-dubber`, `maint-report` (read-only host diagnostics), `run-script` (+ `"script":"<name>"`)
- `run-script` executes a committed script from `vps-access/scripts/` as root
  (self-syncs this branch first). Flow: write the script → commit & push here →
  call `run-script`. Names are regex-validated, no inline commands, ~8 KB output
  cap, 15-min timeout. Destructive scripts need explicit user sign-off first —
  see `vps-access/scripts/README.md`.
- `deploy-website` / `deploy-dubber` **self-sync their branch** from origin, then
  run its `deploy/install.sh` (the dubber installer auto-restarts the service).
  `sync` is for refreshing the `vps-access` checkout / inspection. `status`
  reports the box's current checkout branch + service health.

## Editing this tooling

`vps-access/setup-claude-access.sh` is the **installer** that writes the on-box
helper `/usr/local/sbin/claude-deploy`. Editing it here does NOT update the box;
re-apply it **as root over SSH** (deliberately not an endpoint action — that
would widen the root surface a session can reach):

```bash
# as root on the VPS:
cd /root/claude-projects
git fetch origin vps-access && git reset --hard origin/vps-access
sudo bash vps-access/setup-claude-access.sh "$(cat /home/claude-deploy/.ssh/authorized_keys)"
```

The HTTPS endpoint itself (`deploy-control/`) installs via
`vps-access/install-deploy-control.sh` (also root-only). Full design + security
model: `vps-access/README.md`.

## Cross-branch changes from here

In cloud sessions, branch **creates and pushes work**, but branch **deletes and
default-branch changes are blocked** (git-proxy 403 / no API) — those need the
GitHub web UI. To change another project's branch, use local git:
`git checkout <branch>` → edit → commit → `git push -u origin <branch>`.
