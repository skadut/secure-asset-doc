// Assert-based self-check for certs.mjs. Run: node certs.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCerts } from './certs.mjs';

try { execFileSync('openssl', ['version'], { stdio: 'pipe' }); }
catch { console.log('SKIP certs.check: openssl not on PATH'); process.exit(0); }

const ENV = ['CERTS_ADMIN_CA', 'CERTS_ADMIN_CERT', 'CERTS_ADMIN_KEY', 'CERTS_CM_CERT', 'CERTS_CM_KEY', 'VAULT_CACERT', 'VAULT_CLIENT_CERT', 'VAULT_CLIENT_KEY'];
const saved = Object.fromEntries(ENV.map((n) => [n, process.env[n]]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'certs-check-'));
const p = (f) => path.join(tmp, f);
const ossl = (args) => execFileSync('openssl', args, { cwd: tmp, stdio: 'pipe' });
const write = (f, s) => fs.writeFileSync(p(f), s);
const check = async (name, fn) => {
  try { await fn(); console.log(`ok ${name}`); }
  catch (err) { throw new Error(`${name}: ${err.message}`, { cause: err }); }
};
const rmTree = (d) => { // Windows: clear read-only files, then retry
  try { fs.rmSync(d, { recursive: true, force: true }); }
  catch {
    for (const f of fs.readdirSync(d)) fs.chmodSync(path.join(d, f), 0o666);
    fs.rmSync(d, { recursive: true, force: true });
  }
};
const base = {
  CERTS_ADMIN_CA: p('ca.crt'), CERTS_ADMIN_CERT: p('admin.crt'), CERTS_ADMIN_KEY: p('admin.key'),
  CERTS_CM_CERT: p('cm.crt'), CERTS_CM_KEY: p('cm.key'),
};
const withEnv = async (over, fn) => {
  Object.assign(process.env, base, over);
  try { await fn(); } finally { Object.assign(process.env, base); }
};
const byId = (r) => Object.fromEntries(r.certs.map((c) => [c.id, c]));
const dirLeaks = [tmp, JSON.stringify(tmp).slice(1, -1)]; // JSON escapes backslashes on Windows
const noPath = (s) => { for (const d of dirLeaks) assert.ok(!s.includes(d), 'temp dir path in output'); };

