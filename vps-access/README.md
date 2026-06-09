# VPS access for Claude Code sessions

Scoped SSH access from Claude Code (web) sessions to the production VPS
(`homsionos01.homeandofficemicro.com`), so the dev → deploy → test → read-logs
cycle happens in one place instead of by copy-paste relay.

## The security model in one paragraph

Claude sessions connect as a dedicated **`claude-deploy`** user — key-only
login, locked password, no port/agent forwarding. That user can read service
logs (`journalctl`) and anything world-readable, and can run **exactly one
command as root**: `sudo claude-deploy <action>`, a root-owned helper script
with a fixed five-action menu (`sync`, `deploy-website`, `deploy-dubber`,
`restart-dubber`, `status`). Nothing else on the box — mail server, certs,
databases, other sites — is reachable with elevated rights. On top of that,
every SSH command Claude runs goes through the normal Claude Code permission
prompt, so you see and approve each one before it executes (as long as you
stay in the default permission mode and don't allowlist `ssh`).

One honest caveat: `sync` + `deploy-*` runs whatever is on the git branch as
root (the `install.sh` scripts). That was already true of the manual workflow
— the real trust boundary is the branch content, which you review as commits
and approve as commands.

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
git fetch origin claude/youtube-spanish-voiceover-QH2I2
git reset --hard origin/claude/youtube-spanish-voiceover-QH2I2
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
| Setup script | add: `bash vps-access/session-setup.sh` |

### 5. Test in a fresh session

Start a new Claude Code session on this repo and ask Claude to run
`ssh vps 'sudo claude-deploy status'`. You'll get a permission prompt showing
the exact command; approve it and you should see the dubber + nginx health.

## Day-to-day usage

```bash
ssh vps 'journalctl -u youtube-dubber -n 100'        # read logs (no sudo)
ssh vps 'sudo claude-deploy sync claude/youtube-spanish-voiceover-QH2I2'
ssh vps 'sudo claude-deploy deploy-website'
ssh vps 'sudo claude-deploy deploy-dubber'
ssh vps 'sudo claude-deploy restart-dubber'          # also kills a RUNNING dub job
ssh vps 'sudo claude-deploy status'
```

## Revoking access

Any one of these is sufficient; do all three to be thorough:

```bash
# on the VPS, as root:
userdel -r claude-deploy
rm -f /etc/sudoers.d/claude-deploy /usr/local/sbin/claude-deploy \
      /etc/ssh/sshd_config.d/claude-deploy.conf
```

…and delete the `VPS_SSH_PRIVATE_KEY_B64` secret from the Claude Code
environment.
