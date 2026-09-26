// public/keylock.js -- TRADING KEYS ARE LOCKED IN THE BROWSER (owner,
// 2026-09-25: "encrypted in the browser so only that engine can unlock them.
// Our server relays them without being able to read them").
//
// The browser's own WebCrypto, nothing else: a one-off P-256 key pair agrees a
// secret with the engine's public half (ECDH), HKDF-SHA256 turns it into an
// AES-256-GCM key, and the API key and the secret are encrypted with it, the
// trading account's name bound into the tag. What leaves the page is the
// one-off public half, the nonce and the locked bytes -- the engine, and only
// the engine, holds the private half that opens them (engine/lock.js takes the
// same steps in reverse).
(function (root) {
  'use strict';
  const INFO = 'uts-engine-lock v1';
  const enc = (s) => new TextEncoder().encode(s);
  const toB64 = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]); return btoa(s); };
  const fromB64 = (s) => { const t = atob(s); const b = new Uint8Array(t.length); for (let i = 0; i < t.length; i += 1) b[i] = t.charCodeAt(i); return b; };

  // the fingerprint the installer printed on the machine: first 20 hex digits of the public half's SHA-256
  async function fingerprint(publicKeyB64) {
    const h = new Uint8Array(await root.crypto.subtle.digest('SHA-256', fromB64(publicKeyB64)));
    const hex = Array.from(h).map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 20);
    return hex.match(/.{4}/g).join('-');
  }

  async function lockKeys(publicKeyB64, account, apiKey, secret) {
    const subtle = root.crypto && root.crypto.subtle;
    if (!subtle) throw new Error('this browser cannot lock keys here: open the page over https');
    const engine = await subtle.importKey('spki', fromB64(publicKeyB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const mine = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'ECDH', public: engine }, mine.privateKey, 256);
    const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc(INFO) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const data = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc(`uts-keys v1|${account}`) }, key, enc(JSON.stringify({ apiKey, secret })));
    return { v: 1, epk: toB64(await subtle.exportKey('spki', mine.publicKey)), iv: toB64(iv), data: toB64(data) };
  }

  const api = { lockKeys, fingerprint, INFO };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.utsKeyLock = api;
}(typeof window !== 'undefined' ? window : globalThis));
