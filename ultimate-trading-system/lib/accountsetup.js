'use strict';
// lib/accountsetup.js -- SETTING UP A TRADING ACCOUNT, STEP BY STEP (owner,
// 2026-09-26: "we're going to follow the same build while setting-up pattern
// with a new account set-up on Binance so that i can test/set it up/design in
// one protracted step").
//
// A checklist the owner works through on the Account tab, in the Trading
// accounts section, kept on the trading account's own record so it goes when
// the record goes: each step has its guidance, the choices it asks for and the
// ticks that say it is done, and a step opens only when every one of the step
// before it is -- the same shape as a platform's checklist on the Compute tab
// (RULE ELEVEN), drawn by the same page code. The template below is the whole
// of what the screen shows, written with the owner step by step as the first
// account is set up; a step not written yet says so and is never done.
//
// WHAT A SETUP TRADES FROM (owner, 2026-09-26): a pot. With isolated margin
// each coin pair in an account is its own pot -- its own money, borrowing and
// liquidation -- and every account on the exchange (the main one, and each
// sub-account) has its own, so one pair can be funded as many times as there
// are accounts, each pot fully apart. One record here for each account on the
// exchange. No record here holds a key: keys are locked in the browser for the
// platform that trades them. No AI anywhere.
const account = require('./account');

