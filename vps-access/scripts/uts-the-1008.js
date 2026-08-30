// uts-the-1008.js -- READ-ONLY. 66,864 held setting names are not in the list
// the block declares today. 65,856 of those are the `voices` settings, whose
// name gained the one-voice threshold. This finds the other 1,008 and says
// what is different about them. Enumerates and compares; writes nothing.
const fs = require('fs');
const path = require('path');
const APP = '/opt/ultimate-trading-system';
const stages = require(`${APP}/lib/stages`);
const stagework = require(`${APP}/lib/stagework`);

const src = fs.readFileSync(`${APP}/lib/stages.js`, 'utf8');
const cut = (name) => {
  const i = src.indexOf(`function ${name}(`);
  return src.slice(i, src.indexOf('\n}\n', i) + 3);
};
// eslint-disable-next-line no-eval
const writeShape = eval(`${cut('shapeLabel')}; shapeLabel`);
// eslint-disable-next-line no-eval
const writeAgree = eval(`${cut('agreeLabel')}; agreeLabel`);

const dir = `${APP}/data/stagesets`;
for (const f of fs.readdirSync(dir).filter((x) => /^s3-.*\.json$/.test(x))) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const held = ((doc.plan || {}).settingLabels) || [];
  console.log('==', doc.id, held.length, 'held setting names');

  const t0 = Date.now();
  const { settings } = stages.relaunchShapeOf(doc);
  console.log('   the block declares', settings.length, 'settings, enumerated in', Date.now() - t0, 'ms');
  const declared = new Set(settings.map((s) => s.label));
  // and the SHAPE halves that survive the fold, so a name that is absent can be
  // told apart from a whole trade shape that is absent
  const declaredHeads = new Set([...declared].map((L) => L.split(' · ')[0]));
  const declaredTails = new Set([...declared].map((L) => L.split(' · ').slice(1).join(' · ')));
  settings.length = 0;

  const notDeclared = held.filter((L) => !declared.has(L));
  console.log('   held names the block does not declare:', notDeclared.length);

  // the stale-named voices are already accounted for: their name today would
  // carry the one-voice threshold. Set those aside and look at what is left.
  const staleVoices = [];
  const rest = [];
  for (const L of notDeclared) {
    const head = L.split(' · ')[0];
    const withVoice = head.replace(/^voices (\d+)%/, 'voices $1% +voice98');
    if (head !== withVoice && declaredHeads.has(withVoice)) staleVoices.push(L);
    else rest.push(L);
  }
  console.log('   of those, named voices without the threshold:', staleVoices.length);
  console.log('   LEFT OVER:', rest.length);
  console.log();

  if (!rest.length) continue;
  const by = (fn) => {
    const m = new Map();
    for (const L of rest) { const k = fn(L); m.set(k, (m.get(k) || 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  console.log('   -- is the trade shape declared at all? --');
  let headKnown = 0;
  let tailKnown = 0;
  for (const L of rest) {
    if (declaredHeads.has(L.split(' · ')[0])) headKnown++;
    if (declaredTails.has(L.split(' · ').slice(1).join(' · '))) tailKnown++;
  }
  console.log('      the part before the dot IS declared, for', headKnown, 'of', rest.length);
  console.log('      the part after  the dot IS declared, for', tailKnown, 'of', rest.length);
  console.log();
  console.log('   -- by the way of weighing --');
  for (const [k, n] of by((L) => L.split(' ')[0])) console.log(`      ${String(k).padEnd(14)} ${n}`);
  console.log('   -- by what comes after the dot (decision, band, calendar) --');
  for (const [k, n] of by((L) => L.split(' · ').slice(1).join(' · ')).slice(0, 12)) console.log(`      ${String(k).padEnd(26)} ${n}`);
  console.log('   -- by the trade shape, with numbers left in --');
  const shapes = by((L) => {
    const h = L.split(' · ')[0];
    // drop the agreement words from the front: the shape starts at the gate
    const m = h.match(/\b(always|active|directional|market)\b.*$/);
    return m ? m[0] : h;
  });
  console.log('      ', shapes.length, 'distinct trade shapes');
  for (const [k, n] of shapes.slice(0, 25)) console.log(`      ${String(k).padEnd(44)} ${n}`);
  console.log('   -- ten of them in full --');
  for (const L of rest.slice(0, 10)) console.log('      ', L);
}
