// Self-check: TLP order, rank table, RBAC matrix, access-level reads, ceilings, password hashing, limiter, write-request guard.
import assert from 'node:assert/strict';
import {
  TLP_ORDER, tlpRank, RANKS, rankByCode, tierOf, can, canReadLevel, approverRole, authorize,
  hashPassword, verifyPassword, dummyVerify, createLoginLimiter,
  checkWriteRequest, parseAllowedOrigins, newSessionToken, hashSessionToken, SESSION_TTL_MS, IDLE_TIMEOUT_MS,
  createChallengeStore,
} from './auth.mjs';

// TLP
assert.deepEqual(TLP_ORDER, ['CLEAR', 'GREEN', 'AMBER', 'AMBER+STRICT', 'RED', 'RED+STRICT']);
assert.equal(TLP_ORDER.length, 6);
assert.equal(TLP_ORDER.at(-1), 'RED+STRICT');
assert.ok(Object.isFrozen(TLP_ORDER));
TLP_ORDER.forEach((t, i) => assert.equal(tlpRank(t), i));
assert.throws(() => tlpRank('X'), /unknown tlp/);

// Rank table
assert.equal(RANKS.length, 22);
assert.ok(Object.isFrozen(RANKS));
assert.equal(rankByCode('kapten').tlpMax, 'AMBER');
assert.equal(rankByCode('nope'), null);
assert.equal(tierOf('Tamtama Kepala'), 'TAMTAMA');
assert.equal(tierOf('Tamtama'), 'TAMTAMA');
assert.equal(tierOf('Bintara'), 'BINTARA');
assert.equal(tierOf('Bintara Tinggi'), 'BINTARA_TINGGI');
assert.equal(tierOf('PAMA'), 'PAMA');
assert.equal(tierOf('PAMEN'), 'PAMEN');
assert.equal(tierOf('PATI'), 'PATI');
assert.equal(tierOf('x'), null);

// Access-level reads: level L reads TLP index <= min(L, 4). Invalid level or TLP fails closed.
TLP_ORDER.forEach((tlp, i) => {
  for (let level = 1; level <= 5; level++) {
    assert.equal(canReadLevel(level, tlp), i <= Math.min(level, 4), `level ${level} read ${tlp}`);
  }
  assert.equal(canReadLevel(0, tlp), false);
  assert.equal(canReadLevel(6, tlp), false);
  assert.equal(canReadLevel(undefined, tlp), false);
  assert.equal(canReadLevel('3', tlp), false);
  assert.equal(canReadLevel(3.5, tlp), false);
});
assert.equal(canReadLevel(5, 'NOPE'), false);
assert.equal(canReadLevel(5, undefined), false);

// RED+STRICT unreachable by level (even 5); only a grant opens it. Level 4 reads up to RED.
assert.equal(canReadLevel(5, 'RED+STRICT'), false);
assert.equal(canReadLevel(4, 'RED+STRICT'), false);
assert.equal(canReadLevel(5, 'RED'), true);
assert.equal(canReadLevel(4, 'RED'), true);
assert.equal(canReadLevel(2, 'AMBER+STRICT'), false);
assert.equal(canReadLevel(3, 'AMBER+STRICT'), true);
assert.equal(canReadLevel(4, 'AMBER+STRICT'), true);

// RBAC matrix. Columns: PATI, PAMEN, PAMA, Bintara Tinggi, Bintara, Tamtama Kepala, Tamtama.
const RANK_COLS = ['jenderal-tni', 'kolonel', 'kapten', 'pembantu-letnan-satu', 'sersan-kepala', 'kopral-kepala', 'prajurit-dua'];
const MATRIX = {
  'upload.c': [1, 1, 1, 1, 1, 1, 1],
  'upload.r': [1, 1, 1, 0, 0, 0, 0],
  'upload.u': [1, 1, 0, 0, 0, 0, 0],
  'upload.d': [1, 1, 0, 0, 0, 0, 0],
  'document.c': [1, 1, 1, 0, 0, 0, 0],
  'document.r': [1, 1, 1, 1, 1, 1, 1],
  'document.u': [1, 1, 1, 0, 0, 0, 0],
  'document.approve': [1, 1, 0, 0, 0, 0, 0],
  'document.d': [1, 0, 0, 0, 0, 0, 0],
  'asset.c': [1, 1, 1, 0, 0, 0, 0],
  'asset.r': [1, 1, 1, 1, 1, 1, 1],
  'asset.u': [1, 1, 1, 0, 0, 0, 0],
  'asset.d': [1, 1, 0, 0, 0, 0, 0],
  'account.c': [1, 0, 0, 0, 0, 0, 0],
  'account.r': [1, 1, 0, 0, 0, 0, 0],
  'account.u': [1, 0, 0, 0, 0, 0, 0],
  'account.d': [1, 0, 0, 0, 0, 0, 0],
  'version.c': [1, 1, 1, 0, 0, 0, 0], // PAMA only via draft; ctx below is draft
};
// Level 5 for ceilings so the matrix isolates rank permissions. CLEAR is readable at any level.
const BASE_CTX = { accessLevel: 5, docStatus: 'draft', docTlp: 'CLEAR', newTlp: 'CLEAR', assetOwner: 'unit-a', actorOwnerLabel: 'unit-b', changesOwner: false };
for (const [action, cols] of Object.entries(MATRIX)) {
  RANK_COLS.forEach((code, i) => {
    assert.equal(authorize(code, action, BASE_CTX), cols[i] === 1, `${code} ${action}`);
  });
}

