import https from 'node:https';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { recordCrypto } from './traffic.mjs';

export function client(baseUrl, { cert, key, ca } = {}) {
  const base = new URL(baseUrl);
  const transport = base.protocol === 'http:' ? http : https;
  const options = base.protocol === 'http:' ? {} : { cert, key, ca };

  return (path, body, timeoutMs = 10000) => new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const data = Buffer.from(JSON.stringify(body));
    let settled = false;
    const finishError = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };
    const timer = setTimeout(() => {
      const err = new Error('crypto timeout');
      err.name = 'TimeoutError';
      finishError(err);
      req.destroy(err);
    }, timeoutMs);
    const req = transport.request(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('error', finishError);
      res.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', finishError);
    req.end(data);
  });
}

// ponytail: no keep-alive pooling or retry; add when load demands.
let def;
export function post(path, body, timeoutMs, meta) {
  const read = (name) => (process.env[name] ? readFileSync(process.env[name]) : undefined);
  def ??= client(process.env.CRYPTO_URL || 'https://crypto-api:2796', {
    cert: read('CRYPTO_CERT'),
    key: read('CRYPTO_KEY'),
    ca: read('CRYPTO_CA'),
  });
  // Metadata only: path without query, status/timeout/error, duration. No body, headers or identity.
  const p = path.split('?')[0];
  const t0 = performance.now();
  const extra = meta?.probe === true ? { probe: true } : {};
  return def(path, body, timeoutMs).then(
    (r) => {
      recordCrypto({ at: Date.now(), path: p, status: r.status, ms: Math.round(performance.now() - t0), ...extra });
      return r;
    },
    (err) => {
      const timeout = err?.name === 'AbortError' || err?.name === 'TimeoutError';
      recordCrypto({ at: Date.now(), path: p, status: timeout ? 'timeout' : 'error', ms: Math.round(performance.now() - t0), ...extra });
      throw err;
    },
  );
}
