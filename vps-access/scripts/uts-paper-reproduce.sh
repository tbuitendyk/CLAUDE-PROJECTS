#!/usr/bin/env bash
# uts-paper-reproduce.sh -- READ-ONLY. For every paper, live or stopped book:
# each recent decision as its log wrote it (the members' votes, the field, why
# nothing was sent), then the same decision worked out again now from the same
# candles with the same members, judged by the service's own comparison
# (lib/decisioncompare.js) -- the reproduce-check, run without writing its
# file. Before that: whether the reproduce-check file exists, what schedules
# anything here, and the engine's health as the service last heard it (no keys,
# no account names). Reads files and GETs through the service; writes nothing,
# sends nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
echo "== now $(date -u +%Y-%m-%dT%H:%M:%SZ), release $(python3 -c "import json;print(json.load(open('package.json'))['version'])") =="
echo "== the reproduce-check file =="
ls -la --time-style=+%FT%TZ data/live/mirror.json 2>/dev/null | sed 's/^/  /' || echo "  never written"
echo "== what schedules anything for the trading system here =="
systemctl list-timers --all --no-pager 2>/dev/null | grep -i -E 'uts|mirror|trading' | sed 's/^/  /' || echo "  no timer"
(crontab -l 2>/dev/null; cat /etc/crontab /etc/cron.d/* 2>/dev/null) | grep -i -E 'mirror|uts|trading' | sed 's/^/  cron: /' || echo "  no cron line"
echo "== the engine's health, as the service last heard it =="
curl -s --max-time 30 http://127.0.0.1:8094/api/live/engines > /tmp/uts-rep-eng.json
python3 - <<'PY'
import json
d = json.load(open('/tmp/uts-rep-eng.json'))
for e in d.get('engines', []):
    h = dict(e.get('health') or {})
    h.pop('keys', None)
    print(f"  {e.get('id')} | answers {e.get('answers')} in {e.get('ms')} ms | last seen {e.get('lastSeenUtc')}")
    print('  ' + json.dumps({k: h.get(k) for k in ('release', 'code', 'startedAt', 'feeds', 'plans', 'journalN', 'realOrders', 'modes', 'feePerLeg', 'lockProblem', 'keystoreProblem')})[:900])
PY
echo "== each book: recorded, then worked out again =="
timeout 1500 node - <<'JS'
const reg = require('./lib/live/setups');
const mirror = require('./lib/live/mirror');
const signal = require('./lib/live/signal');
const { compareDecision } = require('./lib/decisioncompare');
const short = (x, n = 12) => String(x == null ? '-' : x).slice(0, n);
(async () => {
  for (const s of reg.listSetups().filter((x) => ['paper', 'live', 'stopped'].includes(x.state))) {
    const cfg = s.configSnapshot || {};
    console.log(`\n## ${s.name} (${s.id}) | ${s.state} | greenlight ${s.provenanceRef} | config ${cfg.configVersion} | quorum ${(cfg.cell || {}).quorum} of ${(cfg.cell || {}).members} | entry ${(cfg.cell || {}).entry} gate ${(cfg.cell || {}).gate} d ${(cfg.cell || {}).dMult} t ${(cfg.cell || {}).tHours} trail ${(cfg.cell || {}).trailMult}`);
    const recs = mirror.loadDecisions(s.id);
    console.log(`  decisions in the log: ${recs.length}`);
    for (const r of recs.slice(-4)) {
      const e = r.engine || {};
      console.log(`  ${r.chunk_start} | recorded ${r.side} | why ${e.why} | sent ok ${e.ok} | votes ${JSON.stringify(r.per_member)} | band ${r.band_pct} | field ${JSON.stringify(r.field)} | hash ${short(r.input_hash)} | fp ${short(r.members_fp)} | made ${r.produced_utc}`);
      const t0 = Date.now();
      let re;
      try { re = await signal.computeSignalForChunk(s, Date.parse(r.chunk_start)); } catch (err) { re = { found: false, note: `error: ${err.message}` }; }
      const v = compareDecision(r, re);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`     again in ${secs}s: ${re.found ? `${re.side} | votes ${JSON.stringify(re.per_member)} | hash ${short(re.input_hash)}` : re.note}`);
      console.log(`     verdict: ${v.break ? 'BREAK' : v.pending ? 'pending' : 'same'}${v.reason ? ` -- ${v.reason}` : ''}`);
    }
  }
  process.exit(0);
})().catch((e) => { console.log('FAILED', e.stack); process.exit(1); });
JS
echo "exit $?"
