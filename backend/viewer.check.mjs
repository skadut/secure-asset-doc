// Self-check: viewer session limits, creation, validation (active/expired/unauthorized), termination. DB via fake q.
import assert from 'node:assert/strict';
import { canReadLevel } from './auth.mjs';
import { sessionLimitSeconds, makeViewerRoutes, validate } from './viewer.mjs';

const UUID_OK = '11111111-2222-4333-8444-555555555555';
const UUID_MISSING = '99999999-9999-4999-8999-999999999999';

const res = () => ({
  status: null, body: null, headers: {},
  writeHead(s, h = {}) { this.status = s; Object.assign(this.headers, h); },
  end(b) { this.body = b; },
});
const send = (r, status, body) => { r.writeHead(status); r.end(JSON.stringify(body)); };
const forbid = (r) => send(r, 403, { error: 'forbidden' });

// Limits by TLP; unknown -> null.
assert.equal(sessionLimitSeconds('RED'), 600);
assert.equal(sessionLimitSeconds('RED+STRICT'), 600);
assert.equal(sessionLimitSeconds('AMBER'), 900);
assert.equal(sessionLimitSeconds('AMBER+STRICT'), 900);
assert.equal(sessionLimitSeconds('GREEN'), 1800);
assert.equal(sessionLimitSeconds('CLEAR'), 1800);
assert.equal(sessionLimitSeconds('PURPLE'), null);

const routes = (q, granted = false) => makeViewerRoutes({
  q,
  send,
  forbid,
  canReadLevel,
  hasGrant: async () => granted,
});

// Create: readable doc -> 201, TTL applied, DB row returned.
{
  const calls = [];
  const q = async (sql, params) => {
    calls.push([sql, params]);
    if (/^SELECT tlp FROM documents/.test(sql)) return { rows: [{ tlp: 'RED' }] };
    if (/^INSERT INTO viewer_sessions/.test(sql)) return { rows: [{ id: UUID_OK, document_id: 'DOC-0001', created_at: new Date('2026-11-13T10:00:00Z'), expires_at: new Date('2026-11-13T10:10:00Z') }] };
    throw new Error('unexpected sql: ' + sql);
  };
  const r = res();
  await routes(q).create({ me: { id: 'uid-1', accessLevel: 5 } }, r, 'DOC-0001');
  assert.equal(r.status, 201);
  assert.deepEqual(JSON.parse(r.body), {
    sessionId: UUID_OK,
    documentId: 'DOC-0001',
    issuedAt: '2026-11-13T10:00:00.000Z',
    expiresAt: '2026-11-13T10:10:00.000Z',
    ttlSeconds: 600,
    id: UUID_OK,
    createdAt: '2026-11-13T10:00:00.000Z',
  });
  assert.deepEqual(calls[1][1], ['uid-1', 'DOC-0001', 600]);
}

// Create: above ceiling, no grant -> 404 (no insert). Unknown doc -> 404. Bad id -> 400.
{
  let inserts = 0;
  const q = async (sql, params) => {
    if (/^SELECT tlp/.test(sql)) return { rows: params[0] === 'DOC-0009' ? [] : [{ tlp: 'RED+STRICT' }] };
    if (/^INSERT/.test(sql)) { inserts++; return { rows: [] }; }
    throw new Error('unexpected sql: ' + sql);
  };
  const r1 = res();
  await routes(q).create({ me: { id: 'uid-1', accessLevel: 1 } }, r1, 'DOC-0002');
  assert.equal(r1.status, 404);
  const r2 = res();
  await routes(q).create({ me: { id: 'uid-1', accessLevel: 5 } }, r2, 'DOC-0009');
  assert.equal(r2.status, 404);
  const r3 = res();
  await routes(q).create({ me: { id: 'uid-1', accessLevel: 5 } }, r3, 'bad-id');
  assert.equal(r3.status, 400);
  assert.equal(inserts, 0);
}

