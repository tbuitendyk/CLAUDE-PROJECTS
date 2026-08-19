# General Classifier

A self-hosted web tool that hunts for predictive structure in Binance hourly
data. It builds weekly 8-day chunks from two trading pairs, scores each chunk
by what the trade pair did *after* the chunk ended, trains a classifier on the
older 80% of weeks, and honestly reports how well it predicted the most recent
20% it never saw.

Public face: `https://www.buitendyk.ca/classifier/` (nginx location on the
`website` branch, behind the site's Basic Auth) proxying to this Node service
on `127.0.0.1:8093`.

## How a run works

1. **Inputs** — dormant range (e.g. ±2%), trade pair (e.g. `ZECUSDT`), compare
   pair (e.g. `BTCUSDT`), start/end month.
2. **Load Data** — downloads the monthly 1h-kline zips for both pairs from
   Binance's public bulk-data portal (`data.binance.vision`; keyless, no
   account), caching each parsed month in `data/cache/` forever. Columns are
   pruned to time / open / high / low / close / quote_volume.
3. **Chunking** — every Monday 00:00 UTC starts an 8-day chunk: 192 hourly
   rows × 11 columns (shared hour + 5 fields per pair). Consecutive chunks
   overlap by one day. Isolated gaps ≤ 3h are forward-filled flat; chunks over
   bigger holes are dropped and counted.
4. **Scoring** (trade asset only, from AFTER the chunk):
   `c1` = mean of the 24 o/h/l/c values in the following Tuesday 00:00–05:59;
   `c2` = same for that week's Thursday 12:00–17:59;
   score `0` if `|c2−c1|/c1` < dormant band, else `+1` if `c1<c2`, else `−1`.
5. **Training** — two selectable feature sets (both z-scored with
   training-set statistics before training):
   - **Compressed (default, v2)** — 44 engineered numbers per chunk: per
     asset, the 8 daily returns, total return, hourly volatility and its
     late-vs-early shift, trend slope and acceleration, max drawdown/run-up,
     range, last-24h/6h momentum, and daily-volume concentration; plus 4
     cross-asset features (relative return, relative last-24h, relative
     volatility, return correlation). Few enough that the model cannot
     memorize ~300 weeks, so training accuracy becomes meaningful.
   - **Raw hourly (v1)** — all 1,920 numbers (prices normalized per chunk to
     its first open, volume to its chunk mean). Kept for A/B comparison;
     expect memorization at feasible data sizes.
   A pure-JS multinomial logistic regression trains on the first 80% of
   weeks; L2 strength is chosen from a ladder validated on the chronological
   tail of the training set; iteration count auto-stops on convergence
   (convex loss — cycles are not a quality knob).
6. **Report** — out-of-sample accuracy vs. the random (33.3%) and
   majority-class baselines, the regularization ladder, confusion matrix,
   per-class precision/recall/F1, and every held-out week with the model's
   probabilities. With the compressed set the report also lists the top
   features by |weight| (named, on standardized scale) so you can see what
   the model leaned on.

**No AI anywhere in the loop.** The only network traffic is the Binance
downloads; training and scoring are deterministic local arithmetic
(`lib/logreg.js` has zero imports). `npm ls` shows a single dependency
(express).

## Layout

```
server.js            Express app: static UI + /api/run + /api/jobs/:id
lib/binance.js       monthly zip download, single-entry unzip, CSV prune, disk cache
lib/dataset.js       Mon→Mon chunking, gap fill, Tue/Thu scoring, feature building
lib/features.js      v2 compressed feature set (44 engineered numbers, pure JS)
lib/logreg.js        softmax regression, z-scoring, lambda ladder (pure JS)
lib/pipeline.js      orchestration + report assembly
lib/tracker.js       live paper tracker (frozen models, $100 books, TRACKER.md protocol)
lib/jobs.js          in-memory async job runner (UI polls)
public/              the web page (prefix-relative URLs, light/dark aware)
deploy/              install.sh, systemd unit, env.example (PORT=8093)
tests/               node tests/run.js — zip/CSV, chunk geometry, labels, training
```

## Running locally

```
npm ci
npm test
npm start           # http://127.0.0.1:8093
```

## Deploying

Ships like the balancers: `deploy-general-classifier.sh` on the `vps-access`
branch clones/syncs this branch on the VPS and runs `deploy/install.sh`
(idempotent). The `/classifier/` nginx location + portal tile ship separately
via `deploy-website`.
