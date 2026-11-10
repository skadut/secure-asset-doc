// Self-check: grant routes + access-request decision rules. Fake q/send/forbid/readRaw/res; no DB, no HTTP.
import assert from 'node:assert/strict';
import { makeGrantRoutes, parseExpiresAt, decisionError } from './grants.mjs';
import { can } from './auth.mjs';
import { filterGrc } from './grc-filter.mjs';

// parseExpiresAt
assert.equal(parseExpiresAt(undefined), null);
assert.equal(parseExpiresAt(null), null);
assert.equal(parseExpiresAt('2026-06-01'), '2026-06-01T23:59:59.000Z');
assert.equal(parseExpiresAt('2026-02-30'), undefined);
assert.equal(parseExpiresAt('2026-13-01'), undefined);
assert.equal(parseExpiresAt('nope'), undefined);
assert.equal(parseExpiresAt(5), undefined);
assert.equal(parseExpiresAt('2026-06-01T10:00:00Z'), '2026-06-01T10:00:00.000Z');
assert.equal(parseExpiresAt('2026-06-01T10:00:00+07:00'), '2026-06-01T03:00:00.000Z');

function harness({ accessLevel = 5, qImpl = async () => ({ rows: [] }), raw = null } = {}) {
  const calls = { q: [], send: [], forbid: [], head: [] };
  const q = async (sql, params) => {
    calls.q.push({ sql, params });
    return qImpl(sql, params);
  };
  const send = (res, status, body, headers) => {
    calls.send.push({ status, body, headers });
    return status;
  };
  const forbid = async (res, me, objectType, objectId, summary) => {
    calls.forbid.push({ objectType, objectId, summary });
    return send(res, 403, { error: 'forbidden' });
  };
  const readRaw = async () => raw;
  const seal = async (v) => `sealed(${v})`;
  const reveal = async () => {};
  const routes = makeGrantRoutes({ q, send, readRaw, forbid, seal, reveal });
  const me = { username: 'jend.test', accessLevel };
  const res = { writeHead: (s, h) => calls.head.push({ s, h }), end: () => {} };
  const json = { 'content-type': 'application/json', 'content-length': '20' };
  return { calls, routes, me, res, json };
}
const buf = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o));
const REQ = { grantee: 'kapten', reason: 'alasan' };

// Non-admin: forbid, no DB touch, for every route.
{
  const h = harness({ accessLevel: 4 });
  await h.routes.list({ me: h.me, headers: {} }, h.res, 'DOC-0001');
  await h.routes.createRequest({ me: h.me, headers: h.json }, h.res, 'DOC-0001');
  await h.routes.revoke({ me: h.me, headers: {} }, h.res, 'DOC-0001', 'kapten');
  await h.routes.users({ me: h.me, headers: {} }, h.res);
  assert.equal(h.calls.forbid.length, 4);
  assert.deepEqual(h.calls.forbid[0], { objectType: 'document', objectId: 'DOC-0001', summary: 'grant api denied' });
  assert.deepEqual(h.calls.forbid[3], { objectType: 'user', objectId: 'list', summary: 'grant api denied' });
  assert.equal(h.calls.q.length, 0);
}

