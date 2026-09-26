'use strict';
// lib/live/wsserver.js -- THE WEB SERVER'S SIDE OF A WEBSOCKET, on Node's own
// sockets and nothing else: the server end of RFC 6455 for the engines that
// call out (lib/live/enginehub.js). The upgrade, masked frames in, unmasked
// frames out, text and continuation, ping and pong, close, and a ceiling on
// the size of one message.
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WsConn extends EventEmitter {
  constructor(socket, { maxMessage = 8 << 20 } = {}) {
    super();
    this.socket = socket;
    this.maxMessage = maxMessage;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.partsSize = 0;
    this.open = true;
    this.lastAt = Date.now();
    socket.setNoDelay(true);
    socket.on('data', (chunk) => { this.lastAt = Date.now(); this.buf = Buffer.concat([this.buf, chunk]); this.read(); });
    socket.on('error', () => this.gone());
    socket.on('close', () => this.gone());
    socket.on('end', () => this.gone());
  }

  gone() { if (!this.open) return; this.open = false; this.emit('close'); }

  read() {
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
      if ((b1 & 0x80) === 0) { this.close(1002); return; }   // a client's frames are always masked
      if (len > this.maxMessage) { this.close(1009); return; }
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.alloc(len);
      for (let i = 0; i < len; i += 1) payload[i] = this.buf[off + 4 + i] ^ mask[i % 4];
      this.buf = this.buf.subarray(off + 4 + len);
      if (op === 0x9) { this.frame(payload, 0xA); continue; }
      if (op === 0xA) continue;
      if (op === 0x8) { this.close(1000); return; }
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.partsSize += len;
        if (this.partsSize > this.maxMessage) { this.close(1009); return; }
        this.parts.push(payload);
        if (fin) {
          const text = Buffer.concat(this.parts).toString('utf8');
          this.parts = [];
          this.partsSize = 0;
          this.emit('message', text);
        }
      }
    }
  }

  frame(payload, opcode) {
    if (!this.open || this.socket.destroyed) return false;
    let head;
    if (payload.length < 126) { head = Buffer.alloc(2); head[1] = payload.length; }
    else if (payload.length < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(payload.length, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(payload.length), 2); }
    head[0] = 0x80 | opcode;
    this.socket.write(Buffer.concat([head, payload]));
    return true;
  }

  send(text) { return this.frame(Buffer.from(String(text), 'utf8'), 0x1); }
  ping() { return this.frame(Buffer.alloc(0), 0x9); }

  close(code = 1000) {
    if (this.open && !this.socket.destroyed) {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(code, 0);
      try { this.frame(b, 0x8); } catch (_) { /* already gone */ }
      this.socket.end();
      setTimeout(() => { if (!this.socket.destroyed) this.socket.destroy(); }, 1000).unref();
    }
    this.gone();
  }
}

// answer an upgrade request with a refusal, in plain HTTP
function refuse(socket, status, words) {
  const body = JSON.stringify({ error: words });
  try {
    socket.write(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Bad Request'}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  } catch (_) { /* the socket went first */ }
  socket.destroy();
}

// complete the upgrade: the 101 and the accept key, then a connection
function accept(req, socket, head, opts) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { refuse(socket, 400, 'a websocket upgrade was expected'); return null; }
  const acceptKey = crypto.createHash('sha1').update(`${key}${GUID}`).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey}`, '', ''].join('\r\n'));
  const conn = new WsConn(socket, opts);
  if (head && head.length) { conn.buf = Buffer.concat([conn.buf, head]); conn.read(); }
  return conn;
}

module.exports = { accept, refuse, WsConn };
