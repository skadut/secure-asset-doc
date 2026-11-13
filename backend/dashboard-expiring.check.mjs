// Self-check: expiring-grants pure logic. No DB, no HTTP.
import assert from 'node:assert/strict';
import { clampGrantDays, expiringGrantsQuery, mapExpiringGrants, noExpiryQuery, makeDashboardRoutes } from './dashboard.mjs';

assert.equal(clampGrantDays('7'), 7);
assert.equal(clampGrantDays('500'), 90, 'upper clamp');
assert.equal(clampGrantDays('0'), 1, 'lower clamp');
assert.equal(clampGrantDays(undefined), 30, 'default 30');
assert.equal(clampGrantDays('abc'), 30, 'non-number default');

const [sql, params] = expiringGrantsQuery(30);
assert.deepEqual(params, [30]);
assert.match(sql, /revoked_at IS NULL/, 'excludes revoked');
assert.match(sql, /expires_at > now\(\)/, 'excludes already expired');
assert.match(sql, /\$1/, 'parameterised window');

const [nSql, nParams] = noExpiryQuery();
assert.deepEqual(nParams, []);
assert.match(nSql, /expires_at IS NULL/, 'counts only no-expiry grants');
assert.match(nSql, /revoked_at IS NULL/, 'excludes revoked');

assert.deepEqual(
  mapExpiringGrants([{ user: 'a.rahmawati', document_id: 'DOC-0009', expires_at: new Date('2026-12-01T00:00:00Z') }]),
  [{ user: 'a.rahmawati', documentId: 'DOC-0009', expiresAt: '2026-12-01T00:00:00.000Z' }],
  'only user, documentId, expiresAt',
);
assert.deepEqual(mapExpiringGrants([]), []);

// authz: non-L5, non-SO denied without query
let queried = false;
let forbidden = 0;
const routes = makeDashboardRoutes({
  q: async (sql) => { queried = true; return /count\(\*\)/.test(sql) ? { rows: [{ n: 4 }] } : { rows: [] }; },
  send: (res, status, body) => ({ status, body }),
  forbid: async () => { forbidden += 1; return { status: 403 }; },
});
await routes.expiringGrants({ me: { accessLevel: 3, securityOfficer: false }, url: '/api/grants/expiring' }, {});
assert.equal(forbidden, 1);
assert.equal(queried, false);
const ok = await routes.expiringGrants({ me: { accessLevel: 5, securityOfficer: false }, url: '/api/grants/expiring?days=14' }, {});
assert.equal(ok.status, 200);
assert.deepEqual(ok.body, { grants: [], noExpiry: 4 });

console.log('dashboard-expiring.check.mjs passed');