// Ceilings: rank permission AND level read (or grant on doc TLP). Driven by accessLevel, not rank.
for (const code of RANK_COLS) {
  for (const level of [1, 2, 3, 4, 5]) {
    TLP_ORDER.forEach((tlp, i) => {
      const ok = i <= Math.min(level, 4);
      const base = { accessLevel: level, docStatus: 'draft', docTlp: tlp, newTlp: tlp };
      const rk = RANK_COLS.indexOf(code);
      assert.equal(authorize(code, 'document.c', base), MATRIX['document.c'][rk] === 1 && ok, `${code} L${level} doc.c ${tlp}`);
      assert.equal(authorize(code, 'document.u', base), MATRIX['document.u'][rk] === 1 && ok, `${code} L${level} doc.u ${tlp}`);
      assert.equal(authorize(code, 'document.approve', { accessLevel: level, docTlp: tlp }), MATRIX['document.approve'][rk] === 1 && ok, `${code} L${level} approve ${tlp}`);
      assert.equal(authorize(code, 'version.c', { accessLevel: level, docStatus: 'draft', docTlp: tlp }), MATRIX['version.c'][rk] === 1 && ok, `${code} L${level} version ${tlp}`);
    });
  }
}
assert.equal(canReadLevel(0, 'CLEAR'), false);

// Destructive access requires a known document TLP and an allowed read ceiling.
assert.equal(authorize('jenderal-tni', 'document.d', { accessLevel: 5, docTlp: 'RED' }), true);
assert.equal(authorize('jenderal-tni', 'document.d', { accessLevel: 1, docTlp: 'RED' }), false);
assert.equal(authorize('jenderal-tni', 'document.d', { accessLevel: 5 }), false);

// document.c requires a valid new TLP; valid values still follow the rank matrix.
assert.equal(authorize('kolonel', 'document.c', { accessLevel: 5, docTlp: 'CLEAR' }), false);
assert.equal(authorize('kolonel', 'document.c', { accessLevel: 5, docTlp: 'CLEAR', newTlp: 'CLEAR' }), true);
assert.equal(authorize('sersan-kepala', 'document.c', { accessLevel: 5, docTlp: 'CLEAR', newTlp: 'CLEAR' }), false);
assert.equal(authorize('kolonel', 'document.c', { accessLevel: 1, docTlp: 'RED', newTlp: 'AMBER', granted: true }), false, 'grant does not lift newTlp ceiling');
assert.equal(authorize('kolonel', 'document.c', { accessLevel: 2, docTlp: 'RED', newTlp: 'AMBER', granted: true }), true, 'grant lifts docTlp ceiling only');
assert.equal(authorize('kolonel', 'document.c', { accessLevel: 1, docTlp: 'CLEAR', newTlp: 'AMBER' }), false, 'newTlp requires access level');

