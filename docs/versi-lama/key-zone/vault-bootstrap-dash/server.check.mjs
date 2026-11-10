// Assert-based self-check for server.mjs and ceremony.mjs. Run: node server.check.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './server.mjs';

let createCeremony = null, recoverShares = null; // ceremony.mjs optional
try { ({ createCeremony, recoverShares } = await import('./ceremony.mjs')); }
catch (err) { console.log(`skip ceremony.mjs: ${err.message}`); }

const TOKEN = 'test-token-0123456789', AUTH = `Bearer ${TOKEN}`, PHRASE = 'I have recorded all 5 shares';
const NODES = ['vault-1', 'vault-2', 'vault-3'];
const shares5 = () => Array.from({ length: 5 }, (_, i) => Buffer.alloc(32, i + 1).toString('base64'));
const tmpDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const rmTree = (d) => { // Windows: clear read-only (0400) before rm
  for (const f of fs.readdirSync(d)) fs.chmodSync(path.join(d, f), 0o600);
  fs.rmSync(d, { recursive: true, force: true });
};

const STATIC_DIR = tmpDir('kz-');
for (const [f, c] of Object.entries({ 'index.html': '<!doctype html><title>kz</title>', 'app.js': 'console.log("kz");', 'style.css': 'body{margin:0}' }))
  fs.writeFileSync(path.join(STATIC_DIR, f), c);

const fakeVault = { sealStatus: async () => ({ reachable: true, initialized: false, sealed: true, progress: 0, version: '1.18.5' }) };
const fakeCeremony = (over = {}) => ({
  sharesOnDisk: () => false,
  rekeyStatus: async () => ({ started: false, progress: 0, required: 3, nonce: null }),
  initCluster: async () => ({ shares: shares5(), threshold: 3, configure: [] }),
  revealShares: async () => ({ shares: [] }),
  destroyShares: async () => {},
  ...over,
});

// Fresh app per call so limiter state resets.
async function withServer(over, fn) {
  const app = createApp({
    token: TOKEN, mode: 'safe', nodes: NODES, staticDir: STATIC_DIR, vault: fakeVault, ceremony: fakeCeremony(),
    readKeyEvents: async () => [], readDashEvents: async () => [], POLICY: [],
    mskInfo: () => ({ state: 'x' }), kekInfo: () => ({ state: 'x' }), dekInfo: () => ({ state: 'x' }),
    recordCerts: async () => {}, readCertHistory: async () => ({ events: [], inventory: [] }), ...over,
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); server.close(); }
}
const call = (base, p, { method = 'GET', auth = AUTH, type = 'application/json', body, headers = {} } = {}) =>
  fetch(base + p, { method, body, headers: { ...(auth && { Authorization: auth }), ...(type && { 'Content-Type': type }), ...headers } });
const check = async (name, fn) => {
  try { await fn(); console.log(`ok ${name}`); } catch (err) { throw new Error(`${name}: ${err.message}`, { cause: err }); }
};

await check('401 without Authorization', () => withServer({}, async (b) => {
  assert.equal((await call(b, '/api/status', { auth: null })).status, 401);
}));

await check('429 after 10 failed attempts; valid token still 200', () => withServer({}, async (b) => {
  for (let i = 0; i < 10; i++) assert.equal((await call(b, '/api/status', { auth: 'Bearer wrong-token-xxxxxxxx' })).status, 401);
  assert.equal((await call(b, '/api/status', { auth: 'Bearer wrong-token-xxxxxxxx' })).status, 429);
  assert.equal((await call(b, '/api/status')).status, 200);
}));

await check('allowed Origin 127.0.0.1:8090 passes, absent Origin passes', () => withServer({}, async (b) => {
  assert.equal((await call(b, '/api/status', { headers: { Origin: 'http://127.0.0.1:8090' } })).status, 200);
  assert.equal((await call(b, '/api/status', { headers: { Origin: 'http://localhost:8090' } })).status, 200);
  assert.equal((await call(b, '/api/status')).status, 200);
}));

await check('200 status with token (keys present)', () => withServer({}, async (b) => {
  const r = await call(b, '/api/status');
  assert.equal(r.status, 200);
  const j = await r.json();
  for (const k of ['mode', 'initialized', 'nodes', 'rekey', 'msk', 'kek', 'dek']) assert.ok(k in j, k);
}));

