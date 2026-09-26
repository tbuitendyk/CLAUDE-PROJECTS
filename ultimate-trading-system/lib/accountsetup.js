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
      ticks: [
        { id: 'exists', label: 'The account exists on the exchange' },
        { id: 'margin', label: 'Margin trading is switched on for it' },
      ],
    },
    // the road ahead, written with the owner as the account is set up
    { id: 'key', title: 'The API key', writing: true },
    { id: 'keys', title: 'The keys go to their platform', writing: true },
    { id: 'reads', title: 'The platform reads the account', writing: true },
    { id: 'setup', title: 'A setup trades from it', writing: true },
    { id: 'money', title: 'Real money on', writing: true },
  ],
};

// ---- WHERE A CHECKLIST STANDS (the same reading as a platform's) ----------------
const matches = (when, choices) => Object.entries(when || {}).every(([k, v]) => (choices || {})[k] === v);
function choicesAsked(step, choices) { return (step.choices || []).filter((c) => !c.when || matches(c.when, choices)); }

function stepsOf(setup) {
  const out = [];
  let before = true;
  for (const step of TEMPLATE.steps) {
    const choices = setup.choices || {};
    const ticks = (setup.ticks || {})[step.id] || {};
    const missing = [];
    if (step.writing) missing.push('this step is still being written');
    for (const c of choicesAsked(step, choices)) if (!choices[c.id]) missing.push(`choose ${c.label.toLowerCase()}`);
    for (const t of step.ticks || []) if (ticks[t.id] !== true) missing.push(`tick "${t.label}"`);
    const open = before;
    const done = open && missing.length === 0;
    out.push({ id: step.id, open, done, missing });
    before = done;
  }
  return out;
}

const bad = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };

// what the page reads: the account, and its checklist with where each step stands
function withSteps(acct) {
  const s = acct.setup || null;
  return {
    id: acct.id, exchange: acct.exchange, note: acct.note || '', createdAt: acct.createdAt || null,
    setup: s ? { choices: s.choices || {}, ticks: s.ticks || {}, createdUtc: s.createdUtc, updatedUtc: s.updatedUtc, templateVersion: s.templateVersion, steps: stepsOf(s) } : null,
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

// the checklist goes; the trading account record and its keys stay
function remove(id) {
  mine(id);
  account.saveAccountSetup(id, null);
  return { removed: id };
}

module.exports = { TEMPLATE, stepsOf, withSteps, start, setChoice, setTick, remove };