// Grant: active grant on doc TLP lifts read ceiling for c/u/approve/version.c; never for newTlp.
assert.equal(authorize('kapten', 'document.approve', { accessLevel: 1, docTlp: 'RED', granted: true }), false, 'rank approve not held');
assert.equal(authorize('kolonel', 'document.approve', { accessLevel: 1, docTlp: 'RED', granted: true }), true, 'grant lifts doc ceiling for approve');
assert.equal(authorize('kolonel', 'document.approve', { accessLevel: 1, docTlp: 'RED', granted: false }), false, 'no grant, no level');
assert.equal(authorize('kolonel', 'document.approve', { accessLevel: 1, docTlp: 'AMBER+STRICT', granted: true }), true);
assert.equal(authorize('kolonel', 'document.approve', { accessLevel: 1, docTlp: 'AMBER+STRICT', granted: false }), false);
assert.equal(authorize('kapten', 'version.c', { accessLevel: 2, docStatus: 'draft', docTlp: 'RED', granted: true }), true, 'grant lifts doc ceiling');
assert.equal(authorize('kapten', 'document.u', { accessLevel: 2, docStatus: 'draft', docTlp: 'AMBER', newTlp: 'RED', granted: true }), false, 'grant never lifts newTlp');
assert.equal(authorize('kapten', 'document.c', { accessLevel: 1, docTlp: 'CLEAR', newTlp: 'AMBER', granted: true }), false, 'newTlp needs level');

// Fail closed: missing / invalid access level.
assert.equal(authorize('kolonel', 'document.approve', { docTlp: 'CLEAR' }), false, 'no level');
assert.equal(authorize('kolonel', 'document.approve', { accessLevel: 0, docTlp: 'CLEAR' }), false, 'level 0');
assert.equal(authorize('kolonel', 'document.approve', { accessLevel: '5', docTlp: 'CLEAR' }), false, 'string level');
assert.equal(authorize('kapten', 'document.c', { accessLevel: 5, docTlp: 'RED', newTlp: 'RED' }), true, 'level 5 reads RED; rank tlpMax no longer gates');
assert.equal(authorize('kapten', 'document.c', { accessLevel: 2, docTlp: 'RED', newTlp: 'RED' }), false, 'level 2 cannot write RED');

// Access grant flag
assert.equal(can('jenderal-tni', 5).access.grant, true);
assert.equal(can('jenderal-tni', 4).access.grant, false);
assert.equal(can('jenderal-tni').access.grant, false);
assert.equal(can('nope', 5).access.grant, true, 'grant flag is level-only');
assert.deepEqual(can('kapten', 5).access, { grant: true, request: true, approve: true, revoke: true });
assert.deepEqual(can('kapten', 3).access, { grant: false, request: false, approve: false, revoke: false });
assert.deepEqual(can('kapten', 3, true).access, { grant: false, request: true, approve: true, revoke: true });

// Approver role: commander (level 5) first, then security officer.
assert.equal(approverRole({ accessLevel: 5 }), 'commander');
assert.equal(approverRole({ accessLevel: 4, securityOfficer: true }), 'security_officer');
assert.equal(approverRole({ accessLevel: 4, securityOfficer: false }), null);
assert.equal(approverRole({ accessLevel: 5, securityOfficer: true }), 'commander');
assert.equal(approverRole(), null);

// Extras
assert.equal(authorize('kapten', 'document.u', { accessLevel: 2, docStatus: 'approved' }), false);
assert.equal(authorize('kapten', 'document.u', { accessLevel: 2, docStatus: 'draft' }), true);
assert.equal(authorize('kapten', 'version.c', { accessLevel: 2, docStatus: 'draft', docTlp: 'AMBER' }), true);
assert.equal(authorize('kapten', 'version.c', { accessLevel: 2, docStatus: 'approved', docTlp: 'AMBER' }), false);
assert.equal(authorize('kolonel', 'version.c', { accessLevel: 3, docStatus: 'approved', docTlp: 'AMBER' }), true);
assert.equal(authorize('kolonel', 'document.approve', { accessLevel: 3, docTlp: 'AMBER+STRICT' }), true);
assert.equal(authorize('kolonel', 'document.approve', { accessLevel: 3, docTlp: 'RED' }), false);
assert.equal(authorize('pembantu-letnan-satu', 'asset.u', { accessLevel: 1, assetOwner: 'u1', actorOwnerLabel: 'u1' }), true);
assert.equal(authorize('pembantu-letnan-satu', 'asset.u', { accessLevel: 1, assetOwner: 'u2', actorOwnerLabel: 'u1' }), false);
assert.equal(authorize('pembantu-letnan-satu', 'asset.u', { accessLevel: 1, assetOwner: 'u1', actorOwnerLabel: 'u1', changesOwner: true }), false);
assert.equal(authorize('sersan-kepala', 'asset.u', { accessLevel: 1, assetOwner: 'u1', actorOwnerLabel: 'u1' }), true);
assert.equal(authorize('kapten', 'document.c', { accessLevel: 2, docTlp: 'RED', newTlp: 'RED' }), false);
assert.equal(authorize('kapten', 'document.c', { accessLevel: 2, docTlp: 'AMBER', newTlp: 'AMBER' }), true);
assert.equal(authorize('kapten', 'document.c', { accessLevel: 2, docTlp: 'AMBER', newTlp: 'RED' }), false);
assert.equal(authorize('nope', 'document.r', { accessLevel: 5 }), false);
assert.equal(authorize('kolonel', 'document.purge', { accessLevel: 5 }), false);
assert.equal(authorize('kolonel', 'document.r', { accessLevel: 1 }), true);
assert.equal(authorize('kolonel', 'document.r', null), true);

