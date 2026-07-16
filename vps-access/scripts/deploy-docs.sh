#!/usr/bin/env bash
# deploy-docs.sh -- deploy docs.homeandofficemicro.com from the docs-web branch.
# Points the ~/publish-homs-web checkout at CLAUDE-PROJECTS, syncs the docs-web
# branch, and runs the site's own deploy script (rsync content, install vhost,
# nginx -t, reload). Runs as root via run-script.
set -euo pipefail
cd ~/publish-homs-web
git remote set-url origin https://github.com/tbuitendyk/CLAUDE-PROJECTS.git
git fetch origin docs-web
git checkout -B docs-web origin/docs-web
bash docs-web/deploy/deploy-docs.sh