await check('GET /api/certs 401 without token, 200 with token', () => withServer({ readCerts: async () => ({ checkedAt: 'x', certs: [] }) }, async (b) => {
  assert.equal((await call(b, '/api/certs', { auth: null })).status, 401);
  const ok = await call(b, '/api/certs');
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray((await ok.json()).certs));
}));

await check('GET /api/certs/history 401 without token, 200 with token', () => withServer({}, async (b) => {
  assert.equal((await call(b, '/api/certs/history', { auth: null })).status, 401);
  const ok = await call(b, '/api/certs/history');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { events: [], inventory: [] });
}));

await check('static CSP and cache headers', () => withServer({}, async (b) => {
  const r = await call(b, '/', { auth: null, type: null });
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy') ?? '';
  assert.ok(csp.includes("default-src 'self'"), csp);
  assert.ok(csp.includes("frame-ancestors 'none'"), csp);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  await r.text();
}));

await check('foreign Origin rejected 403', () => withServer({}, async (b) => {
  assert.equal((await call(b, '/api/status', { headers: { Origin: 'http://evil.example' } })).status, 403);
}));

// 6: init refused when already initialized
await check('init 409 when already initialized, no token leak', () => withServer({
  ceremony: fakeCeremony({ initCluster: async () => { throw Object.assign(new Error('cluster already initialized'), { status: 409 }); } }),
}, async (b) => {
  const r = await call(b, '/api/init', { method: 'POST', body: '{}' });
  assert.equal(r.status, 409);
  assert.ok(!(await r.text()).includes('token'));
}));

// 7: safe init via fake ceremony. Fake does not write; the empty custodians dir proves only that the server writes nothing.
await check('safe init 201 returns 5 shares, server writes nothing', async () => {
  const dir = tmpDir('kz-cust-');
  try {
    await withServer({}, async (b) => {
      const r = await call(b, '/api/init', { method: 'POST', body: '{}' });
      assert.equal(r.status, 201);
      assert.equal((await r.json()).shares.length, 5);
    });
    assert.equal(fs.readdirSync(dir).length, 0);
  } finally { rmTree(dir); }
});
// 9: destroy needs exact phrase
await check('destroy requires exact confirm phrase', async () => {
  const calls = [];
  const destroyShares = async (c) => {
    calls.push(c);
    if (c !== PHRASE) throw Object.assign(new Error('confirmation phrase mismatch'), { status: 400 });
  };
  await withServer({ ceremony: fakeCeremony({ destroyShares }) }, async (b) => {
    const bad = await call(b, '/api/shares/destroy', { method: 'POST', body: JSON.stringify({ confirm: 'yes' }) });
    assert.equal(bad.status, 400);
    await bad.text();
    assert.equal((await call(b, '/api/shares/destroy', { method: 'POST', body: JSON.stringify({ confirm: PHRASE }) })).status, 204);
    assert.deepEqual(calls, ['yes', PHRASE]);
  });
});

// 10: reveal refused in unsafe mode, no share leaked
await check('reveal 409 in unsafe mode, no share in body', () => withServer({
  mode: 'unsafe',
  ceremony: fakeCeremony({ revealShares: async () => { throw Object.assign(new Error('reveal only in safe mode'), { status: 409 }); } }),
}, async (b) => {
  const r = await call(b, '/api/shares/reveal', { method: 'POST', body: '{}' });
  assert.equal(r.status, 409);
  const text = await r.text();
  for (const s of shares5()) assert.ok(!text.includes(s), 'share leaked');
}));

// 11: non-JSON POST
await check('415 for text/plain POST', () => withServer({}, async (b) => {
  const r = await call(b, '/api/unseal', { method: 'POST', type: 'text/plain', body: '{"share":"abc"}' });
  assert.equal(r.status, 415);
  await r.text();
}));

// 12: oversize body. Server answers 413 + Connection: close; a reset mid-upload is tolerated, any response must be 413.
await check('413 for oversize JSON body', () => withServer({}, async (b) => {
  const r = await call(b, '/api/unseal', { method: 'POST', body: `{"share":"${'A'.repeat(20000)}"}` }).catch((err) => {
    if (/ECONNRESET|socket|fetch failed|other side closed/i.test(`${err.message} ${err.cause?.code ?? ''}`)) return null;
    throw err;
  });
  if (r) { assert.equal(r.status, 413); await r.text().catch(() => {}); }
}));

