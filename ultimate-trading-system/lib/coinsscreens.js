// coinsscreens.js -- A NAMED SET OF FILTER BOXES, KEPT ON THE BOX (3.180.0,
// owner order 2026-09-19: "have filters that we can apply to the choose early
// read late view, which probably should be something stored").
//
// WHY IT IS WORTH A FILE. Convenience is the small part. The selection rule --
// which coins and shapes are worth carrying forward, and on what evidence --
// is the thing that should be FIXED BEFORE the numbers are looked at, and a
// named screen is that rule written down. Typing the same eleven boxes again
// on the next walk is how a rule quietly becomes whatever this morning's table
// happened to look like.
//
// ON THE BOX, not in a browser. Walk it forward's boxes are remembered per
// browser because they are a place you are standing; a screen is a decision,
// and a decision read differently on the laptop and the desktop is two
// decisions. RULE FIVE: the owner makes them, none ship built in.
//
// IT HOLDS BOXES, NOTHING ELSE. No thresholds live in this file and none are
// suggested by it -- it stores exactly the strings the owner typed, and every
// reader applies them through the same filters the screen already has.
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');
const KEY = 'coins_screens';
const MAX_SCREENS = 100;
const MAX_NAME = 60;

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (_) { return {}; }
}
// The same atomic write the other settings use: read, change, write beside,
// rename over -- so a crash mid-write leaves the old file, never half of one.
function writeSettings(change) {
  const settings = readSettings();
  change(settings);
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  const tmp = `${SETTINGS_FILE}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 1));
  fs.renameSync(tmp, SETTINGS_FILE);
  return settings;
}

// A BOX SET IS A FLAT MAP OF STRINGS. Anything else is refused by name rather
// than quietly dropped, because a screen that silently lost a box would read
// as a rule it is not.
function cleanBoxes(raw, which) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`the ${which} boxes have to be a set of box names and values`);
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(k)) throw new Error(`${JSON.stringify(k)} is not a box name`);
    if (v == null || v === '') continue;                 // blank hides nothing, so a blank box is not worth keeping
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      throw new Error(`the box ${JSON.stringify(k)} holds something that is not a value`);
    }
    out[k] = String(v);
  }
  return out;
}

function cleanName(raw) {
  const name = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('a screen needs a name');
  if (name.length > MAX_NAME) throw new Error(`a screen's name is at most ${MAX_NAME} characters — that one is ${name.length}`);
  return name;
}

const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

function listScreens() {
  const raw = readSettings()[KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === 'object' && typeof x.name === 'string' && x.name.trim())
    .map((x) => ({ name: String(x.name), walk: (x.walk && typeof x.walk === 'object') ? x.walk : {}, split: (x.split && typeof x.split === 'object') ? x.split : {} }))
    .sort(byName);
}

// SAVING UNDER A NAME THAT EXISTS REPLACES IT, and says which of the two it
// did, so the screen can say "saved" or "replaced" rather than guessing.
function saveScreen(rawName, walk, split) {
  const name = cleanName(rawName);
  const one = { name, walk: cleanBoxes(walk, 'Walk it forward'), split: cleanBoxes(split, 'Choose early, read late') };
  let replaced = false;
  writeSettings((s) => {
    const list = listScreens().filter((x) => {
      if (x.name.toLowerCase() !== name.toLowerCase()) return true;
      replaced = true;
      return false;
    });
    if (list.length >= MAX_SCREENS) throw new Error(`there are already ${list.length} screens on this box — delete one first`);
    list.push(one);
    s[KEY] = list.sort(byName);
  });
  return { saved: one, replaced, screens: listScreens() };
}

function renameScreen(rawFrom, rawTo) {
  const from = cleanName(rawFrom);
  const to = cleanName(rawTo);
  const have = listScreens();
  if (!have.some((x) => x.name.toLowerCase() === from.toLowerCase())) throw new Error(`there is no screen called ${JSON.stringify(from)} on this box`);
  if (from.toLowerCase() !== to.toLowerCase() && have.some((x) => x.name.toLowerCase() === to.toLowerCase())) {
    throw new Error(`a screen called ${JSON.stringify(to)} is already on this box`);
  }
  writeSettings((s) => {
    s[KEY] = have.map((x) => (x.name.toLowerCase() === from.toLowerCase() ? { ...x, name: to } : x)).sort(byName);
  });
  return { renamed: to, screens: listScreens() };
}

function deleteScreen(rawName) {
  const name = cleanName(rawName);
  const have = listScreens();
  if (!have.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error(`there is no screen called ${JSON.stringify(name)} on this box`);
  writeSettings((s) => { s[KEY] = have.filter((x) => x.name.toLowerCase() !== name.toLowerCase()); });
  return { deleted: name, screens: listScreens() };
}

// ---- A REPAIR, WRITTEN TO BE DELETED (3.193.0, RULE NINE and RULE TEN) -----
//
// 3.193.0 retired the box `shownPairsOnly` -- "keep every row of the pairs the
// reading is showing", which on a real walk is tens of thousands of rows -- and
// replaced it with `wholeOnly`, which keeps the ONE row per pair the reading is
// actually about. A screen saved before that carries the retired name, and a
// record in a vocabulary no reader speaks is the thing RULE NINE forbids.
//
// The intent carries over exactly: a screen that said "narrow this table to
// what the reading is showing" still says that, and now does it correctly. So
// the box is renamed in place rather than dropped, which would silently widen
// a saved rule.
//
// IT DIES WHEN EVERY SCREEN ON THE BOX HAS BEEN THROUGH IT. Run it, see it
// report 0 screens changed on a box with screens on it, and delete this block,
// its call in server.js and its test. It calls nothing that only it calls, so
// that is one cut.
function repairRetiredBoxNames() {
  const have = listScreens();
  const stale = have.filter((x) => x.walk && Object.prototype.hasOwnProperty.call(x.walk, 'shownPairsOnly'));
  if (!stale.length) return { changed: 0, screens: have.length };
  writeSettings((s) => {
    s[KEY] = have.map((x) => {
      if (!x.walk || !Object.prototype.hasOwnProperty.call(x.walk, 'shownPairsOnly')) return x;
      const walk = { ...x.walk };
      const was = walk.shownPairsOnly;
      delete walk.shownPairsOnly;
      if (String(was) === 'yes') walk.wholeOnly = 'yes';
      return { ...x, walk };
    }).sort(byName);
  });
  return { changed: stale.length, screens: have.length, named: stale.map((x) => x.name) };
}
// ---- end of the repair ------------------------------------------------------

module.exports = {
  KEY, MAX_SCREENS, MAX_NAME, listScreens, saveScreen, renameScreen, deleteScreen,
  repairRetiredBoxNames,
};