// Create with grant: RED+STRICT allowed for a low-level user.
{
  const q = async (sql) => {
    if (/^SELECT tlp/.test(sql)) return { rows: [{ tlp: 'RED+STRICT' }] };
    if (/^INSERT/.test(sql)) return { rows: [{ id: UUID_OK, document_id: 'DOC-0002', created_at: new Date(), expires_at: new Date(Date.now() + 600_000) }] };
    throw new Error('unexpected sql: ' + sql);
  };
  const r = res();
  await routes(q, true).create({ me: { id: 'uid-1', accessLevel: 1 } }, r, 'DOC-0002');
  assert.equal(r.status, 201);
}

// Validate: active -> 200 valid; expired -> 410; access lost -> 403; missing/bad id -> 404.
{
  const qFor = (row) => async (sql) => {
    if (/^SELECT s\.id/.test(sql)) return { rows: row ? [row] : [] };
    throw new Error('unexpected sql: ' + sql);
  };
  const active = { id: UUID_OK, document_id: 'DOC-0001', expires_at: new Date(Date.now() + 60_000), tlp: 'AMBER' };
  const r1 = res();
  await routes(qFor(active)).validate({ me: { id: 'uid-1', accessLevel: 5 } }, r1, UUID_OK);
  assert.equal(r1.status, 200);
  assert.deepEqual(JSON.parse(r1.body), { valid: true, id: UUID_OK, documentId: 'DOC-0001', expiresAt: active.expires_at.toISOString() });

  const r2 = res();
  await routes(qFor({ ...active, expires_at: new Date(Date.now() - 1000) })).validate({ me: { id: 'uid-1', accessLevel: 5 } }, r2, UUID_OK);
  assert.equal(r2.status, 410);

  const r3 = res();
  await routes(qFor({ ...active, tlp: 'RED' })).validate({ me: { id: 'uid-1', accessLevel: 1 } }, r3, UUID_OK);
  assert.equal(r3.status, 403);
  const r3b = res();
  await routes(qFor({ ...active, tlp: 'RED+STRICT' }), true).validate({ me: { id: 'uid-1', accessLevel: 1 } }, r3b, UUID_OK);
  assert.equal(r3b.status, 200, 'grant still opens the session');

  const r4 = res();
  await routes(qFor(null)).validate({ me: { id: 'uid-1', accessLevel: 5 } }, r4, UUID_MISSING);
  assert.equal(r4.status, 404);
  const r5 = res();
  await routes(qFor(active)).validate({ me: { id: 'uid-1', accessLevel: 5 } }, r5, 'not-a-uuid');
  assert.equal(r5.status, 404);
}

// Shared file authorization: scopes the unexpired session to user and document.
{
  const calls = [];
  const q = async (sql, params) => {
    calls.push([sql, params]);
    return { rows: [{ '?column?': 1 }] };
  };
  assert.equal(await validate(q, { sessionId: UUID_OK, userId: 'uid-1', documentId: 'DOC-0001' }), true);
  assert.deepEqual(calls[0][1], [UUID_OK, 'uid-1', 'DOC-0001']);
  assert.match(calls[0][0], /expires_at > now\(\)/);
  assert.equal(await validate(async () => { throw new Error('DB must not be called'); }, {
    sessionId: 'not-a-uuid', userId: 'uid-1', documentId: 'DOC-0001',
  }), false);
  assert.equal(await validate(async () => ({ rows: [] }), {
    sessionId: UUID_OK, userId: 'uid-1', documentId: 'DOC-0001',
  }), false);
}

// Terminate: scoped delete -> 204; nothing deleted -> 404; bad id never touches DB.
{
  let seen;
  const q = async (sql, params) => { seen = params; return { rowCount: 1, rows: [] }; };
  const r1 = res();
  await routes(q).destroy({ me: { id: 'uid-1' } }, r1, UUID_OK);
  assert.equal(r1.status, 204);
  assert.deepEqual(seen, [UUID_OK, 'uid-1']);

  const r2 = res();
  await routes(async () => ({ rowCount: 0, rows: [] })).destroy({ me: { id: 'uid-1' } }, r2, UUID_OK);
  assert.equal(r2.status, 404);

  let hit = false;
  const r3 = res();
  await routes(async () => { hit = true; return { rowCount: 1 }; }).destroy({ me: { id: 'uid-1' } }, r3, 'bad-id');
  assert.equal(r3.status, 404);
  assert.equal(hit, false, 'invalid id rejected before DB');
}

console.log('viewer ok');