// Password
// Malformed stored hashes rejected before any crypto-api call (offline).
for (const bad of ['', 'x$y', 'scrypt$32768$8$1$AA==$AA==', 'hmac$$skadut-t1:a:b', 'hmac$AA==$garbage', undefined]) {
  assert.equal(await verifyPassword('x', bad), false, `malformed ${bad}`);
}
assert.equal(await dummyVerify('anything'), false);

// Session
assert.equal(SESSION_TTL_MS, 30 * 60 * 1000);
assert.equal(IDLE_TIMEOUT_MS, 5 * 60 * 1000);
assert.equal(newSessionToken().length, 43);
assert.equal(hashSessionToken('a'), hashSessionToken('a'));
assert.match(hashSessionToken('a'), /^[0-9a-f]{64}$/);

// OTP and challenge semantics
assert.equal(IDLE_TIMEOUT_MS, 5 * 60 * 1000);
{
  let now = 100;
  const challenges = createChallengeStore({ now: () => now, ttlMs: 2000 });
  const token = challenges.create('user-id');
  assert.equal(challenges.get(token).userId, 'user-id');
  assert.equal(challenges.consume(token), true);
  assert.equal(challenges.get(token), null);
  const expiring = challenges.create('user-id');
  now += 2000;
  assert.equal(challenges.get(expiring), null);
}

// Limiter
{
  const l = createLoginLimiter({ max: 5, windowMs: 1000 });
  for (let i = 0; i < 4; i++) l.recordFailure('u|ip');
  assert.equal(l.isLimited('u|ip'), false);
  l.recordFailure('u|ip');
  assert.equal(l.isLimited('u|ip'), true);
  l.reset('u|ip');
  assert.equal(l.isLimited('u|ip'), false);
}
{
  let t = 0;
  const l = createLoginLimiter({ max: 5, windowMs: 1000, now: () => t });
  for (let i = 0; i < 5; i++) l.recordFailure('k');
  assert.equal(l.isLimited('k'), true);
  t = 999;
  assert.equal(l.isLimited('k'), true);
  t = 1000;
  assert.equal(l.isLimited('k'), false);
}

// Write-request guard
const ORIGINS = parseAllowedOrigins('');
const JSON_H = { origin: 'http://localhost:5173', 'content-type': 'application/json', 'content-length': '10' };
assert.equal(checkWriteRequest('GET', {}, ORIGINS), null);
assert.equal(checkWriteRequest('HEAD', {}, ORIGINS), null);
assert.deepEqual(checkWriteRequest('POST', { 'content-length': '2' }, ORIGINS), { status: 403, error: 'forbidden' });
assert.deepEqual(checkWriteRequest('POST', { ...JSON_H, origin: 'https://evil.test' }, ORIGINS), { status: 403, error: 'forbidden' });
assert.equal(checkWriteRequest('POST', JSON_H, ORIGINS), null);
assert.equal(checkWriteRequest('POST', { ...JSON_H, 'content-type': 'application/json; charset=utf-8' }, ORIGINS), null);
assert.deepEqual(checkWriteRequest('POST', { ...JSON_H, 'content-type': 'text/plain' }, ORIGINS), { status: 415, error: 'unsupported media type' });
assert.deepEqual(checkWriteRequest('PUT', { origin: 'http://localhost:5173', 'transfer-encoding': 'chunked' }, ORIGINS), { status: 415, error: 'unsupported media type' });
assert.equal(checkWriteRequest('DELETE', { origin: 'http://localhost:5173' }, ORIGINS), null);
assert.equal(checkWriteRequest('DELETE', { origin: 'http://localhost:5173', 'content-length': '0' }, ORIGINS), null);

// Origins
assert.ok(parseAllowedOrigins(undefined).has('http://127.0.0.1:8088'));
assert.ok(parseAllowedOrigins(' https://a.test , https://b.test ').has('https://b.test'));
assert.equal(parseAllowedOrigins('https://a.test').has('http://localhost:5173'), false);

console.log('auth ok');
