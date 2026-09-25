'use strict';
// engine/keystore.js -- THE TRADING ACCOUNTS' KEYS, KEPT BY THE ENGINE ALONE
// (loop of 2026-09-25, item 7 of the read-back; S8).
//
// Built to sell: each trading account's keys are entered once on Setup >
// Account, pass through the web box without being kept there, and are stored
// here, on the trading box, encrypted:
//   * one file per trading account, AES-256-GCM, a fresh random nonce each
//     write, the account's name bound into the tag -- a file copied under
//     another account's name does not open;
//   * the key that opens them is 32 random bytes in a file of its own that only
//     the engine's user can read (made on first start, never sent anywhere);
//   * nothing here ever hands a key back: the list says present or missing and
//     when it was entered, nothing more; the signer signs a request without the
//     secret leaving this module;
//   * every use is written down -- which account, what for, when -- and never
//     what the key is.
// No part of either half of a key ever reaches a record, a log line or an answer.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// the name a setup gives its trading account (its keyRef), safe as a file name
const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// what a venue's key looks like: printable, no spaces, a sane length
const PART_RE = /^[A-Za-z0-9._~+/=-]{16,256}$/;

class KeyStore {
  constructor({ dir, masterFile, record = () => {}, now = () => Date.now() }) {
    this.dir = dir;
    this.masterFile = masterFile;
    this.record = record;
    this.now = now;
    this.master = null;
  }

  // the key that opens every file here: made once, readable by this user alone
  open() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(this.masterFile)) {
      fs.mkdirSync(path.dirname(this.masterFile), { recursive: true, mode: 0o700 });
      const fd = fs.openSync(this.masterFile, 'wx', 0o600);
      fs.writeSync(fd, crypto.randomBytes(32));
      fs.closeSync(fd);
    }
    const st = fs.statSync(this.masterFile);
    if ((st.mode & 0o077) !== 0) throw new Error('the key store\'s own key can be read by other users on this machine; it is refused until only the engine can read it');
    const k = fs.readFileSync(this.masterFile);
    if (k.length !== 32) throw new Error('the key store\'s own key is not 32 bytes');
    this.master = k;
    return this;
  }

  fileOf(account) {
    if (typeof account !== 'string' || !ACCOUNT_RE.test(account)) {
      const e = new Error('a trading account is named with 1 to 64 of letters, digits, dot, dash and underscore, starting with a letter or digit');
      e.code = 'BAD_ACCOUNT';
      throw e;
    }
    return path.join(this.dir, `${account}.key`);
  }

  seal(account, obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.master, iv);
    c.setAAD(Buffer.from(`uts-engine key ${account}`));
    const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
  }

  unseal(account, box) {
    const d = crypto.createDecipheriv('aes-256-gcm', this.master, Buffer.from(box.iv, 'base64'));
    d.setAAD(Buffer.from(`uts-engine key ${account}`));
    d.setAuthTag(Buffer.from(box.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8'));
  }

  // store (or replace) one account's keys; answers what the list answers, never the keys
  put(account, { apiKey, secret } = {}) {
    const f = this.fileOf(account);
    if (typeof apiKey !== 'string' || !PART_RE.test(apiKey) || typeof secret !== 'string' || !PART_RE.test(secret)) {
      const e = new Error('both halves of the key are needed, each 16 to 256 characters with no spaces');
      e.code = 'BAD_KEY';
      throw e;
    }
    const was = fs.existsSync(f);
    const rec = { v: 1, account, addedAt: new Date(this.now()).toISOString(), box: this.seal(account, { apiKey, secret }) };
    const tmp = `${f}.tmp${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
    fs.renameSync(tmp, f);
    this.record({ type: 'keys', what: was ? 'replaced' : 'entered', account });
    return this.describe(account);
  }

  remove(account) {
    const f = this.fileOf(account);
    if (!fs.existsSync(f)) return { account, present: false };
    fs.unlinkSync(f);
    this.record({ type: 'keys', what: 'removed', account });
    return { account, present: false };
  }

  read(account) {
    const f = this.fileOf(account);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  }

  describe(account) {
    const r = this.read(account);
    return r ? { account, present: true, addedAt: r.addedAt } : { account, present: false };
  }

  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter((n) => n.endsWith('.key')).map((n) => n.slice(0, -4)).filter((a) => ACCOUNT_RE.test(a)).sort().map((a) => this.describe(a));
  }

  // A SIGNER FOR ONE ACCOUNT: the public half goes in the request's header, the
  // secret half signs the request here and never leaves. Each signature is a
  // use, and each use is written down with what it was for.
  signer(account, purpose) {
    const r = this.read(account);
    if (!r) { const e = new Error(`no keys are stored for the trading account ${account}`); e.code = 'NO_KEYS'; throw e; }
    const { apiKey, secret } = this.unseal(account, r.box);
    const record = this.record;
    return {
      account,
      header: () => apiKey,
      sign: (payload, why = purpose) => {
        record({ type: 'keys', what: 'used', account, purpose: why });
        return crypto.createHmac('sha256', secret).update(String(payload)).digest('hex');
      },
    };
  }
}

module.exports = { KeyStore, ACCOUNT_RE };
