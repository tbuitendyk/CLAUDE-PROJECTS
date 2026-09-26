'use strict';
// engine/lock.js -- THE ENGINE'S LOCK FOR TRADING KEYS (owner, 2026-09-25:
// "trading keys: encrypted in the browser so only that engine can unlock them.
// Our server relays them without being able to read them").
//
// A key pair made on this machine the first time the engine starts:
//   * the private half stays in this engine's data folder, readable by the
//     engine's own user alone, and never leaves this machine;
//   * the public half goes to the web server, which hands it to the browser on
//     the Account tab. The browser locks the API key and the secret with it
//     before they are sent, so the web server only ever carries the locked form.
//
// The lock (ECIES on P-256, the same steps the browser's own WebCrypto takes):
//   1. the browser makes a one-off P-256 key pair and agrees a shared secret
//      with this engine's public half (ECDH);
//   2. HKDF-SHA256 turns that secret into an AES-256-GCM key (info below);
//   3. the keys are encrypted with it, the trading account's name bound into
//      the tag -- a locked pair sent under another account's name does not open.
// The fingerprint is the first 20 hex digits of the public half's SHA-256: the
// installer prints it on the machine and the Account tab shows it, so the two
// can be compared by eye.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INFO = 'uts-engine-lock v1';
const aadFor = (account) => `uts-keys v1|${account}`;

function fingerprintOf(spkiB64) {
  const hex = crypto.createHash('sha256').update(Buffer.from(spkiB64, 'base64')).digest('hex').slice(0, 20);
  return hex.match(/.{4}/g).join('-');
}

class Lock {
  constructor(file) {
    this.file = file;
    this.privateKey = null;
    this.publicKey = null;   // spki DER, base64
  }

  // made once, readable by this engine alone -- refused otherwise
  open() {
    if (!fs.existsSync(this.file)) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const rec = {
        v: 1,
        createdAt: new Date().toISOString(),
        privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
        publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      };
      const fd = fs.openSync(this.file, 'wx', 0o600);
      fs.writeSync(fd, JSON.stringify(rec));
      fs.closeSync(fd);
    }
    if (process.platform !== 'win32' && (fs.statSync(this.file).mode & 0o077) !== 0) {
      throw new Error('the engine\'s lock can be read by other users on this machine; it is refused until only the engine can read it');
    }
    const rec = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.privateKey = crypto.createPrivateKey({ key: Buffer.from(rec.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
    this.publicKey = rec.publicKey;
    return this;
  }

  // what the web server may know and show: the public half and its fingerprint
  info() { return { publicKey: this.publicKey, fingerprint: fingerprintOf(this.publicKey), curve: 'P-256', scheme: INFO }; }

  // a locked pair in, the pair out -- or a refusal that says nothing of what was sent
  unlock(locked, account) {
    const bad = () => { const e = new Error('the locked keys could not be opened by this engine: lock them again with this engine\'s lock'); e.code = 'BAD_LOCK'; return e; };
    if (!locked || typeof locked !== 'object' || typeof locked.epk !== 'string' || typeof locked.iv !== 'string' || typeof locked.data !== 'string') throw bad();
    try {
      const epk = crypto.createPublicKey({ key: Buffer.from(locked.epk, 'base64'), format: 'der', type: 'spki' });
      const shared = crypto.diffieHellman({ privateKey: this.privateKey, publicKey: epk });
      const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from(INFO), 32));
      const all = Buffer.from(locked.data, 'base64');
      if (all.length < 17) throw bad();
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(locked.iv, 'base64'));
      d.setAAD(Buffer.from(aadFor(account)));
      d.setAuthTag(all.subarray(all.length - 16));
      const text = Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]).toString('utf8');
      const obj = JSON.parse(text);
      return { apiKey: obj.apiKey, secret: obj.secret };
    } catch (e) {
      if (e.code === 'BAD_LOCK') throw e;
      throw bad();
    }
  }
}

module.exports = { Lock, fingerprintOf, aadFor, INFO };
