// ONE STAGE 3 LAUNCH IN A PROCESS OF ITS OWN, kept alive until it is killed.
// tests/test-stagecontinue.js uses it to rehearse what the test process cannot
// do to itself: a service restart in the middle of a run (the child is killed
// outright). The heartbeat file says the process is alive. With a fourth
// argument, the launch waits until that file exists.
const fs = require('fs');
const stages = require('../../lib/stages');
const params = JSON.parse(process.argv[2]);
const beat = process.argv[3];
const go = process.argv[4] || null;
function launch() {
  try {
    const got = stages.startStage3(params);
    process.stdout.write(`${JSON.stringify(got)}\n`);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ error: String(err.message || err) })}\n`);
    process.exit(1);
  }
}
setInterval(() => { try { fs.writeFileSync(beat, String(Date.now())); } catch (_) { /* the test may have removed it */ } }, 200);
if (go) {
  const tick = () => { if (fs.existsSync(go)) launch(); else setTimeout(tick, 20); };
  tick();
} else launch();