const TEMPLATE = {
  version: 1,
  steps: [
    {
      id: 'account',
      title: 'The exchange account',
      guidance: [
        { paras: [
          'One record here for each account on the exchange that a setup trades from: your main account, or one of its sub-accounts. Each has keys of its own, made on the exchange for that account.',
          'A setup that trades real money trades from a pot of its own. With isolated margin each coin pair in an account is its own pot — its own money, its own borrowing and its own liquidation — so a loss in one never reaches another. The same pair can be funded once in every account you keep, each pot apart from the others.',
          'Put into a pot only the money its setup may trade with: its losses cannot go past what is in it.',
        ] },
        { when: { margin: 'isolated' }, ifUnset: true, heading: 'Isolated margin', paras: [
          'Each setup that trades from this account uses the pot of its own coin pair: setups on different pairs can share the account, and two setups on the same pair need an account each.',
          'Isolated margin is opened one pair at a time on the exchange, and each pair is funded on its own.',
        ] },
        { when: { margin: 'cross' }, ifUnset: true, heading: 'Cross margin', paras: [
          'The whole account is one pot, shared by everything traded from it. Keep it to one setup, or to setups on one platform, which sees all of their positions.',
        ] },
        { when: { kind: 'sub' }, heading: 'A sub-account', paras: [
          'Sub-accounts are made from your main account on the exchange. Name the record here the way you will find the sub-account there.',
        ] },
      ],
      choices: [
        { id: 'kind', label: 'Which account', options: [{ value: 'main', label: 'the main account' }, { value: 'sub', label: 'a sub-account' }] },
        { id: 'margin', label: 'Margin', options: [{ value: 'isolated', label: 'isolated — each coin pair its own pot' }, { value: 'cross', label: 'cross — one pot for the whole account' }] },
      ],
      // WHAT THE EXCHANGE CALLS THE SUB-ACCOUNT (3.274.0, owner 2026-09-27: "a
      // field for 'Exchange's sub-account identifier(s)' where the sub account
      // number and associated email address etc. can be saved ... a field of 200
      // characters for free from id text"). Asked only for a sub-account, drawn
      // right after the choice that asks it, and step 1 is not done without it.
      fields: [
        { id: 'subIds', label: 'Exchange\'s sub-account identifier(s)', when: { kind: 'sub' }, after: 'kind', max: 200,
          note: 'the sub-account\'s number, its email address, or whatever the exchange knows it by — never a key or a password' },
      ],
      ticks: [
        { id: 'exists', label: 'The account exists on the exchange' },
        { id: 'margin', label: 'Margin trading is switched on for it' },
      ],
    },
    // STEP 2 (3.273.0, owner 2026-09-27: "code step 2"): the key made on the
    // exchange to the very rules the platform keeps a key by when it is sent
    // (engine/venues/binance-account.js keyVerdict) -- it can trade and borrow,
    // it can move no money out, and it is tied to one or more addresses or, at
    // the owner's choice, open to any. The kind is the one with a secret key, because that is
    // the only kind the platform's key store signs with (engine/keystore.js).
    {
      id: 'key',
      title: 'The API key',
      guidance: [
        { paras: [
          'Make one API key on the exchange for this account. Name it there after this record, so you can always tell which key trades where.',
          'Choose the kind the exchange makes for you, which comes in two halves: an API key and a secret key. The platform signs every request with the secret key, and it cannot sign with the other kind, made from a key pair of your own. On Binance, for example, the kind to choose is called system-generated, and Binance now recommends the other kind; this platform cannot use that one.',
          'The exchange shows the secret key only once, when the key is made. Keep both halves where only you can reach them until they are sent to the trading platform at step 3; once they are sent, nothing anywhere shows them again.',
          'Allow the key to trade, and to borrow on margin: without borrowing it cannot open a short. On Binance, for example, those are the permissions called Enable Spot & Margin Trading and Enable Margin Loan, Repay & Transfer.',
          'Leave off everything that can move money out of the account: withdrawals, and transfers to other accounts. When the keys are sent, the platform asks the exchange what the key may do and will not keep a key that can move money, cannot trade or cannot borrow, and it says so when the exchange could not be asked.',
        ] },
        { when: { kind: 'sub' }, heading: 'A sub-account', paras: [
          'Make the key for the sub-account itself, not for your main account: a key trades only in the account it was made for.',
        ] },
        { when: { address: 'tied' }, ifUnset: true, heading: 'Tied to one or more addresses', paras: [
          'Give the exchange the public address of each machine the trading platform runs on, and no others. The key then works from nowhere else, even for someone who has both halves.',
          'For a rented server, that is the address its provider shows for it. If one ever changes, the key stops working from that machine until the exchange is given the new one.',
        ] },
        { when: { address: 'any' }, ifUnset: true, heading: 'Open to any address', paras: [
          'The key then works from anywhere, so both halves are all anyone would need to trade in this account, though never to take money out of it, because the key cannot.',
          'Tick "these keys may trade from any address" when the keys are sent at step 3, or the platform will not keep them. Some exchanges switch trading off on a key open to any address after a while; Binance, for example, has announced that it does.',
        ] },
      ],
      choices: [
        { id: 'address', label: 'Where it may trade from', clearsNote: 'changing this clears the last tick below: it was about the other choice',
          options: [{ value: 'tied', label: 'tied to one or more addresses — the machine(s) the trading platform runs on' }, { value: 'any', label: 'open to any address' }] },
      ],
      ticks: [
        { id: 'made', label: 'The key is made for this account, as an API key and a secret key' },
        { id: 'can', label: 'It can trade and borrow on margin' },
        { id: 'cannot', label: 'It cannot withdraw money or transfer it to another account' },
        { id: 'where', label: 'Where it may trade from is set on the exchange as chosen above', about: 'address' },
      ],
    },
    // STEPS 3 TO 6 (3.275.0, owner 2026-09-27: "just write the remaining steps").
    // Each is done by what this system can see for itself wherever it can see
    // it (`needs`, answered by NEEDS below from what the trading platforms and
    // the setups say), and by a tick only for what the owner alone can check.
    {
      id: 'keys',
      title: 'The keys go to their platform',
      guidance: [
        { paras: [
          'The keys are entered on this account\'s own record in this section, below the checklist: each trading platform has its own line there, and its Enter the keys sends them to that platform. They are locked in this browser with the platform\'s lock before they leave it, so this system passes them on without being able to read them, and the platform keeps them encrypted on its machine.',
          'Before sending, check the fingerprint of the platform\'s lock. Below, each platform\'s is shown as this browser works it out, with the command that prints the machine\'s own copy on that machine. They must be the same: a different one means the keys would be locked for another machine.',
          'Paste the API key and the secret key exactly as the exchange showed them, and press Send the keys to the trading platform. The boxes are emptied the moment the keys are sent, whether they were kept or not.',
        ] },
        { when: { address: 'tied' }, heading: 'Tied to one or more addresses', paras: [
          'Leave "these keys may trade from any address" unticked: the exchange already ties the key to the addresses you gave it.',
        ] },
        { when: { address: 'any' }, heading: 'Open to any address', paras: [
          'Tick "these keys may trade from any address" before sending, as step 2 chose, or the platform will not keep them.',
        ] },
      ],
      needs: ['keys'],
      panel: 'locks',
      ticks: [
        { id: 'fingerprint', label: 'The fingerprint of the platform\'s lock matched the one its machine printed' },
      ],
    },
    {
      id: 'reads',
      title: 'The platform reads the account',
      guidance: [
        { paras: [
          'When the keys arrive, the platform uses them to ask the exchange what the key may do, before it keeps them: whether it can trade, borrow on margin or move money, and whether it is tied to addresses. The exchange answering is this step: it shows the platform can reach this account with its keys.',
          'After that, the platform reads the account only while a setup that names it is trading: the fee the exchange charges this account on the pair, and the hourly rate it would charge to borrow, each read at most once an hour and used in place of the setup\'s own figures. In this release it does not read how much is in the pot.',
        ] },
        { when: { margin: 'cross' }, heading: 'Cross margin', paras: [
          'The borrowing rate the platform reads is the isolated rate for the coin: this release has no reading of the cross rate.',
        ] },
      ],
      needs: ['checked'],
    },
    {
      id: 'setup',
      title: 'A setup trades from it',
      guidance: [
        { paras: [
          'A setup trades from this account when its Sub-account key holds this account\'s name, exactly as this record is named. It is typed on the Trade tab, in the setup\'s Setup detail, and kept with Save.',
          'On Paper Books the setup trades on paper, at this account\'s own fee and borrowing rate. On Live Trading a setup cannot be switched to real money without it.',
        ] },
        { when: { margin: 'cross' }, heading: 'Cross margin', paras: [
          'Every setup that names this account shares its one pot: keep it to one setup, or to setups on one platform.',
        ] },
        { when: { margin: 'isolated' }, heading: 'Isolated margin', paras: [
          'Setups on different coin pairs can share this account; two setups on the same pair need an account each.',
        ] },
      ],
      needs: ['named'],
    },
    {
      id: 'money',
      title: 'Real money on',
      guidance: [
        { paras: [
          'Real money is switched on one setup at a time: on Live Trading, press Activate real for its config on Greenlights. It is refused unless the setup names this account in its Sub-account key, and unless real orders are switched on on its trading platform.',
          'In this release the trading platform places no real orders: it has no part that places them, and it starts with real orders off even when told to start with them on. Until a release that places them, this step cannot be done.',
        ] },
      ],
      needs: ['live'],
      ticks: [
        { id: 'pot', label: 'The pot holds only what the setups trading from it may lose' },
      ],
    },
  ],
};

