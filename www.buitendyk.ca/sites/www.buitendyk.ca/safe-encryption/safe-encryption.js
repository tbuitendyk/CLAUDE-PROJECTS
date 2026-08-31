/* UI for /safe-encryption/. All of the interesting work is in sevenzip.js;
   this file only moves text between two boxes and keeps the user informed.

   Deliberately absent: any fetch, any storage, any analytics. The page's
   Content-Security-Policy blocks network access outright, so adding one here
   would fail loudly rather than quietly leak. */

import {
  createArchive, readArchive, toBase64, fromBase64, wrapBase64, deflateAvailable,
} from './sevenzip.js?v=1';

const $ = (id) => document.getElementById(id);

const keyInput = $('key');
const plain = $('plain');
const cipher = $('cipher');
const statusLine = $('status');
const statusText = $('status-text');
const statusDot = $('status-dot');
const progress = $('progress');
const progressFill = $('progress-fill');
const fileInput = $('file');

const buttons = ['encrypt', 'decrypt', 'clear', 'regen', 'copy-key', 'copy-cipher', 'download', 'load']
  .map($);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* The last archive we built or loaded, so "Download .7z" hands over the exact
   bytes rather than re-deriving a key to rebuild them. */
let lastArchive = null;

/* ------------------------------------------------------------------ *
 * Key generation
 * ------------------------------------------------------------------ */

/* No 0/O and no 1/l/I: these get read aloud, written on paper and typed into
   7-Zip by hand, and a key you cannot transcribe is a key you have lost.
   57 characters over 32 positions is about 186 bits. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const KEY_CHARS = 32;
const GROUP = 4;

function generateKey() {
  const out = [];
  /* Rejection sampling: taking a raw byte modulo 57 would quietly favour the
     first 27 letters of the alphabet. */
  const limit = 256 - (256 % ALPHABET.length);
  const buf = new Uint8Array(64);
  while (out.length < KEY_CHARS) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < KEY_CHARS; i++) {
      if (buf[i] < limit) out.push(ALPHABET[buf[i] % ALPHABET.length]);
    }
  }
  const groups = [];
  for (let i = 0; i < out.length; i += GROUP) groups.push(out.slice(i, i + GROUP).join(''));
  return groups.join('-');
}

/* ------------------------------------------------------------------ *
 * Status and progress
 * ------------------------------------------------------------------ */

function setStatus(message, tone) {
  statusText.textContent = message;
  statusLine.classList.toggle('bad', tone === 'bad');
  statusLine.classList.toggle('good', tone === 'good');
  statusDot.className = 'dot' + (tone === 'bad' ? ' error' : tone === 'good' ? ' unlocked' : ' locked');
}

function showProgress(fraction) {
  progress.hidden = false;
  progressFill.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
}

function hideProgress() {
  progress.hidden = true;
  progressFill.style.width = '0';
}

function setBusy(busy) {
  for (const b of buttons) if (b) b.disabled = busy;
}

