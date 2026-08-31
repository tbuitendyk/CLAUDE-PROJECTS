# Safe Encryption (`/safe-encryption/`)

A page that turns pasted text into a real, password-protected 7-Zip archive
without the text ever leaving the browser or touching the disk.

    key field  ->  plain text box  ->  [Encrypt]  ->  encrypted text box
                          ^                                    |
                          +-------------- [Decrypt] -----------+

The encrypted box holds base64 of a complete `.7z` file. That choice is the
whole design: the output is not a private format only this page understands.
Decode the base64 and any copy of 7-Zip opens it with the same key, so the
page can disappear tomorrow and the text is still recoverable.

## Files

| Path | What it is |
|---|---|
| `sites/www.buitendyk.ca/safe-encryption/index.html` | the page |
| `sites/www.buitendyk.ca/safe-encryption/safe-encryption.css` | page-local styles (the shared `/assets/style.css` supplies the rest) |
| `sites/www.buitendyk.ca/safe-encryption/safe-encryption.js` | UI wiring only |
| `sites/www.buitendyk.ca/safe-encryption/sevenzip.js` | the entire crypto and container path, no dependencies |
| `test/safe-encryption/roundtrip.test.mjs` | interoperability tests against the real `7z` binary |

There is no server component. Nothing was added to `deploy/install.sh`: the
files are static and ride along with the existing `rsync` in `deploy-website`.

## Running the tests

```bash
apt-get install -y p7zip-full          # provides /usr/bin/7z
node www.buitendyk.ca/test/safe-encryption/roundtrip.test.mjs
```

37 checks. They are the reason "7-Zip compatible" is a measured claim rather
than an intention: archives written here are opened by 7-Zip 23.01, archives
written by 7-Zip are opened here, and the primitives are checked against
published SHA-256/CRC-32 vectors and against Node's own SHA-256.

## Format notes

Written per message, matching what `7z a -t7z -mhe=on` produces:

```
signature header (32 bytes)
[pack stream 0]  AES-256-CBC( deflate-raw(message) )
[pack stream 1]  AES-256-CBC( the real header )
kEncodedHeader ...            <- the only part in the clear
```

- **Key derivation** is 7-Zip's own (`7zAes.cpp`, `CKeyInfo::CalcKey`): SHA-256
  run 2^19 times over `salt || UTF-16LE(password) || uint64le(round)`, final
  digest is the AES-256 key. The work factor is left at 7-Zip's default so
  stock 7-Zip opens the result with no surprises.
- **A 16-byte random salt** is used, where 7-Zip itself ships a zero-length
  one. Spec-legal, and it means two archives made with the same passphrase
  share no derived key. Both AES coders in one archive share the salt, so the
  slow derivation runs once (7-Zip's own key cache does the same).
- **The header is encrypted** — 7-Zip's "encrypt file names" mode — so the file
  name, sizes and the payload's CRC are not readable on a disk.
- **Raw CBC, not PKCS#7.** 7z zero-pads the final block and relies on the
  header's size field. WebCrypto only offers padded CBC, so `sevenzip.js`
  encrypts one block long and drops the tail, and on the way back appends a
  block engineered to decrypt to valid full padding. See the comments there.

### Two traps worth remembering

- `++typedArray[i]` evaluates to the **untruncated** value (256), not the
  stored one (0). A carry test written that way never fires, so the KDF's round
  counter silently repeats every 256 rounds — and every archive is encrypted
  with the wrong key, consistently enough that it round-trips against itself
  and fails only against real 7-Zip. This cost an hour; the test suite now
  derives keys at 2^9 and 2^12 rounds specifically to catch it.
- `frame-ancestors` is ignored in a `<meta>` CSP and logs a console error.
  The nginx vhost already sends `X-Frame-Options: SAMEORIGIN`.

## What the page promises, and what it cannot

The page declares `connect-src 'none'` in its CSP, so it cannot make a network
request even if a later edit tried to — the browser refuses. It uses no
cookies and no storage, and clears both boxes on `pagehide` so a crash-restore
does not bring the plain text back.

It cannot help with a keylogger, a clipboard manager that keeps history, or an
OS that pages memory to swap. Those limits are stated on the page itself
rather than left implied.

One browser behaviour is worth knowing: a `<textarea>` normalises CRLF to LF
in its own value, so Windows-style line endings pasted in come back as LF.
That happens before this page sees the text; the format layer itself preserves
CRLF byte for byte (there is a test for it).