// WHAT THIS SYSTEM CAN SEE FOR ITSELF, step by step (3.275.0). `f` is what the
// Account tab's reading gathered (server.js /api/account/trading): the platforms
// on record, the ones that did not answer, the ones holding this account's keys
// and the ones whose exchange answered about them, the setups that name this
// account and the ones on real money, and the platforms with real orders on.
// Without it -- an answer to a press, redrawn from the full reading straight
// after -- nothing here claims to know.
const namesOf = (l) => (l.length > 2 ? `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}` : l.join(' and '));
const NEEDS = {
  keys(f) {
    if (f.keysOn.length) return { ok: true, text: `the keys are on ${namesOf(f.keysOn)}` };
    if (!f.platforms.length) return { ok: false, text: 'there is no trading platform yet: one is set up on the Compute tab' };
    return { ok: false, text: `the keys are not on any trading platform${f.unanswered.length ? ` that answered (${namesOf(f.unanswered)} did not)` : ''}: press Enter the keys on this account's record below` };
  },
  checked(f) {
    if (f.checkedOn.length) return { ok: true, text: `the exchange answered ${namesOf(f.checkedOn)} about this key: it can trade and borrow on margin, and cannot move money` };
    if (f.keysOn.length) return { ok: false, text: `the keys on ${namesOf(f.keysOn)} were kept without the exchange being asked: press Replace the keys on this account's record below and send them again` };
    return { ok: false, text: 'the keys go to a trading platform first, at step 3' };
  },
  named(f) {
    if (f.named) return { ok: true, text: `${f.named} setup${f.named === 1 ? '' : 's'} name${f.named === 1 ? 's' : ''} this account in Sub-account key` };
    return { ok: false, text: `no setup names this account yet: type ${f.account} into Sub-account key on a setup's Setup detail, on the Trade tab, and press Save` };
  },
  live(f) {
    if (f.live) return { ok: true, text: `${f.live} setup${f.live === 1 ? '' : 's'} trading from this account ${f.live === 1 ? 'is' : 'are'} on real money` };
    if (!f.realOn.length) return { ok: false, text: `real orders are switched off on ${f.platforms.length ? namesOf(f.platforms) : 'every trading platform'}: this release of the platform places no real orders` };
    return { ok: false, text: 'no setup trading from this account is on real money: press Activate real for it on Live Trading' };
  },
};
const UNSEEN = { ok: false, text: 'not known here: the trading platforms and the setups were not asked' };

