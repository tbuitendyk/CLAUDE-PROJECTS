'use strict';
// engine/net.js -- one HTTPS request, bounded in time, answered as JSON. Node's
// own https and nothing else (the trading box installs no packages).
const https = require('https');

function request(method, url, { headers = {}, body = null, timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const started = Date.now();
    const lib = u.protocol === 'http:' ? require('http') : https;   // plain only for a test server on this machine
    const req = lib.request({ method, hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: `${u.pathname}${u.search}`, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
        resolve({ status: res.statusCode, json, text: json ? null : text.slice(0, 400), ms: Date.now() - started, headers: res.headers });
      });
    });
    req.on('timeout', () => { req.destroy(new Error(`no answer in ${timeoutMs / 1000} seconds`)); });
    req.on('error', (e) => resolve({ status: 0, json: null, text: e.message, ms: Date.now() - started }));
    if (body) req.write(body);
    req.end();
  });
}
const getJson = (url, opts) => request('GET', url, opts);

module.exports = { request, getJson };
