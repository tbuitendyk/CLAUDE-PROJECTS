#!/usr/bin/env bash
# delete-branch.sh -- list or delete stale claude/* branches on CLAUDE-PROJECTS
# via the GitHub API. Reached through:  run-script delete-branch.sh [<branch>]
#
#   (no argument)  -> LIST the deletable claude/* branches. Changes nothing.
#   <branch>       -> DELETE that branch. Must be 'claude/*' and must NOT be a
#                     protected/real project branch or the repo default.
#
# Auth: a fine-grained PAT with 'Contents: write' on tbuitendyk/CLAUDE-PROJECTS
# ONLY, stored as GITHUB_BRANCH_TOKEN in /etc/deploy-control/env. That scope is
# branch/content writes to THIS repo -- it cannot delete the repo, and cannot
# touch any other repo. Deleting a branch is recoverable; deleting a repo is not,
# and this token deliberately can't do the latter.
set -euo pipefail

OWNER=tbuitendyk
REPO=CLAUDE-PROJECTS
API=https://api.github.com
ENV_FILE=/etc/deploy-control/env
# Real project branches -- never deletable, even if named explicitly.
PROTECTED="vps-access website dubber docs-web vps-to-nas-backups main master"

tok="$(sed -n 's/^GITHUB_BRANCH_TOKEN=//p' "$ENV_FILE" 2>/dev/null | head -1)"
[[ -n "$tok" ]] || { echo "GITHUB_BRANCH_TOKEN missing from $ENV_FILE" >&2; exit 1; }
hdr=(-H "Authorization: Bearer $tok"
     -H "Accept: application/vnd.github+json"
     -H "X-GitHub-Api-Version: 2022-11-28")

branch="${1:-}"

# --- list mode (no argument): safe, read-only ---
if [[ -z "$branch" ]]; then
  echo "Deletable claude/* branches on $OWNER/$REPO:"
  curl -fsS "${hdr[@]}" "$API/repos/$OWNER/$REPO/branches?per_page=100" \
    | grep -oE '"name":[[:space:]]*"[^"]+"' | sed -E 's/.*"([^"]+)"$/\1/' \
    | grep '^claude/' | sed 's/^/  /' || echo "  (none)"
  echo "-- run again with a branch name as the argument to delete it --"
  exit 0
fi

# --- guards (delete mode) ---
if [[ ! "$branch" =~ ^claude/[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "Refusing: only 'claude/*' session branches may be deleted (got: $branch)" >&2
  exit 1
fi
for p in $PROTECTED; do
  [[ "$branch" == "$p" ]] && { echo "Refusing: '$branch' is protected" >&2; exit 1; }
done
def="$(curl -fsS "${hdr[@]}" "$API/repos/$OWNER/$REPO" \
  | grep -oE '"default_branch":[[:space:]]*"[^"]+"' | sed -E 's/.*"([^"]+)"$/\1/')"
[[ "$branch" == "$def" ]] && { echo "Refusing: '$branch' is the default branch" >&2; exit 1; }

# --- delete ---
echo "Deleting $OWNER/$REPO branch: $branch"
code="$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "${hdr[@]}" \
  "$API/repos/$OWNER/$REPO/git/refs/heads/$branch")"
case "$code" in
  204)     echo "deleted: $branch" ;;
  404|422) echo "already gone / not found: $branch (HTTP $code)" ;;
  401|403) echo "auth/permission error (HTTP $code): check GITHUB_BRANCH_TOKEN scope" >&2; exit 1 ;;
  *)       echo "delete failed for $branch: HTTP $code" >&2; exit 1 ;;
esac
