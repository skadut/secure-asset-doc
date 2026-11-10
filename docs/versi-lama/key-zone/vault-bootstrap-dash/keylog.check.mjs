import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setAuditRoot, readKeyEvents } from './audit.mjs';
import { appendEvent, readDashEvents } from './events.mjs';
import { mskInfo, kekInfo, dekInfo } from './nist.mjs';

const line = (obj) => JSON.stringify(obj);
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const DAY = 86400000;
const t = async (name, fn) => { await fn(); console.log(`ok ${name}`); };
const resp = (p, operation, data = {}, extra = {}) => line({
  time: iso(),
  type: 'response',
  auth: { display_name: 'crypto-module' },
  request: { id: 'r1', operation, path: p, remote_address: '127.0.0.1' },
  response: { data },
  ...extra,
});

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keylog-audit-'));
const dashRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'keylog-dash-'));

async function writeLog(lines) {
  const dir = path.join(root, 'vault-1');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'audit.log'), lines.join('\n') + '\n');
}

try {
  process.env.VAULT_NODES = 'vault-1';
  process.env.DASH_DATA_DIR = dashRoot;
  setAuditRoot(root);

  await t('datakey response yields DEK generate+wrap without secrets', async () => {
    await writeLog([resp('transit/datakey/wrapped/crypto-module-kek', 'update',
      { ciphertext: 'vault:v2:abc', plaintext: 'hmac-sha256:xyz', key_version: 2 })]);
    const evs = await readKeyEvents();
    assert.equal(evs.length, 1);
    const e = evs[0];
    assert.equal(e.type, 'DEK');
    assert.equal(e.op, 'generate+wrap');
    assert.equal(e.keyId, 'crypto-module-kek');
    assert.equal(e.version, 2);
    const s = JSON.stringify(e);
    assert.ok(!s.includes('hmac-sha256'));
    assert.ok(!s.includes('vault:v2:abc'));
  });

  await t('decrypt permission denied yields denied DEK unwrap', async () => {
    await writeLog([resp('transit/decrypt/crypto-module-kek', 'update', {},
      { error: '1 error occurred:\n\t* permission denied\n' })]);
    const evs = await readKeyEvents();
    assert.equal(evs.length, 1);
    assert.equal(evs[0].result, 'denied');
    assert.equal(evs[0].type, 'DEK');
    assert.equal(evs[0].op, 'unwrap');
    assert.equal(evs[0].nistState, null);
    assert.equal(evs[0].deactivatesAt, null);
  });

  await t('request-type lines ignored', async () => {
    await writeLog([line({
      time: iso(), type: 'request', request: { path: 'transit/datakey/wrapped/crypto-module-kek', operation: 'update' },
    })]);
    assert.deepEqual(await readKeyEvents(), []);
  });

  await t('malformed line skipped', async () => {
    await writeLog([
      resp('transit/keys/crypto-module-kek/rotate', 'update', { key_version: 3 }),
      'not json{',
      resp('sys/seal', 'update'),
    ]);
    const evs = await readKeyEvents();
    assert.equal(evs.length, 2);
  });

  await t('rotate yields KEK rotate', async () => {
    await writeLog([resp('transit/keys/crypto-module-kek/rotate', 'update', { key_version: 3 })]);
    const evs = await readKeyEvents();
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, 'KEK');
    assert.equal(evs[0].op, 'rotate');
  });

  await t('seal yields MSK seal', async () => {
    await writeLog([resp('sys/seal', 'update')]);
    const evs = await readKeyEvents();
    assert.equal(evs.length, 1);
    assert.equal(evs[0].type, 'MSK');
    assert.equal(evs[0].op, 'seal');
    assert.equal(evs[0].nistState, 'Active→Suspended');
  });

  await t('type filter', async () => {
    await writeLog([resp('sys/seal', 'update'), resp('transit/keys/crypto-module-kek/rotate', 'update')]);
    const msk = await readKeyEvents({ type: 'MSK' });
    assert.equal(msk.length, 1);
    assert.ok(msk.every((e) => e.type === 'MSK'));
    const kek = await readKeyEvents({ type: 'KEK' });
    assert.equal(kek.length, 1);
    assert.ok(kek.every((e) => e.type === 'KEK'));
  });

  await t('appendEvent strips secrets, keeps safe fields', async () => {
    await appendEvent({
      actor: 'x', share: 's1', shares: ['a'], token: 't', key: 'k', keys: [1], root_token: 'r',
      nested: { token: 'z', ok: 1 }, note: 'n',
    });
    const ev = (await readDashEvents(1))[0];
    for (const k of ['share', 'shares', 'token', 'key', 'keys', 'root_token']) {
      assert.equal(k in ev, false, `secret key ${k} present`);
    }
    assert.equal(ev.nested.token, undefined);
    assert.equal(ev.nested.ok, 1);
    assert.equal(typeof ev.at, 'string');
    assert.ok(!Number.isNaN(Date.parse(ev.at)));
    assert.equal(ev.actor, 'x');
    assert.equal(ev.result, 'ok');
  });

  await t('appendEvent strips secrets inside arrays', async () => {
    await appendEvent({ list: [{ token: 't', ok: 1 }] });
    const ev = (await readDashEvents(1))[0];
    assert.equal(ev.list[0].token, undefined);
    assert.equal(ev.list[0].ok, 1);
  });

  await t('readDashEvents newest-first, limit, missing file', async () => {
    process.env.DASH_DATA_DIR = path.join(dashRoot, 'order');
    for (const n of [1, 2, 3]) await appendEvent({ n });
    assert.deepEqual((await readDashEvents(3)).map((e) => e.n), [3, 2, 1]);
    assert.equal((await readDashEvents(2)).length, 2);
    process.env.DASH_DATA_DIR = path.join(dashRoot, 'missing');
    assert.deepEqual(await readDashEvents(5), []);
  });

  await t('mskInfo overdue and state', async () => {
    delete process.env.MSK_CRYPTOPERIOD_DAYS;
    const old = mskInfo({ initialized: true, sealedCount: 0, nodeCount: 3,
      events: [{ type: 'MSK', op: 'generate', result: 'ok', at: iso(400 * DAY) }] });
    assert.equal(old.overdue, true);
    assert.notEqual(old.expiresAt, undefined);
    assert.notEqual(old.daysLeft, undefined);
    const fresh = mskInfo({ initialized: true, sealedCount: 0, nodeCount: 3,
      events: [{ type: 'MSK', op: 'generate', result: 'ok', at: iso(10 * DAY) }] });
    assert.equal(fresh.overdue, false);
    assert.equal(mskInfo({ initialized: false, sealedCount: 0, nodeCount: 3 }).state, 'Pre-activation');
    assert.equal(mskInfo({ initialized: true, sealedCount: 3, nodeCount: 3 }).state, 'Suspended (sealed)');
    assert.notEqual(mskInfo({ initialized: true, sealedCount: 0, nodeCount: 0 }).state, 'Suspended (sealed)');
  });

  await t('kekInfo and dekInfo', async () => {
    delete process.env.KEK_CRYPTOPERIOD_DAYS;
    const k = kekInfo([{ type: 'KEK', op: 'generate', result: 'ok', at: new Date().toISOString(), version: 1 }]);
    assert.equal(typeof k.createdAt, 'string');
    assert.equal(typeof k.nextRotateAt, 'string');
    assert.equal(typeof k.daysLeft, 'number');
    assert.ok(k.daysLeft >= 360 && k.daysLeft <= 365);
    const at1 = new Date().toISOString();
    const at2 = new Date().toISOString();
    const d = dekInfo([{ type: 'DEK', op: 'generate+wrap', result: 'ok', at: at1 }, { type: 'DEK', op: 'unwrap', result: 'ok', at: at2 }]);
    assert.deepStrictEqual(d.stats, { generated24h: 1, unwrapped24h: 1, total: 2, lastAt: at2 });
  });
} finally {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(dashRoot, { recursive: true, force: true });
}

console.log('PASS');