// List: bad id 400, missing doc 404, ok maps rows.
{
  const h = harness({ qImpl: async () => ({ rows: [] }) });
  await h.routes.list({ me: h.me, headers: {} }, h.res, 'DOC-1');
  assert.equal(h.calls.send[0].status, 400);
  await h.routes.list({ me: h.me, headers: {} }, h.res, 'DOC-0009');
  assert.equal(h.calls.send[1].status, 404);
}
{
  const exp = new Date('2026-06-01T23:59:59Z');
  const granted = new Date('2026-01-01T00:00:00Z');
  const h = harness({
    qImpl: async (sql) => (sql.startsWith('SELECT 1') ? { rows: [{ '?column?': 1 }] } : {
      rows: [{ username: 'kapten', rank_name: 'Kapten', access_level: 2, unit: 'Unit Intelijen', unit_head: true, granted_by: 'jend.test', granted_at: granted, expires_at: exp, active: false }],
    }),
  });
  await h.routes.list({ me: h.me, headers: {} }, h.res, 'DOC-0001');
  assert.deepEqual(h.calls.send[0], {
    status: 200,
    body: [{ username: 'kapten', rankName: 'Kapten', accessLevel: 2, unit: 'Unit Intelijen', unitHead: true, grantedBy: 'jend.test', grantedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-06-01T23:59:59.000Z', active: false }],
    headers: undefined,
  });
}

// Create request: 415, 413 (declared), 413 (read), 400 grantee/reason/expiry/json, 201 good, DB SQLSTATE mapping.
{
  const h = harness({ raw: buf(REQ) });
  await h.routes.createRequest({ me: h.me, headers: { 'content-type': 'text/plain' } }, h.res, 'DOC-0001');
  assert.equal(h.calls.send[0].status, 415);
}
{
  const h = harness({ raw: buf(REQ) });
  await h.routes.createRequest({ me: h.me, headers: { 'content-type': 'application/json', 'content-length': '5000' } }, h.res, 'DOC-0001');
  assert.equal(h.calls.send[0].status, 413);
}
{
  const h = harness({ raw: Buffer.alloc(5000, 0x20) });
  await h.routes.createRequest({ me: h.me, headers: { 'content-type': 'application/json' } }, h.res, 'DOC-0001');
  assert.equal(h.calls.send[0].status, 413);
}
for (const raw of [
  'not json',
  buf({ ...REQ, grantee: 'Bad Name' }),
  buf({ grantee: 'kapten', reason: '   ' }),
  buf({ grantee: 'kapten' }),
  buf({ ...REQ, expiresAt: 'tomorrow' }),
  buf({ ...REQ, expiresAt: '2026-02-30' }),
]) {
  const h = harness({ raw });
  await h.routes.createRequest({ me: h.me, headers: { 'content-type': 'application/json' } }, h.res, 'DOC-0001');
  assert.equal(h.calls.send[0].status, 400, String(raw));
  assert.equal(h.calls.q.length, 0);
}
{
  const h = harness({ raw: buf({ ...REQ, expiresAt: '2030-01-01' }), qImpl: async () => ({ rows: [{ r: { requestId: 7, status: 'pending' } }] }) });
  await h.routes.createRequest({ me: h.me, headers: { 'content-type': 'application/json' } }, h.res, 'DOC-0001');
  assert.equal(h.calls.send[0].status, 201);
  assert.deepEqual(h.calls.send[0].body, { id: '7', status: 'pending' });
  const c = h.calls.q[0];
  assert.match(c.sql, /request_document_access/);
  assert.deepEqual(c.params, ['jend.test', 'DOC-0001', 'kapten', 'sealed(alasan)', '2030-01-01T23:59:59.000Z']);
}
for (const [code, status] of [['42501', 403], ['P0002', 404], ['22023', 400], ['23505', 409]]) {
  const h = harness({
    raw: buf(REQ),
    qImpl: async () => {
      throw Object.assign(new Error('x'), { code });
    },
  });
  await h.routes.createRequest({ me: h.me, headers: { 'content-type': 'application/json' } }, h.res, 'DOC-0001');
  assert.equal(h.calls.send[0].status, status, `sqlstate ${code}`);
}

// Revoke: 204 via writeHead; SQLSTATE P0002 -> 404.
{
  const h = harness();
  await h.routes.revoke({ me: h.me, headers: {} }, h.res, 'DOC-0001', 'kapten');
  assert.equal(h.calls.head[0].s, 204);
  assert.match(h.calls.q[0].sql, /revoke_document_access/);
  assert.deepEqual(h.calls.q[0].params, ['jend.test', 'DOC-0001', 'kapten']);
}
{
  const h = harness({ qImpl: async () => { throw Object.assign(new Error('x'), { code: 'P0002' }); } });
  await h.routes.revoke({ me: h.me, headers: {} }, h.res, 'DOC-0001', 'kapten');
  assert.equal(h.calls.send[0].status, 404);
  assert.equal(h.calls.head.length, 0);
}

// Users: mapped shape.
{
  const h = harness({ qImpl: async () => ({ rows: [{ username: 'jend', name: 'Jenderal Budi', rank_name: 'Jenderal TNI', golongan: 'PATI', access_level: 5, unit: 'Unit Intelijen', unit_head: true, security_officer: false }] }) });
  await h.routes.users({ me: h.me, headers: {} }, h.res);
  assert.deepEqual(h.calls.send[0].body, [{ username: 'jend', name: 'Jenderal Budi', rankName: 'Jenderal TNI', golongan: 'PATI', accessLevel: 5, unit: 'Unit Intelijen', unitHead: true, securityOfficer: false }]);
  assert.match(h.calls.q[0].sql, /\bu\.unit_head\b/);
  // Missing/absent unit_head -> false (row without the column).
  const h2 = harness({ qImpl: async () => ({ rows: [{ username: 'kapten', rank_name: 'Kapten', golongan: 'PAMA', access_level: 2 }] }) });
  await h2.routes.users({ me: h2.me, headers: {} }, h2.res);
  assert.equal(h2.calls.send[0].body[0].unitHead, false);
  // Missing name column -> null.
  assert.equal(h2.calls.send[0].body[0].name, null);
}

// decisionError: pure pre-check for approve/deny.
{
  const pending = { requestedBy: 'req.test', grantee: 'kapten', status: 'pending' };
  const cmd = { username: 'jend2', accessLevel: 5, securityOfficer: false };
  const so = { username: 'so.test', accessLevel: 2, securityOfficer: true };
  const plain = { username: 'letnan.test', accessLevel: 3, securityOfficer: false };
  const cmdAppr = { approver: 'jend2', role: 'commander' };
  const soAppr = { approver: 'so.test', role: 'security_officer' };

  assert.equal(decisionError({ username: 'req.test', accessLevel: 5 }, pending, []), 'self', 'self requester');
  assert.equal(decisionError({ username: 'kapten', accessLevel: 5 }, pending, []), 'self', 'self grantee');
  assert.equal(decisionError(cmd, pending, [cmdAppr]), 'duplicate', 'same approver twice');
  assert.equal(decisionError({ username: 'jend3', accessLevel: 5 }, pending, [cmdAppr]), 'role-taken', 'second commander');
  assert.equal(decisionError({ username: 'so2.test', accessLevel: 2, securityOfficer: true }, pending, [soAppr]), 'role-taken', 'second security officer');
  assert.equal(decisionError(cmd, { ...pending, status: 'approved' }, []), 'not-pending', 'non-pending');
  assert.equal(decisionError(cmd, { ...pending, status: 'denied' }, [cmdAppr]), 'not-pending', 'non-pending before duplicate');
  assert.equal(decisionError(so, pending, [cmdAppr]), null, 'commander then officer');
  assert.equal(decisionError(cmd, pending, [soAppr]), null, 'officer then commander');
  assert.equal(decisionError(plain, pending, []), 'role', 'plain user');
  assert.equal(decisionError(cmd, pending, []), null, 'first commander');
  assert.equal(decisionError(so, pending, []), null, 'first officer');
}

// super_admin: menu gate, no self-approval, either slot once, RED+STRICT token-only without grant.
{
  const sa = { username: 'super.admin', accessLevel: 5, securityOfficer: false, superAdmin: true };
  const p = can('jenderal-tni', 5, false, true);
  assert.deepEqual(p.access, { grant: true, request: true, approve: true, revoke: true });
  assert.equal(p.audit.purge, true);
  const other = { requestedBy: 'req.test', grantee: 'kapten', status: 'pending' };
  assert.equal(decisionError(sa, { ...other, requestedBy: 'super.admin' }, []), 'self', 'own request');
  assert.equal(decisionError(sa, other, []), null, 'first slot');
  assert.equal(decisionError(sa, other, [{ approver: 'jend2', role: 'commander' }]), null, 'takes SO slot');
  assert.equal(decisionError(sa, other, [{ approver: 'so.test', role: 'security_officer' }]), null, 'takes commander slot');
  assert.equal(decisionError(sa, other, [{ approver: 'super.admin', role: 'commander' }]), 'duplicate', 'never both slots');
  const g = { documents: [
      { id: 'DOC-0004', title: 'abc:t1:xyz', tlp: 'RED+STRICT', versions: [{ version: '1.0', summary: 'secret', file: { name: 'abc:t1:f', url: '/api/files/DOC-0004/1.0' } }] },
      { id: 'DOC-0003', title: 'r', tlp: 'RED', versions: [] }],
    evidenceLinks: [], assetDocLinks: [], auditEvents: [] };
  const d = filterGrc(g, { accessLevel: 5, superAdmin: true }).documents.find((x) => x.id === 'DOC-0004');
  assert.equal(d.tokenOnly, true); assert.equal(d.title, 'abc:t1:xyz'); assert.deepEqual(d.versions, []); assert.equal(d.granted, undefined);
  assert.equal(JSON.stringify(filterGrc(g, { accessLevel: 5, superAdmin: true })).includes('secret'), false);
  assert.equal(filterGrc(g, { accessLevel: 5 }).documents.some((x) => x.id === 'DOC-0004'), false, 'non-super hidden');
  const gr = filterGrc(g, { accessLevel: 5, superAdmin: true, grantedIds: new Set(['DOC-0004']) }).documents.find((x) => x.id === 'DOC-0004');
  assert.equal(gr.granted, true); assert.equal(gr.tokenOnly, undefined);
}

console.log('grants ok');
