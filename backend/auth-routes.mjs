// Route handlers: login (step 1), otp (step 2), device-check, logout, me, ranks. Deps injected from server.mjs.
import { RANKS, verifyPassword, dummyVerify, createChallengeStore } from './auth.mjs';
import { findLoginUser, lookupSession, createSession, destroySession, meFromRow, meJson, sidSetCookie, sidClearCookie, readPreferences, patchPreferences, validatePreferencesPatch, preferencesBodyTooLarge, mergePreferences, DEFAULT_PREFERENCES } from './session.mjs';
import { post } from './crypto-client.mjs';

const cryptoPostDefault = post;

const USERNAME = /^[a-z0-9.-]{3,40}$/;
const MAX_PASSWORD = 1024;
const MAX_FAILS = 5;
const challenges = createChallengeStore();

// RFC 1918 + loopback. Server-observed address only; X-Forwarded-For is not trusted.
const PRIVATE = /^(::ffff:)?(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|^::1$/;

export function makeAuthRoutes({ q, send, readRaw, limiter, verify = verifyPassword, dummy = dummyVerify, challengeStore = challenges, cryptoPost = cryptoPostDefault }) {
  const ipOf = (req) => req.socket.remoteAddress ?? '';
  let cryptoCache = null;
  let cryptoInflight = null;
  const CRYPTO_FAIL = { status: 'fail', note: 'crypto-api tidak merespons' };
  // ponytail: 5 s cache; device-check is public, caps anonymous load on crypto-api. Upgrade: per-IP rate limit or background health poller.
  function probeCrypto() {
    if (cryptoCache && Date.now() - cryptoCache.at < 5000) return Promise.resolve(cryptoCache.value);
    if (cryptoInflight) return cryptoInflight;
    cryptoInflight = (async () => {
      const t0 = performance.now();
      let value;
      try {
        const r = await cryptoPost('/verifyhmac', { Message: 'probe', HMACstring: 'probe' }, 2000, { probe: true });
        value = r.status === 200 && r.json && r.json.Value === false
          ? { status: 'pass', latencyMs: Math.round(performance.now() - t0) }
          : CRYPTO_FAIL;
      } catch {
        value = CRYPTO_FAIL;
      }
      cryptoCache = { at: Date.now(), value };
      return value;
    })().finally(() => { cryptoInflight = null; });
    return cryptoInflight;
  }

  // Counts one failure (password or code) on the account. Lock at MAX_FAILS: reset counter to 0, set locked_until +15 min.
  // Returns attemptsLeft after this failure. Unknown user (user === null): audit only, no DB row touched.
  async function recordFail(user, username, action, ip) {
    const detail = JSON.stringify({ ip });
    const label = action === 'login.code.fail' ? 'code' : 'password';
    if (!user) {
      await q('SELECT log_audit($1, $2, $3, $4, $5, $6::jsonb)', [username, action, 'user', username, `Failed ${label} authentication`, detail]);
      return MAX_FAILS - 1;
    }
    const { rows } = await q(
      `UPDATE users SET
         failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END,
         failed_since_last = failed_since_last + 1,
         locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + interval '15 minutes' ELSE locked_until END
       WHERE id = $1
       RETURNING failed_attempts, (locked_until > now() AND failed_attempts = 0) AS locked_now`,
      [user.id, MAX_FAILS],
    );
    const row = rows[0];
    await q('SELECT log_audit($1, $2, $3, $4, $5, $6::jsonb)', [user.username, action, 'user', user.username, `Failed ${label} authentication`, detail]);
    if (row.locked_now) {
      await q('SELECT log_audit($1, $2, $3, $4, $5, $6::jsonb)', [user.username, 'login.locked', 'user', user.username, 'Account locked after failed attempts', detail]);
      return 0;
    }
    return MAX_FAILS - Number(row.failed_attempts);
  }

  const isLocked = (u) => !!u.locked_until && new Date(u.locked_until) > new Date();
  const lockedBody = (u) => ({ error: 'locked', lockedUntil: new Date(u.locked_until).toISOString() });

  async function login(req, res) {
    const raw = await readRaw(req);
    if (raw === null) return send(res, 413, { error: 'too large' }, { Connection: 'close' });
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'bad request' }); }
    if (!body || typeof body !== 'object' || typeof body.username !== 'string' || typeof body.password !== 'string') {
      return send(res, 400, { error: 'bad request' });
    }
    const { username, password } = body;
    if (username.length > 64 || password.length > MAX_PASSWORD) return send(res, 400, { error: 'bad request' });

    // Limiter key unchanged from the original code (x-real-ip, falling back to socket).
    const ip = ipOf(req);
    const key = `${username}|${req.headers['x-real-ip'] ?? ip}`;
    if (limiter.isLimited(key)) return send(res, 429, { error: 'rate_limited' });

    const user = USERNAME.test(username) ? await findLoginUser(q, username) : null;
    // Same crypto round trip on unknown user, so timing does not reveal existence.
    const ok = user ? await verify(password, user.password_hash) : await dummy(password);
    // Locked is reported only after a correct password, so 423 never reveals that a username exists.
    if (user?.active && ok && isLocked(user)) return send(res, 423, lockedBody(user));
    if (!user || !ok || !user.active) {
      limiter.recordFailure(key);
      // No counting while locked: the lock already blocks sign-in, and counting would re-arm it.
      if (!(user?.active && isLocked(user))) await recordFail(user?.active ? user : null, username, 'login.password.fail', ip);
      // Fixed count keeps the response body identical for unknown and known usernames.
      return send(res, 401, { error: 'invalid credentials', attemptsLeft: MAX_FAILS - 1 });
    }
    limiter.reset(key);
    return send(res, 200, { step: 'code', challenge: challengeStore.create(user.id) });
  }

  async function otp(req, res) {
    const raw = await readRaw(req);
    if (raw === null) return send(res, 413, { error: 'too large' }, { Connection: 'close' });
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'bad request' }); }
    if (!body || typeof body !== 'object' || typeof body.challenge !== 'string') return send(res, 400, { error: 'bad request' });

    const c = challengeStore.get(body.challenge);
    if (!c) return send(res, 401, { error: 'invalid credentials' });
    const { rows } = await q(
      'SELECT id, username, name, rank_code, owner_label, access_level, security_officer, super_admin, unit, unit_head, active, locked_until, last_login_at, failed_since_last, totp_secret FROM users WHERE id = $1',
      [c.userId],
    );
    const user = rows[0];
    if (!user || !user.active) return send(res, 401, { error: 'invalid credentials' });
    if (isLocked(user)) return send(res, 423, lockedBody(user));

    let codeOk = typeof body.code === 'string' && /^\d{6}$/.test(body.code) && !!user.totp_secret;
    if (codeOk) {
      let r;
      try { r = await cryptoPost('/totpvalidate', { SecretEncrypted: user.totp_secret, CodeOTP: body.code }); }
      catch { return send(res, 503, { error: 'crypto unavailable' }); }
      if (r.status === 503) return send(res, 503, { error: 'crypto unavailable' });
      codeOk = r.status === 200 && r.json?.valid === true;
    }
    if (!codeOk) {
      // Crypto down is not a wrong code: 503, no failure counted.
      // Challenge is not consumed: wrong code may be retried until expiry or lock.
      const attemptsLeft = await recordFail(user, user.username, 'login.code.fail', ipOf(req));
      return send(res, 401, { error: 'invalid code', attemptsLeft });
    }

    challengeStore.consume(body.challenge);
    const previous = {
      lastLoginAt: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
      failedSinceLast: Number(user.failed_since_last),
    };
    const token = await createSession(q, user.id);
    await q('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now(), failed_since_last = 0 WHERE id = $1', [user.id]);
    await q('SELECT log_audit($1, $2, $3, $4, $5, $6::jsonb)', [user.username, 'login.success', 'user', user.username, 'Sign-in completed', JSON.stringify({ ip: ipOf(req) })]);
    return send(
      res,
      200,
      { ok: true, user: (({ username, rankName, accessLevel, unit, unitHead, securityOfficer, superAdmin }) => ({ username, rankName, accessLevel, unit, unitHead, securityOfficer, superAdmin }))(meJson(meFromRow(user))), lastLoginAt: previous.lastLoginAt, failedSinceLast: previous.failedSinceLast },
      { 'Set-Cookie': sidSetCookie(token) },
    );
  }

  async function deviceCheck(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const challenge = req.headers['x-challenge'] ?? url.searchParams.get('challenge');
    const pending = typeof challenge === 'string' && challengeStore.get(challenge) !== null;
    const session = await lookupSession(q, req.headers.cookie);
    if (!pending && !session) return send(res, 401, { error: 'invalid credentials' });

    const ip = ipOf(req);
    const rawTime = req.headers['x-client-time'] ?? url.searchParams.get('clientTime');
    const clientTime = rawTime === undefined ? NaN : Number(rawTime);
    const hasTime = Number.isFinite(clientTime) && clientTime > 0;
    const driftMs = hasTime ? clientTime - Date.now() : undefined;
    const crypto = await probeCrypto();

    return send(res, 200, {
      checks: {
        network: { status: PRIVATE.test(ip) ? 'pass' : 'warn', ip },
        // Code passes only with a live session (issued after OTP). A pending challenge alone is not a pass.
        code: { status: session ? 'pass' : 'pending' },
        clock: hasTime
          ? { status: Math.abs(driftMs) < 30000 ? 'pass' : 'fail', driftMs }
          : { status: 'unverified' },
        crypto,
      },
    });
  }

  async function logout(req, res) {
    await destroySession(q, req.headers.cookie);
    await q('SELECT log_audit($1, $2, $3, $4, $5, $6::jsonb)', [req.me.username, 'logout', 'user', req.me.username, 'Signed out', JSON.stringify({ ip: ipOf(req) })]);
    res.writeHead(204, { 'Set-Cookie': sidClearCookie, 'Cache-Control': 'no-store' });
    res.end();
  }

  async function me(req, res) {
    return send(res, 200, meJson(req.me));
  }

  async function getPreferences(req, res) {
    const saved = await readPreferences(q, req.me.id);
    return send(res, 200, mergePreferences(saved ?? DEFAULT_PREFERENCES));
  }

  async function patchUserPreferences(req, res) {
    const raw = await readRaw(req);
    if (raw === null || preferencesBodyTooLarge(raw)) return send(res, 400, { error: 'bad request' }, raw === null ? { Connection: 'close' } : {});
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'bad request' }); }
    if (validatePreferencesPatch(body)) return send(res, 400, { error: 'bad request' });
    const saved = await patchPreferences(q, req.me.id, body);
    if (saved === null) return send(res, 404, { error: 'not found' });
    return send(res, 200, mergePreferences(saved));
  }

  async function ranks(req, res) {
    return send(res, 200, RANKS.map(({ code, name, golongan, tlpMax }) => ({ code, name, golongan, tlpMax })));
  }

  return { login, otp, deviceCheck, logout, me, getPreferences, patchPreferences: patchUserPreferences, ranks };
}
