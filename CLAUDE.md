# CLAUDE.md — `general-classifier` branch (General Classifier service)

## Working style (all sessions)

Confirm the task before building. **Don't assume a direction, write a pile of
code, and burn tokens producing the wrong thing.** When anything is ambiguous or
a detail is unstated, ask one quick clarifying question and get clear alignment
first — then do the work.

- If the task is genuinely unambiguous, just do it — no needless confirmation friction.
- If there's a real fork or a missing detail, check in briefly before spending effort.
- Verify facts instead of guessing (e.g., check an address/mailbox/branch exists
  rather than assuming its spelling).
- **The owner drives all testing and UI evaluation.** Sessions verify code
  correctness only (unit tests, deploy health checks) and never run or
  interpret analyses through the interface unless explicitly asked. The owner
  is the project lead who checks the work; sessions are the expert coder,
  deployer, and recommender.

This repo is split **one project per branch**. This branch carries the
**General Classifier** (`general-classifier/`): a Node/Express service on
`127.0.0.1:8093` that downloads Binance hourly klines (monthly zips from
data.binance.vision, cached in `data/cache/`), builds weekly 8-day chunks
(Mon 00:00 → next Mon 23:59 UTC, 192h × 5 fields × 2 pairs), scores each chunk
from the FOLLOWING Tue 00:00–05:59 vs Thu 12:00–17:59 move of the trade pair
(−1 / 0 / +1 around a user-set dormant band), trains a pure-JS softmax
classifier on the first 80% of weeks and reports out-of-sample metrics on the
most recent 20%. Full spec and rationale in `general-classifier/README.md`.

**Hard constraint from the owner: no AI/LLM/API calls anywhere in the
classification path.** Data comes only from Binance's public bulk portal;
training is local deterministic math (`lib/logreg.js`, zero imports). Keep it
that way in future versions unless the owner explicitly says otherwise.

Related pieces on OTHER branches (don't edit them here):

- **`website` branch** — the portal tile and the `/classifier/` nginx location
  (proxy to 8093 behind the site Basic Auth). Ships via
  `{"action":"deploy-website"}`.
- **`vps-access` branch** — `scripts/deploy-general-classifier.sh`; deploy with
  `{"action":"run-script","script":"deploy-general-classifier.sh"}` against
  `POST https://deploy.buitendyk.ca/run` (Bearer `$DEPLOY_API_TOKEN`).

Tests: `cd general-classifier && npm test` (no network needed).
