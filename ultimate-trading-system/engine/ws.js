'use strict';
// engine/ws.js -- the smallest websocket client the engine needs, on Node's own
// TLS and nothing else: the trading box installs no packages, so nothing reaches
// it that was not written here (commercialization: every byte that trades is
// ours to answer for).
//
// Client side of RFC 6455: the upgrade, masked frames out, unmasked frames in,
// text and continuation, ping answered with pong, close. One connection per
// instance; reconnecting is the caller's decision, because the caller knows
// what it was subscribed to.
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class WebSocketClient extends EventEmitter {
  constructor(url, { timeoutMs = 15000 } = {}) {
    super();
    this.url = new URL(url);
    this.timeoutMs = timeoutMs;
    this.sock = null;
    this.open = false;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.lastMessageAt = 0;
  }

  connect() {
    const host = this.url.hostname;
    const plain = this.url.protocol === 'ws:';   // plain only for a test server on this machine
    const port = Number(this.url.port) || (plain ? 80 : 443);
    const key = crypto.randomBytes(16).toString('base64');
    let upgraded = false;
    const sock = plain ? net.connect({ host, port, timeout: this.timeoutMs }) : tls.connect({ host, port, servername: host, timeout: this.timeoutMs });
    this.sock = sock;
    sock.setNoDelay(true);
    sock.on(plain ? 'connect' : 'secureConnect', () => {
      sock.write([
        `GET ${this.url.pathname}${this.url.search} HTTP/1.1`, `Host: ${host}:${port}`, 'Upgrade: websocket', 'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', '', '',
      ].join('\r\n'));
    });
    sock.on('timeout', () => { if (!upgraded) sock.destroy(new Error('the upgrade took too long')); });
    sock.on('data', (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      if (!upgraded) {
        const end = this.buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = this.buf.slice(0, end).toString();
        this.buf = this.buf.slice(end + 4);
        const status = head.split('\r\n')[0];
        const want = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        if (!/^HTTP\/1\.1 101/.test(status) || !head.toLowerCase().includes(`sec-websocket-accept: ${want.toLowerCase()}`)) {
          sock.destroy(new Error(`the server did not accept the websocket: ${status}`));
          return;
        }
        upgraded = true;
        this.open = true;
        sock.setTimeout(0);
        this.emit('open');
      }
      this.readFrames();
    });
    sock.on('error', (e) => this.emit('error', e));
    sock.on('close', () => { const was = this.open; this.open = false; this.emit('close', was); });
    return this;
  }

  readFrames() {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      const masked = (b1 & 0x80) !== 0;
      const maskOff = off;
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = this.buf.slice(off, off + len);
      if (masked) { const m = this.buf.slice(maskOff, maskOff + 4); payload = Buffer.from(payload.map((x, i) => x ^ m[i % 4])); }
      this.buf = this.buf.slice(off + len);
      this.lastMessageAt = Date.now();
      if (op === 0x9) { this.send(payload, 0xA); continue; }
      if (op === 0xA) continue;
      if (op === 0x8) { this.close(); continue; }
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.parts.push(payload);
        if (fin) {
          const msg = Buffer.concat(this.parts).toString('utf8');
          this.parts = [];
          this.emit('message', msg);
        }
      }
    }
  }

  send(data, opcode = 0x1) {
    if (!this.sock || this.sock.destroyed) return false;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const mask = crypto.randomBytes(4);
    let head;
    if (payload.length < 126) { head = Buffer.alloc(2); head[1] = 0x80 | payload.length; }
    else if (payload.length < 65536) { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(payload.length, 2); }
    else { head = Buffer.alloc(10); head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(payload.length), 2); }
    head[0] = 0x80 | opcode;
    const body = Buffer.from(payload.map((x, i) => x ^ mask[i % 4]));
    this.sock.write(Buffer.concat([head, mask, body]));
    return true;
  }

  close() {
    if (!this.sock || this.sock.destroyed) return;
    try { this.send(Buffer.alloc(0), 0x8); } catch (_) { /* already gone */ }
    this.sock.end();
    setTimeout(() => { if (this.sock && !this.sock.destroyed) this.sock.destroy(); }, 1000).unref();
  }
}

module.exports = { WebSocketClient };
