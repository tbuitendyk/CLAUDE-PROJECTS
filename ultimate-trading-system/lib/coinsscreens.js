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

module.exports = { KEY, MAX_SCREENS, MAX_NAME, listScreens, saveScreen, renameScreen, deleteScreen };
