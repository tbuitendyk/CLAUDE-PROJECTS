# Ultimate Trading System

A self-hosted web tool that hunts for predictive structure in hourly Binance
data, measures honestly whether what it found is real, and runs the survivors
forward — first on paper, then with real money.

**No AI anywhere in what it does.** Training, scoring, simulation and execution
are deterministic local arithmetic. The only network traffic is public market
data from Binance's keyless bulk-download portal. `npm ls` shows one
dependency (express).

## What it does

**Finding a candidate.** History is cut into overlapping fixed-length chunks
of hourly data from two or more pairs. Each chunk is scored by what the traded
asset did *after* the chunk ended. A pure-JavaScript classifier trains on the
older part of history and is graded on the recent part it never saw. A wide
sweep tries many combinations of asset, chunk shape and decision style against
the whole execution menu, and produces a board of promising rows — a
direction, never a result.

**Establishing it is not luck.** The same sweep is re-run with informationless
votes, so the system can measure how good "nothing" looks before judging
anything against it. A surviving row is then read twice: once against its own
random-data runs, which prices the shopping done inside that row, and once
against the whole board's, which prices having picked the best of many. A row
must pass both.

Underneath that sits a calibration check: a known pattern is planted in a
fabricated market and pushed through the real pipeline, which must find it
while random versions destroy it. The instrument is checked before its
readings count for anything.

**Running it forward.** A configuration that survives can be greenlighted and
shuttled into a trading setup, carrying an immutable snapshot of its
configuration, the chain of evidence behind it, and the engine version it was
validated on. Each configuration has two independent channels, paper and real,
which may run at the same time.

## The screens

- **Setup** &mdash; the front door. Account and system settings; deliberately
  empty for now.
- **Construct** &mdash; the guided narrowing flow, in the order the work is
  actually done: **Data**, **Sweep**, **Boards**, **Verify**, **History**,
  **Tune**, **Greenlight**.
- **Trade** &mdash; every greenlighted configuration on two design-identical
  sides, **Paper Books** and **Live Trading**, each carrying **Dashboard**,
  **Greenlights**, **Setups**, **Setup detail** and **LIVE**.

An earlier generation carried three more screens &mdash; a single-run
classifier, the sweep workbench they were built from, and standalone paper
books. They were removed in this release along with everything only they used;
what they shared with Construct stayed.

## Layout

```
server.js            Express app: the API and the static pages
live-produce.js      the multi-setup producer — one intent per due setup
live-mirror.js       re-checks every setup's decisions against fresh data
pilot-refresh.js     keeps a pair set's candle cache continuous and current

lib/binance.js       monthly zip download, unzip, CSV prune, disk cache
lib/dataset.js       chunking, gap fill, scoring, feature building
lib/features.js      the engineered feature set (pure JS)
lib/logreg.js        softmax regression, z-scoring, lambda ladder (zero imports)
lib/bracket.js       the execution simulator
lib/bracketwork.js   the sweep's unit of work, identical on main or worker
lib/planted.js       the planted-pattern calibration check
lib/paper.js         paper-trade arithmetic and the declared friction rates
lib/campaign.js      the campaign name every run carries, grouping one cycle
lib/stats.js         shared arithmetic; lib/rng.js is seeded randomness
lib/batch.js         saved run records and the run launchers
lib/historytuning.js history tuning; lib/httwo.js is the age-dial version
lib/walkforward.js   walk-forward evaluation

lib/live/            the trading side: setups, greenlights, signal, channels,
                     catalog, execution targets, mirror, views, routes

public/              setup.html, construct.html/.js, trade.html
                     (each page carries its own styling; light and dark aware)
tests/               node tests/run.js
tools/               calibration checks and one-off registration scripts
deploy/              install.sh, systemd unit, env.example (PORT=8094)
```

## Running locally

```
npm ci
npm test
npm start           # http://127.0.0.1:8094
```

## Deploying

`deploy-uts.sh` on the `vps-access` branch clones or syncs this branch on the
server and runs `deploy/install.sh`, which is idempotent. It installs to
`/opt/ultimate-trading-system` as the unit `ultimate-trading-system` on
127.0.0.1:8094, under its own service user.

The previous generation of this app is still running on the same server, from
its own directory as its own unit on 8093, and holds live trading and paper
books. Nothing in the install touches it; the installer refuses to run if the
paths or unit name ever collide, and asserts the old unit is still active
before reporting success.

The `/uts/` nginx location and the portal tile ship separately from the
`website` branch.