// ---- WHERE A CHECKLIST STANDS (the same reading as a platform's) ----------------
const matches = (when, choices) => Object.entries(when || {}).every(([k, v]) => (choices || {})[k] === v);
function choicesAsked(step, choices) { return (step.choices || []).filter((c) => !c.when || matches(c.when, choices)); }
function fieldsAsked(step, choices) { return (step.fields || []).filter((f) => !f.when || matches(f.when, choices)); }

function stepsOf(setup, facts = null) {
  const out = [];
  let before = true;
  for (const step of TEMPLATE.steps) {
    const choices = setup.choices || {};
    const ticks = (setup.ticks || {})[step.id] || {};
    const fields = setup.fields || {};
    const missing = [];
    if (step.writing) missing.push('this step is still being written');
    for (const c of choicesAsked(step, choices)) if (!choices[c.id]) missing.push(`choose ${c.label.toLowerCase()}`);
    for (const f of fieldsAsked(step, choices)) if (!String(fields[f.id] || '').trim()) missing.push(`fill in "${f.label}"`);
    // what this system sees for itself, said on the step whether it is met or not
    const said = (step.needs || []).map((n) => (facts ? NEEDS[n](facts) : UNSEEN));
    for (const x of said) if (!x.ok) missing.push(x.text);
    for (const t of step.ticks || []) if (ticks[t.id] !== true) missing.push(`tick "${t.label}"`);
    const open = before;
    const done = open && missing.length === 0;
    out.push({ id: step.id, open, done, missing, said });
    before = done;
  }
  return out;
}

const bad = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };

// what the page reads: the account, and its checklist with where each step stands
function withSteps(acct, facts = null) {
  const s = acct.setup || null;
  const f = facts ? { ...facts, account: acct.id } : null;
  return {
    id: acct.id, exchange: acct.exchange, note: acct.note || '', createdAt: acct.createdAt || null,
    setup: s ? { choices: s.choices || {}, ticks: s.ticks || {}, fields: s.fields || {}, createdUtc: s.createdUtc, updatedUtc: s.updatedUtc, templateVersion: s.templateVersion, steps: stepsOf(s, f) } : null,
  };
}
function mine(id) {
  const a = account.tradingAccount(id);
  if (!a) bad(`no trading account called ${id}`, 404);
  if (!a.setup) bad(`the trading account ${id} has no setup: start one`, 404);
  return a;
}
function save(id, setup) {
  account.saveAccountSetup(id, setup);
  return withSteps(account.tradingAccount(id));
}

