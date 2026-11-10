// Self-check: audit purge routes. Fake q/send/forbid/readRaw; no DB, no HTTP.
import assert from 'node:assert/strict';
import { makeAuditPurgeRoutes } from './audit-purge.mjs';

const PATI = 'jenderal-tni';
const PAMEN = 'kolonel';

function harness({ rankCode = PATI, rows = [{ r: { deleted: 3, tombstoneId: 7 } }], countRows = [{ count: 2, oldest: new Date('2020-01-01T00:00:00Z') }] } = {}) {
  const calls = { q: [], forbid: [], send: [] };
  let rawBody = null;
  const q = async (sql, params) => {
    calls.q.push({ sql, params });
    return { rows: sql.includes('purge_audit_events') ? rows : countRows };
  };
  const send = (res, status, body, headers) => {
    calls.send.push({ status, body, headers });
    return status;
  };
  const forbid = async (res, me, objectType, objectId, summary) => {
    calls.forbid.push({ me, objectType, objectId, summary });
    return send(res, 403, { error: 'forbidden' });
  };
  const readRaw = async () => rawBody;
  const routes = makeAuditPurgeRoutes({ q, send, readRaw, forbid });
  const me = { username: 'jend.test', rankCode };
  const post = async (obj, headers = { 'content-type': 'application/json' }) => {
    rawBody = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
    return routes.purge({ me, headers, url: '/api/audit/purge' }, {});
  };
  const get = (query) => routes.preview({ me, headers: {}, url: `/api/audit/purge-preview${query}` }, {});
  return { calls, post, get, me };
}

const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const GOOD = '2020-01-01';

// Non-PATI: forbid called, no DB, no 200.
{
  const h = harness({ rankCode: PAMEN });
  await h.get(`?before=${GOOD}`);
  await h.post({ before: GOOD, confirm: `PURGE AUDIT BEFORE ${GOOD}` });
  assert.equal(h.calls.forbid.length, 2);
  assert.deepEqual(h.calls.forbid[0], { me: h.me, objectType: 'audit', objectId: 'purge', summary: 'audit purge denied' });
  assert.equal(h.calls.q.length, 0);
  assert.ok(h.calls.send.every((s) => s.status === 403));
}

// Preview: bad and missing date -> 400.
for (const query of ['', '?before=2026-02-30', '?before=2026-13-01', '?before=abc', '?before=2026-1-1']) {
  const h = harness();
  await h.get(query);
  assert.equal(h.calls.send[0].status, 400, `preview ${query}`);
  assert.equal(h.calls.q.length, 0);
}

// Preview: good date -> count, ISO before, oldest, excludes purge rows in SQL.
{
  const h = harness();
  await h.get(`?before=${GOOD}`);
  const s = h.calls.send[0];
  assert.equal(s.status, 200);
  assert.deepEqual(s.body, { before: '2020-01-01T00:00:00.000Z', count: 2, oldest: '2020-01-01T00:00:00.000Z' });
  assert.match(h.calls.q[0].sql, /action <> 'purge'/);
  assert.equal(h.calls.q[0].params[0], '2020-01-01T00:00:00.000Z');
}

// Purge: bad date -> 400, future date -> 400, wrong confirm -> 400.
for (const before of ['2026-02-30', 'nope', tomorrow]) {
  const h = harness();
  await h.post({ before, confirm: `PURGE AUDIT BEFORE ${before}` });
  assert.equal(h.calls.send[0].status, 400, `purge date ${before}`);
  assert.equal(h.calls.q.length, 0);
}
{
  const h = harness();
  await h.post({ before: GOOD, confirm: 'purge audit before 2020-01-01' });
  assert.deepEqual(h.calls.send[0].body, { error: 'confirmation mismatch' });
  assert.equal(h.calls.send[0].status, 400);
  assert.equal(h.calls.q.length, 0);
}

// Purge: bad content-type -> 415, oversized content-length -> 413.
{
  const h = harness();
  await h.post({ before: GOOD, confirm: `PURGE AUDIT BEFORE ${GOOD}` }, { 'content-type': 'text/plain' });
  assert.equal(h.calls.send[0].status, 415);
}
{
  const h = harness();
  await h.post({ before: GOOD, confirm: `PURGE AUDIT BEFORE ${GOOD}` }, { 'content-type': 'application/json', 'content-length': '5000' });
  assert.equal(h.calls.send[0].status, 413);
}

// Purge: good path -> SQL call with username first, response mapped.
{
  const h = harness();
  await h.post({ before: GOOD, confirm: `PURGE AUDIT BEFORE ${GOOD}` });
  const c = h.calls.q[0];
  assert.match(c.sql, /purge_audit_events/);
  assert.equal(c.params[0], 'jend.test');
  assert.equal(c.params[1], '2020-01-01T00:00:00.000Z');
  assert.deepEqual(h.calls.send[0], { status: 200, body: { deleted: 3, tombstoneId: 7, before: '2020-01-01T00:00:00.000Z' }, headers: undefined });
}

console.log('audit-purge ok');