try {
  // PKI: CA, admin (RSA), crypto-module (EC), mismatch (EC), vault-1 (EC, SAN + serverAuth)
  write('ca.ext', 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  write('admin.ext', 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n');
  write('cm.ext', 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n');
  write('vault1.ext', 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:vault-1\n');

  ossl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', p('ca.key'), '-out', p('ca.csr'), '-subj', '/CN=test-ca']);
  ossl(['x509', '-req', '-in', p('ca.csr'), '-signkey', p('ca.key'), '-out', p('ca.crt'), '-days', '3650', '-extfile', p('ca.ext')]);

  const leaf = (name, subj, days, ext) => {
    ossl(['req', '-new', '-key', p(`${name}.key`), '-out', p(`${name}.csr`), '-subj', subj]);
    ossl(['x509', '-req', '-in', p(`${name}.csr`), '-CA', p('ca.crt'), '-CAkey', p('ca.key'), '-CAcreateserial',
      '-days', String(days), '-extfile', p(`${ext}.ext`), '-out', p(`${name}.crt`)]);
  };
  const ecKey = (f) => ossl(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', p(f)]);

  ossl(['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', p('admin.key')]);
  leaf('admin', '/CN=test-admin', 10, 'admin');
  ecKey('cm.key'); leaf('cm', '/CN=test-cm', 365, 'cm');
  ecKey('mismatch.key');
  ecKey('vault1.key'); leaf('vault1', '/CN=vault-1', 365, 'vault1');
  ossl(['x509', '-in', p('vault1.crt'), '-outform', 'DER', '-out', p('vault1.der')]);
  const vault1Der = fs.readFileSync(p('vault1.der'));

  Object.assign(process.env, base);

  let runA;
  await check('run A: entries, order, fields', async () => {
    runA = await readCerts({ nodes: ['vault-1'], now: Date.now(), handshake: async () => vault1Der });
    assert.deepEqual(runA.certs.map((c) => c.id), ['ca', 'vault-1', 'client-admin', 'client-crypto-module']);
    const e = byId(runA);
    assert.equal(e.ca.role, 'Root CA');
    assert.equal(e.ca.isCA, true);
    assert.equal(e.ca.cn, 'test-ca');
    assert.equal(e.ca.privateKey.state, 'Destroyed (after issuance)');

    assert.equal(e['vault-1'].status, 'valid');
    assert.ok(e['vault-1'].san.some((s) => s.includes('vault-1')), JSON.stringify(e['vault-1'].san));
    assert.ok(e['vault-1'].extKeyUsage.includes('serverAuth'), JSON.stringify(e['vault-1'].extKeyUsage));

    const adm = e['client-admin'];
    assert.equal(adm.cn, 'test-admin');
    assert.equal(adm.status, 'expiring');
    assert.ok(adm.daysLeft >= 8 && adm.daysLeft <= 10, `daysLeft=${adm.daysLeft}`);
    assert.equal(adm.privateKey.state, 'Active (on disk, read-only)');
    assert.equal(adm.privateKey.matchesCert, true);
    assert.ok(adm.extKeyUsage.includes('clientAuth'), JSON.stringify(adm.extKeyUsage));
    assert.equal(adm.publicKey.type, 'rsa');
    assert.equal(adm.publicKey.bits, 2048);

    const cm = e['client-crypto-module'];
    assert.equal(cm.status, 'valid');
    assert.equal(cm.publicKey.type, 'ec');
    assert.ok(cm.privateKey.curve, 'privateKey.curve missing');
    assert.equal(cm.privateKey.matchesCert, true);
  });

  await check('forbidden content: no PRIVATE KEY, no temp dir path in run A output', () => {
    const s = JSON.stringify(runA);
    assert.ok(!s.includes('PRIVATE KEY'));
    noPath(s);
  });

  await check('run B: handshake throws -> vault-1 unavailable, no path leak', async () => {
    const b = await readCerts({ nodes: ['vault-1'], now: Date.now(), handshake: async () => { throw new Error('boom'); } });
    const v = byId(b)['vault-1'];
    assert.equal(v.status, 'unavailable');
    assert.equal(typeof v.error, 'string');
    assert.ok(v.error.length > 0);
    noPath(JSON.stringify(b));
  });

  await check('mismatch key: matchesCert false, status still valid', () => withEnv({ CERTS_CM_KEY: p('mismatch.key') }, async () => {
    const r = await readCerts({ nodes: ['vault-1'], now: Date.now(), handshake: async () => vault1Der });
    const cm = byId(r)['client-crypto-module'];
    assert.equal(cm.privateKey.matchesCert, false);
    assert.equal(cm.status, 'valid');
  }));

  await check('missing file: client-admin unavailable, no throw', () => withEnv({ CERTS_ADMIN_CERT: p('does-not-exist.crt') }, async () => {
    const r = await readCerts({ nodes: ['vault-1'], now: Date.now(), handshake: async () => vault1Der });
    const adm = byId(r)['client-admin'];
    assert.equal(adm.status, 'unavailable');
    assert.equal(typeof adm.error, 'string');
    assert.ok(adm.error.length > 0);
  }));

  await check('cache: two no-arg calls within 60s share checkedAt', () => withEnv({}, async () => {
    // Remove VAULT_* so the default handshake fails at file read, before any socket opens.
    for (const n of ['VAULT_CACERT', 'VAULT_CLIENT_CERT', 'VAULT_CLIENT_KEY']) delete process.env[n];
    const x = await readCerts({ nodes: ['vault-1'] });
    const y = await readCerts({ nodes: ['vault-1'] });
    assert.equal(x.checkedAt, y.checkedAt);
  }));
} finally {
  for (const n of ENV) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
  rmTree(tmp);
}

console.log('PASS certs.check');
process.exit(0);
