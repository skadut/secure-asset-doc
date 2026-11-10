// Assert-based self-check for cert-history.mjs. Run: node cert-history.check.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readCertHistory, recordCerts } from './cert-history.mjs';

const T = Date.parse('2030-01-01T00:00:00Z');
const cert = (id, fp, over = {}) => ({
  id, role: 'Vault node (server)', source: 'test', status: 'valid', subjectDN: `CN=${id}`, issuerDN: 'CN=test-ca', cn: id,
  serial: '01', notBefore: '2029-01-01T00:00:00.000Z', notAfter: '2099-01-01T00:00:00.000Z', daysLeft: 1000, lifetimeDays: 3650,
  san: [], extKeyUsage: [], isCA: false, fingerprint256: fp, publicKey: { type: 'rsa', bits: 2048 },
  privateKey: { state: 'Active (on disk, read-only)' }, ...over,
});
const ca = cert('ca', 'CA:00', { role: 'Root CA', isCA: true, privateKey: { state: 'Destroyed (after issuance)' } });
const v1 = cert('vault-1', 'V1:01');
const v2 = cert('vault-2', 'V2:01', { status: 'expired', notBefore: '2019-01-01T00:00:00.000Z', notAfter: '2020-06-01T00:00:00.000Z' });
const adm = cert('client-admin', 'AA:01', { role: 'Client: admin' });
const admNew = { ...adm, fingerprint256: 'BB:02' };
const admGone = { ...adm, status: 'unavailable', fingerprint256: null, notBefore: null, notAfter: null, error: 'read failed' };
const cm = cert('client-crypto-module', 'CM:01', { role: 'Client: crypto-module', publicKey: { type: 'ec', curve: 'prime256v1' } });
const ALLOWED_KEYS = ['at', 'event', 'id', 'role', 'cn', 'subjectDN', 'issuerDN', 'serial', 'fingerprint256', 'notBefore', 'notAfter', 'publicKey', 'privateKeyState', 'inferred', 'note', 'replacedBy', 'observedAt'];

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cert-history-check-'));
const file = path.join(tmp, 'sub', 'certs-history.jsonl');
const check = async (name, fn) => {
  try { await fn(); }
  catch (err) { throw new Error(`${name}: ${err.message}`, { cause: err }); }
};
const read = async () => (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const count = (L, ev, fp) => L.filter((l) => l.event === ev && (fp === undefined || l.fingerprint256 === fp)).length;
const rec = (certs) => recordCerts(certs, { file, now: T });
const hist = () => readCertHistory({ file, now: T });

try {
  await check('a: first record', async () => {
    await rec([ca, v1, v2, adm, cm]);
    const L = await read();
    for (const fp of ['CA:00', 'V1:01', 'V2:01', 'AA:01', 'CM:01']) assert.equal(count(L, 'issued', fp), 1, `issued ${fp}`);
    assert.equal(count(L, 'private-key-destroyed', 'CA:00'), 1);
    assert.equal(count(L, 'replaced'), 0);
    const pkd = L.filter((l) => l.event === 'private-key-destroyed');
    assert.equal(pkd.length, 1);
    assert.equal(pkd[0].inferred, true);
    assert.equal(pkd[0].note, 'vault-certs deletes the CA key immediately after signing; exact time = issuance run');
    assert.equal(pkd[0].fingerprint256, ca.fingerprint256);
    assert.equal(pkd[0].at, ca.notBefore);
    for (const l of L.filter((x) => x.event === 'issued')) assert.equal(l.observedAt, new Date(T).toISOString());
    const two = await readCertHistory({ file, limit: 2 });
    assert.equal(two.events.length, 2);
    const all = (await hist()).events;
    assert.ok(all.length > 2);
    for (let i = 1; i < all.length; i++) assert.ok(Date.parse(all[i - 1].at) >= Date.parse(all[i].at), `sorted desc at ${i}`);
  });

  await check('b: same certs again appends nothing', async () => {
    const n = (await read()).length;
    await rec([ca, v1, v2, adm, cm]);
    assert.equal((await read()).length, n);
  });

  await check('c: changed fingerprint -> replaced', async () => {
    await rec([ca, v1, v2, admNew, cm]);
    const L = await read();
    const rp = L.filter((l) => l.event === 'replaced' && l.fingerprint256 === 'AA:01');
    assert.equal(rp.length, 1);
    assert.equal(rp[0].replacedBy, 'BB:02');
    assert.equal(rp[0].cn, adm.cn);
    assert.equal(rp[0].privateKeyState, adm.privateKey.state);
    assert.equal(count(L, 'issued', 'BB:02'), 1);
    const { inventory } = await hist();
    const state = (fp) => inventory.find((e) => e.fingerprint256 === fp)?.state;
    assert.equal(state('AA:01'), 'Replaced');
    assert.equal(state('BB:02'), 'Current');
  });

  await check('d: unavailable read -> no replaced', async () => {
    const before = count(await read(), 'replaced');
    await rec([ca, v1, v2, admGone, cm]);
    const L = await read();
    assert.equal(count(L, 'replaced'), before);
    assert.equal(count(L, 'replaced', 'BB:02'), 0);
  });

  await check('e: expired once per fingerprint', async () => {
    await rec([ca, v1, v2, admNew, cm]);
    let L = await read();
    assert.equal(count(L, 'expired', 'V2:01'), 1);
    assert.equal(L.find((l) => l.event === 'expired' && l.fingerprint256 === 'V2:01').at, v2.notAfter);
    assert.equal((await hist()).inventory.find((e) => e.fingerprint256 === 'V2:01')?.state, 'Expired');
    await rec([ca, v1, v2, admNew, cm]);
    L = await read();
    assert.equal(count(L, 'expired', 'V2:01'), 1);
  });

  await check('f: no key material in output', async () => {
    assert.ok(!(await fs.readFile(file, 'utf8')).includes('PRIVATE KEY'));
    assert.ok(!JSON.stringify(await hist()).includes('PRIVATE KEY'));
    for (const l of await read()) {
      for (const k of Object.keys(l)) assert.ok(ALLOWED_KEYS.includes(k), `unexpected key ${k} in ${l.event}`);
      assert.equal(Object.hasOwn(l, 'privateKey'), false);
    }
  });

  await check('g: malformed lines skipped', async () => {
    const before = (await hist()).events.length;
    await fs.appendFile(file, 'not json{\nnull\n[1]\n');
    assert.equal((await hist()).events.length, before);
    await rec([ca, v1, v2, admNew, cm]);
  });

  await check('missing file -> empty history', async () => {
    assert.deepEqual(await readCertHistory({ file: path.join(tmp, 'nope.jsonl') }), { events: [], inventory: [] });
  });

  await check('h: concurrent recordCerts -> no duplicates', async () => {
    const f2 = path.join(tmp, 'conc', 'certs-history.jsonl');
    const certs = [ca, v1, v2, adm, cm];
    await Promise.all([recordCerts(certs, { file: f2, now: T }), recordCerts(certs, { file: f2, now: T })]);
    const L = (await fs.readFile(f2, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const keys = L.map((l) => `${l.event}|${l.fingerprint256}`);
    assert.equal(new Set(keys).size, keys.length, 'duplicate events');
    assert.equal(count(L, 'issued'), 5);
  });
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}

console.log('cert-history.check: ok');