function bytes(n) {
  if (n < 1024) return n + ' bytes';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function updateCounts() {
  const p = plain.value;
  $('plain-count').textContent = p
    ? p.length.toLocaleString() + ' characters, ' + bytes(encoder.encode(p).length)
    : 'empty';
  const c = cipher.value.replace(/\s+/g, '');
  $('cipher-count').textContent = c
    ? c.length.toLocaleString() + ' characters of base64'
    : 'empty';
}

/* ------------------------------------------------------------------ *
 * Encrypt / decrypt
 * ------------------------------------------------------------------ */

/* The key derivation is 524,288 rounds of SHA-256 by design -- that slowness
   is what makes a stolen archive expensive to attack -- so it gets a progress
   bar rather than a frozen tab. */
function derivationProgress(fraction) {
  showProgress(fraction * 0.9);
  setStatus('Deriving the key from your passphrase… ' + Math.round(fraction * 100) + '%');
}

async function doEncrypt() {
  const text = plain.value;
  const key = keyInput.value.trim();
  if (!text) return setStatus('There is nothing in the plain text box yet.', 'bad');
  if (!key) return setStatus('Enter or generate a key first.', 'bad');

  setBusy(true);
  const started = performance.now();
  try {
    const content = encoder.encode(text);
    const archive = await createArchive({
      content,
      password: key,
      onProgress: ({ stage, fraction }) => {
        if (stage === 'deriving') derivationProgress(fraction);
        else { showProgress(0.9); setStatus('Compressing and encrypting…'); }
      },
    });
    lastArchive = archive;
    cipher.value = wrapBase64(toBase64(archive));
    updateCounts();
    showProgress(1);
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const ratio = Math.round((archive.length / content.length) * 100);
    setStatus('Encrypted ' + bytes(content.length) + ' into a ' + bytes(archive.length)
      + ' archive (' + ratio + '% of the original) in ' + secs + 's. '
      + 'Save the key somewhere safe before you close this tab.', 'good');
  } catch (err) {
    setStatus(err.message || String(err), 'bad');
  } finally {
    setBusy(false);
    setTimeout(hideProgress, 600);
  }
}

async function doDecrypt() {
  const key = keyInput.value.trim();
  if (!cipher.value.trim()) return setStatus('Paste an encrypted block into the bottom box first.', 'bad');
  if (!key) return setStatus('Enter the key that was used to encrypt it.', 'bad');

  setBusy(true);
  try {
    const archive = fromBase64(cipher.value);
    const { content } = await readArchive(archive, key, derivationProgress);
    lastArchive = archive;
    plain.value = decoder.decode(content);
    updateCounts();
    showProgress(1);
    setStatus('Decrypted ' + bytes(content.length) + ' back into the plain text box.', 'good');
  } catch (err) {
    setStatus(err.message || String(err), 'bad');
  } finally {
    setBusy(false);
    setTimeout(hideProgress, 600);
  }
}

/* ------------------------------------------------------------------ *
 * Clipboard, download, file loading
 * ------------------------------------------------------------------ */

async function copy(value, what) {
  if (!value) return setStatus('Nothing to copy yet.', 'bad');
  try {
    await navigator.clipboard.writeText(value);
    setStatus(what + ' copied to the clipboard.', 'good');
  } catch {
    setStatus('This browser would not let the page use the clipboard — select the text and copy it by hand.', 'bad');
  }
}

function download() {
  if (!lastArchive) return setStatus('Encrypt something first, or load a .7z file.', 'bad');
  const blob = new Blob([lastArchive], { type: 'application/x-7z-compressed' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'safe-message.7z';
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Revoked on a later turn of the loop: revoking synchronously can beat the
     download to the punch in some browsers. */
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  setStatus('Saved safe-message.7z. 7-Zip opens it with the same key.', 'good');
}

async function loadFile(file) {
  if (!file) return;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    lastArchive = buf;
    cipher.value = wrapBase64(toBase64(buf));
    updateCounts();
    setStatus('Loaded ' + file.name + ' (' + bytes(buf.length) + '). Enter its key and press Decrypt.', 'good');
  } catch (err) {
    setStatus('Could not read that file: ' + (err.message || err), 'bad');
  }
}

function clearAll() {
  plain.value = '';
  cipher.value = '';
  lastArchive = null;
  keyInput.value = generateKey();
  updateCounts();
  setStatus('Cleared, with a fresh key.', 'good');
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

$('encrypt').addEventListener('click', doEncrypt);
$('decrypt').addEventListener('click', doDecrypt);
$('clear').addEventListener('click', clearAll);
$('regen').addEventListener('click', () => {
  keyInput.value = generateKey();
  setStatus('New key generated. The old one still opens anything you already encrypted with it.', 'good');
});
$('copy-key').addEventListener('click', () => copy(keyInput.value, 'Key'));
$('copy-cipher').addEventListener('click', () => copy(cipher.value, 'Encrypted text'));
$('download').addEventListener('click', download);
$('load').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  loadFile(fileInput.files && fileInput.files[0]);
  fileInput.value = '';
});

plain.addEventListener('input', () => { updateCounts(); });
cipher.addEventListener('input', () => { lastArchive = null; updateCounts(); });

/* Typing into the encrypted box by hand means the bytes behind the Download
   button are stale; re-deriving them on demand keeps the two honest. */
cipher.addEventListener('blur', () => {
  if (lastArchive || !cipher.value.trim()) return;
  try { lastArchive = fromBase64(cipher.value); } catch { /* left null until it parses */ }
});

/* Leave the page and the boxes go with you -- some browsers restore text box
   contents after a crash or a back-navigation, which is not what anyone wants
   from a page like this. */
window.addEventListener('pagehide', () => {
  plain.value = '';
  cipher.value = '';
  lastArchive = null;
});

keyInput.value = generateKey();
updateCounts();
setStatus(deflateAvailable
  ? 'Ready. A key has been generated for you.'
  : 'Ready. This browser cannot compress, so archives will be a little larger.');