// ONE PER ACCOUNT: started under the account's name and exchange. A name no
// record has yet makes the record, exactly as saving it by hand would.
function start(id, exchange) {
  const name = String(id == null ? '' : id).trim();
  let a = account.tradingAccount(name);
  if (!a) {
    try { account.saveTradingAccount({ id: name, exchange, note: '' }); } catch (e) { bad(e.message); }
    a = account.tradingAccount(name);
  } else if (a.setup) bad(`there is already a setup for the trading account ${name} — one per account`);
  const now = new Date().toISOString();
  return save(name, { templateVersion: TEMPLATE.version, createdUtc: now, updatedUtc: now, choices: {}, ticks: {} });
}

function stepOf(stepId) {
  const s = TEMPLATE.steps.find((x) => x.id === stepId);
  if (!s) bad(`no step ${stepId}`);
  return s;
}
function mustBeOpen(setup, stepId) {
  const i = TEMPLATE.steps.findIndex((x) => x.id === stepId);
  if (!stepsOf(setup)[i].open) bad(`step ${i + 1} opens when step ${i} is done`);
}

function setChoice(id, stepId, choiceId, value) {
  const a = mine(id);
  const s = { ...a.setup, choices: { ...(a.setup.choices || {}) }, ticks: { ...(a.setup.ticks || {}) } };
  const step = stepOf(stepId);
  mustBeOpen(s, stepId);
  const c = (step.choices || []).find((x) => x.id === choiceId);
  if (!c) bad(`step "${step.title}" asks no choice ${choiceId}`);
  if (c.when && !matches(c.when, s.choices)) bad(`${c.label.toLowerCase()} is not asked yet`);
  if (!c.options.find((o) => o.value === value)) bad(`${c.label.toLowerCase()}: one of ${c.options.map((o) => o.label).join(', ')}`);
  // a tick that was about this choice goes when the choice changes: it said the
  // exchange was set as chosen, and the choice is now the other one
  if (s.choices[choiceId] != null && s.choices[choiceId] !== value) {
    const kept = { ...(s.ticks[stepId] || {}) };
    for (const t of step.ticks || []) if (t.about === choiceId) delete kept[t.id];
    s.ticks[stepId] = kept;
  }
  s.choices[choiceId] = value;
  s.updatedUtc = new Date().toISOString();
  return save(id, s);
}

function setTick(id, stepId, tickId, on) {
  const a = mine(id);
  const s = { ...a.setup, ticks: { ...(a.setup.ticks || {}) } };
  const step = stepOf(stepId);
  mustBeOpen(s, stepId);
  const t = (step.ticks || []).find((x) => x.id === tickId);
  if (!t) bad(`step "${step.title}" has no tick ${tickId}`);
  s.ticks[stepId] = { ...(s.ticks[stepId] || {}), [tickId]: on === true };
  s.updatedUtc = new Date().toISOString();
  return save(id, s);
}

// A BOX OF TEXT: one line, free text, as long as the template allows, saved on
// the account's record. Asked only when its choice is made; what was saved stays
// when the choice changes, and comes back if it changes back.
function setField(id, stepId, fieldId, value) {
  const a = mine(id);
  const s = { ...a.setup, fields: { ...(a.setup.fields || {}) } };
  const step = stepOf(stepId);
  mustBeOpen(s, stepId);
  const f = (step.fields || []).find((x) => x.id === fieldId);
  if (!f) bad(`step "${step.title}" has no box ${fieldId}`);
  if (f.when && !matches(f.when, s.choices)) {
    // said in the screen's words: the choice's label and its option's label
    const words = Object.entries(f.when).map(([k, v]) => { const c = (step.choices || []).find((x) => x.id === k); const o = c ? c.options.find((y) => y.value === v) : null; return `${c ? c.label.toLowerCase() : k} is ${o ? o.label : v}`; }).join(' and ');
    bad(`${f.label} is asked only when ${words}`);
  }
  const text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (text.length > f.max) bad(`${f.label}: at most ${f.max} characters — this is ${text.length}`);
  s.fields[fieldId] = text;
  s.updatedUtc = new Date().toISOString();
  return save(id, s);
}

// the checklist goes; the trading account record and its keys stay
function remove(id) {
  mine(id);
  account.saveAccountSetup(id, null);
  return { removed: id };
}

module.exports = { TEMPLATE, NEEDS, stepsOf, withSteps, start, setChoice, setTick, setField, remove };