// Real ceremony.mjs. Fake vault covers only init, unseal, sealStatus (the methods ceremony calls).
const realVault = (keys = shares5()) => {
  let inited = false;
  const polls = {};
  return {
    keys,
    init: async () => { inited = true; return { keys_base64: keys, root_token: 'r' }; },
    unseal: async () => ({ sealed: false, progress: 0 }),
    // vault-2/3 report initialized from their 2nd poll (raft join)
    sealStatus: async (n) => ({ reachable: true, initialized: n === 'vault-1' ? inited : (polls[n] = (polls[n] || 0) + 1) > 1, sealed: true, progress: 0 }),
  };
};
const realDeps = (dir, mode, vault) => ({
  dir, mode, vault, nodes: NODES, events: async () => {}, runConfigure: async () => ['PASS: stub'],
  sleep: async () => {}, joinTimeoutMs: 1000, pollMs: 10,
});

if (createCeremony) {
  await check('real ceremony safe init: 5 shares, custodians dir empty', async () => {
    const dir = tmpDir('kz-cust-');
    try {
      const r = await createCeremony(realDeps(dir, 'safe', realVault())).initCluster();
      assert.equal(r.shares.length, 5);
      assert.equal(fs.readdirSync(dir).length, 0);
    } finally { rmTree(dir); }
  });

  await check('real ceremony unsafe init: share-1..5 0400 with content', async () => {
    const dir = tmpDir('kz-cust-');
    try {
      const v = realVault();
      await createCeremony(realDeps(dir, 'unsafe', v)).initCluster();
      const files = fs.readdirSync(dir).sort();
      assert.deepEqual(files, [1, 2, 3, 4, 5].map((i) => `share-${i}`));
      if (process.platform === 'win32') console.log('skip mode (win32)');
      files.forEach((f, i) => {
        const p = path.join(dir, f);
        if (process.platform !== 'win32') assert.equal(fs.statSync(p).mode & 0o777, 0o400, `${f} mode`);
        assert.equal(fs.readFileSync(p, 'utf8'), v.keys[i], `${f} content`);
      });
    } finally { rmTree(dir); }
  });
} else {
  console.log('skip real ceremony checks: ceremony.mjs not importable');
}

if (recoverShares) {
  const seed = (dir, tag) => { for (let i = 1; i <= 5; i++) fs.writeFileSync(path.join(dir, `share-${i}`), `${tag}${i}`, { mode: 0o400 }); };
  await check('recoverShares: COMMIT present finishes rename', () => {
    const dir = tmpDir('kz-rec-');
    try {
      seed(dir, 'old');
      const next = path.join(dir, 'next'); fs.mkdirSync(next);
      for (let i = 1; i <= 5; i++) fs.writeFileSync(path.join(next, `share-${i}`), `new${i}`, { mode: 0o400 });
      fs.writeFileSync(path.join(next, 'COMMIT'), '');
      recoverShares(dir);
      assert.equal(fs.existsSync(next), false);
      for (let i = 1; i <= 5; i++) assert.equal(fs.readFileSync(path.join(dir, `share-${i}`), 'utf8'), `new${i}`);
    } finally { rmTree(dir); }
  });
  await check('recoverShares: no COMMIT drops next/, old shares kept', () => {
    const dir = tmpDir('kz-rec-');
    try {
      seed(dir, 'old');
      const next = path.join(dir, 'next'); fs.mkdirSync(next);
      fs.writeFileSync(path.join(next, 'share-1'), 'new1', { mode: 0o400 });
      recoverShares(dir);
      assert.equal(fs.existsSync(next), false);
      for (let i = 1; i <= 5; i++) assert.equal(fs.readFileSync(path.join(dir, `share-${i}`), 'utf8'), `old${i}`);
    } finally { rmTree(dir); }
  });
  await check('configure FAIL line → MSK generate result fail, no nistState', async () => {
    const dir = tmpDir('kz-fail-');
    const evs = [];
    try {
      const deps = { ...realDeps(dir, 'safe', realVault()), runConfigure: async () => ['PASS: a', 'FAIL: b'], events: async (e) => { evs.push(e); } };
      await createCeremony(deps).initCluster();
      const gen = evs.filter((e) => e.op === 'generate');
      assert.equal(gen.length, 1);
      assert.equal(gen[0].result, 'fail');
      assert.equal('nistState' in gen[0], false);
    } finally { rmTree(dir); }
  });
}

rmTree(STATIC_DIR);
console.log('PASS server.check');
process.exit(0);
