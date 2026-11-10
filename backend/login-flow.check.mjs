// Self-check: generic credential errors, combined password/code lockout, OTP format, single-use and expiry, no pre-OTP session.
import assert from 'node:assert/strict';
import { makeAuthRoutes } from './auth-routes.mjs';
import { createChallengeStore, createLoginLimiter, DEMO_OTP } from './auth.mjs';

const user = {
  id: 'u1', username: 'abc', name: 'A', rank_code: 'kapten', owner_label: null,
  access_level: 2, security_officer: false, unit: null, unit_head: false,
  password_hash: 'hash', active: true, locked_until: null, last_login_at: null, failed_since_last: 0,
};
function harness() {
  let attempts = 0;
  let lockedUntil = null;
  let sessions = 0;
  let clock = 1000;
  const challengeStore = createChallengeStore({ now: () => clock, ttlMs: 2000 });
  const events = [];
  const q = async (sql, params) => {
    if (sql.startsWith('UPDATE users SET') && sql.includes('failed_attempts = CASE')) {
      attempts++;
      if (attempts >= 5) lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      return { rows: [{ failed_attempts: attempts >= 5 ? 0 : attempts, locked_now: attempts >= 5 }] };
    }
    if (sql.includes('WHERE username')) {
      return { rows: params[0] === 'abc' ? [{ ...user, failed_since_last: attempts, locked_until: lockedUntil }] : [] };
    }
    if (sql.includes('WHERE id = $1')) return { rows: [{ ...user, failed_since_last: attempts, locked_until: lockedUntil }] };
    if (sql.startsWith('INSERT INTO sessions')) { sessions++; return { rows: [] }; }
    if (sql.startsWith('SELECT log_audit')) { events.push(params[1]); return { rows: [] }; }
    return { rows: [] };
  };
  const send = (res, status, body, headers = {}) => Object.assign(res, { status, body, headers });
  const routes = makeAuthRoutes({
    q, send, challengeStore, limiter: createLoginLimiter(),
    verify: async (plain) => plain === 'correct', dummy: async () => false,
    readRaw: async (req) => Buffer.from(JSON.stringify(req.body)),
  });
  const req = (body, extra = {}) => ({ body, headers: {}, socket: { remoteAddress: '127.0.0.1' }, url: '/api/auth', ...extra });
  return { routes, req, get attempts() { return attempts; }, get sessions() { return sessions; }, events, advance: (ms) => { clock += ms; } };
}
const reply = () => ({});

// Unknown-user vs wrong-password shape is identical; neither response issues a session cookie.
{
  const h = harness();
  const unknown = reply();
  await h.routes.login(h.req({ username: 'missing', password: 'x' }), unknown);
  const wrong = reply();
  await h.routes.login(h.req({ username: 'abc', password: 'wrong' }), wrong);
  assert.deepEqual(unknown.body, wrong.body);
  assert.equal(unknown.status, 401);
  assert.equal(Object.hasOwn(unknown.headers, 'Set-Cookie'), false);
  assert.equal(h.sessions, 0);
}

// Three bad passwords + two bad codes lock the same DB account.
{
  const h = harness();
  for (let i = 0; i < 3; i++) await h.routes.login(h.req({ username: 'abc', password: 'wrong' }), reply());
  const start = reply();
  await h.routes.login(h.req({ username: 'abc', password: 'correct' }), start);
  assert.equal(start.status, 200);
  assert.equal(start.body.step, 'code');
  assert.equal(Object.hasOwn(start.headers, 'Set-Cookie'), false);
  // Failure 4 (first bad code): 401, one left.
  const c1 = reply();
  await h.routes.otp(h.req({ challenge: start.body.challenge, code: '12345' }), c1);
  assert.deepEqual(c1.body, { error: 'invalid code', attemptsLeft: 1 });
  // Failure 5 (second bad code) locks the account: 401 with 0 left, then 423 on the next try.
  const c2 = reply();
  await h.routes.otp(h.req({ challenge: start.body.challenge, code: '1234567' }), c2);
  assert.deepEqual(c2.body, { error: 'invalid code', attemptsLeft: 0 });
  assert.ok(h.events.includes('login.locked'));
  const c3 = reply();
  await h.routes.otp(h.req({ challenge: start.body.challenge, code: DEMO_OTP }), c3);
  assert.equal(c3.status, 423);
  assert.equal(c3.body.error, 'locked');
  assert.equal(h.sessions, 0);
}

// Malformed codes all fail the exact-6-digit rule, including whitespace and letters.
{
  const h = harness();
  for (const code of ['12345a', ' 123456', 123456]) {
    const s = reply();
    await h.routes.login(h.req({ username: 'abc', password: 'correct' }), s);
    const out = reply();
    await h.routes.otp(h.req({ challenge: s.body.challenge, code }), out);
    assert.equal(out.status, 401, `code ${JSON.stringify(code)}`);
    assert.equal(out.body.error, 'invalid code');
  }
  assert.equal(h.sessions, 0);
}

// Correct OTP issues one session, consumes challenge; expiry and reuse reject.
{
  const h = harness();
  const start = reply();
  await h.routes.login(h.req({ username: 'abc', password: 'correct' }), start);
  const invalid = reply();
  await h.routes.otp(h.req({ challenge: start.body.challenge, code: DEMO_OTP }), invalid);
  assert.equal(invalid.status, 200);
  assert.equal(invalid.body.ok, true);
  assert.equal(invalid.headers['Set-Cookie'].includes('HttpOnly'), true);
  assert.equal(h.sessions, 1);
  const reused = reply();
  await h.routes.otp(h.req({ challenge: start.body.challenge, code: DEMO_OTP }), reused);
  assert.deepEqual(reused.body, { error: 'invalid credentials' });

  const next = reply();
  await h.routes.login(h.req({ username: 'abc', password: 'correct' }), next);
  h.advance(2000);
  const expired = reply();
  await h.routes.otp(h.req({ challenge: next.body.challenge, code: DEMO_OTP }), expired);
  assert.deepEqual(expired.body, { error: 'invalid credentials' });
}
