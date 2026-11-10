// Access-level changes: officer-initiated raise requests + immediate lowering. Deps injected from server.mjs.
const REQUEST_ID = /^\d{1,18}$/;
const USERNAME = /^[a-z0-9.-]{3,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const JSON_CT = /^application\/json(\s*;\s*charset=utf-8)?$/i;
const MAX_BODY = 4096;
const canManage = (me) => me.accessLevel === 5 || me.securityOfficer === true;

const len = (s) => [...s].length;

function isDate(v) {
  if (typeof v !== 'string' || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// reviewDue cap = current_date + 12 months, clamped to month end as Postgres does.
function plus12Months(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// FIPS 199 basis must match level (011): 1-2 LOW, 3 MODERATE, 4-5 HIGH.
const basisFor = (level) => (level <= 2 ? 'LOW' : level === 3 ? 'MODERATE' : 'HIGH');

// Pure pre-check mirroring request_level_change (011). Returns null when the raise may be submitted.
export function validateRaise(input, currentLevel) {
  const b = input ?? {};
  const t = new Date().toISOString().slice(0, 10);
  if (!Number.isInteger(b.newLevel) || b.newLevel < 1 || b.newLevel > 5) return 'newLevel';
  if (b.newLevel === currentLevel) return 'unchanged';
  if (b.newLevel < currentLevel) return 'not-raise';
  if (typeof b.justification !== 'string') return 'justification';
  const j = b.justification.trim();
  if (len(j) < 1 || len(j) > 500) return 'justification';
  if (b.screeningVerified !== true) return 'screeningVerified';
  if (typeof b.screeningRef !== 'string') return 'screeningRef';
  const ref = b.screeningRef.trim();
  if (len(ref) < 1 || len(ref) > 120) return 'screeningRef';
  if (b.accessAgreementSigned !== true) return 'accessAgreementSigned';
  if (!isDate(b.accessAgreementDate) || b.accessAgreementDate > t) return 'accessAgreementDate';
  if (!isDate(b.reviewDue) || b.reviewDue <= t || b.reviewDue > plus12Months(t)) return 'reviewDue';
  if (b.fips199Basis !== basisFor(b.newLevel)) return 'fips199Basis';
  return null;
}

export function makeLevelRoutes({ q, send, readRaw, forbid, reveal, seal }) {
  // SQLSTATE -> HTTP. 42501 is audited through forbid. Unknown -> rethrow (500).
  function dbError(req, res, err, objectType, objectId, summary) {
    if (err.code === '42501') return forbid(res, req.me, objectType, objectId, summary);
    if (err.code === 'P0002') return send(res, 404, { error: 'not found' });
    if (err.code === '22023') return send(res, 400, { error: 'bad request' });
    if (err.code === '23505' || err.code === '55000') return send(res, 409, { error: 'conflict' });
    throw err;
  }

  // Same gates as grants: content-type, cap, JSON object. Returns null after sending an error.
  async function jsonBody(req, res) {
    if (!JSON_CT.test(req.headers['content-type'] ?? '')) {
      send(res, 415, { error: 'unsupported media type' });
      return null;
    }
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) {
      send(res, 413, { error: 'too large' }, { Connection: 'close' });
      return null;
    }
    const raw = await readRaw(req);
    if (raw === null || raw.length > MAX_BODY) {
      send(res, 413, { error: 'too large' }, { Connection: 'close' });
      return null;
    }
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      send(res, 400, { error: 'bad request' });
      return null;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      send(res, 400, { error: 'bad request' });
      return null;
    }
    return body;
  }

  async function lowerLevel(req, res, username, current, body) {
    if (body.newLevel < 1) return send(res, 400, { error: 'bad request' });
    if (typeof body.justification !== 'string') return send(res, 400, { error: 'bad request' });
    const justification = body.justification.trim();
    if (len(justification) < 1 || len(justification) > 500) return send(res, 400, { error: 'bad request' });
    let r;
    try {
      ({ rows: [r] } = await q(
        'SELECT lower_user_level($1, $2, $3, $4) AS r',
        [req.me.username, username, body.newLevel, justification], // not stored; 015 drops it from audit
      ));
    } catch (err) {
      return dbError(req, res, err, 'user', username, 'level lower denied');
    }
    const v = r.r;
    return send(res, 200, { username: v.username, fromLevel: v.fromLevel, toLevel: v.toLevel, applied: true });
  }

  async function requestRaise(req, res, username) {
    if (!canManage(req.me)) return forbid(res, req.me, 'user', username, 'level request denied');
    if (!USERNAME.test(username)) return send(res, 400, { error: 'bad request' });
    const body = await jsonBody(req, res);
    if (body === null) return;
    if (!Number.isInteger(body.newLevel)) return send(res, 400, { error: 'bad request' });

    const { rows } = await q('SELECT access_level, security_officer FROM users WHERE username = $1 AND active', [username]);
    const target = rows[0];
    if (!target) return send(res, 404, { error: 'not found' });
    const current = Number(target.access_level);
    if (body.newLevel === current) return send(res, 400, { error: 'bad request' });
    if (body.newLevel < current) return lowerLevel(req, res, username, current, body);

    const bad = validateRaise(body, current);
    if (bad) return send(res, 400, { error: 'invalid' });
    const [sealedJust, sealedRef] = await Promise.all([seal(body.justification.trim()), seal(body.screeningRef.trim())]);
    if (sealedJust === null || sealedRef === null) return send(res, 502, { error: 'crypto failure' });

    let r;
    try {
      ({ rows: [r] } = await q(
        'SELECT request_level_change($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10) AS r',
        [
          req.me.username, username, body.newLevel, sealedJust,
          body.screeningVerified, sealedRef, body.accessAgreementSigned,
          body.accessAgreementDate, body.reviewDue, body.fips199Basis,
        ],
      ));
    } catch (err) {
      return dbError(req, res, err, 'user', username, 'level request denied');
    }
    return send(res, 201, { id: String(r.r.requestId), status: 'pending' });
  }

  async function listRequests(req, res) {
    if (!canManage(req.me)) return forbid(res, req.me, 'audit', 'level_requests', 'level request list denied');
    const { rows } = await q(
      `SELECT id, target_user, requested_by, current_level, new_level, justification,
              screening_verified, screening_ref, access_agreement_signed,
              to_char(access_agreement_date, 'YYYY-MM-DD') AS access_agreement_date,
              to_char(review_due, 'YYYY-MM-DD') AS review_due,
              fips199_basis, status, decided_by, decided_at, decision_reason, created_at
         FROM level_change_requests
        ORDER BY id DESC
        LIMIT 200`,
    );
    const out = rows.map((r) => ({
      id: String(r.id),
      targetUser: r.target_user,
      requestedBy: r.requested_by,
      currentLevel: r.current_level,
      newLevel: r.new_level,
      justification: r.justification,
      screeningVerified: r.screening_verified === true,
      screeningRef: r.screening_ref ?? null,
      accessAgreementSigned: r.access_agreement_signed === true,
      accessAgreementDate: r.access_agreement_date ?? null,
      reviewDue: r.review_due ?? null,
      fips199Basis: r.fips199_basis ?? null,
      status: r.status,
      decidedBy: r.decided_by ?? null,
      decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
      decisionReason: r.decision_reason ?? null,
      createdAt: r.created_at.toISOString(),
    }));
    await reveal(out.flatMap((r) => [[r, 'justification'], [r, 'screeningRef'], [r, 'decisionReason']]));
    return send(res, 200, out);
  }

  async function decideRaise(req, res, id) {
    if (!canManage(req.me)) return forbid(res, req.me, 'audit', 'level_requests', 'level decision denied');
    if (!REQUEST_ID.test(id)) return send(res, 400, { error: 'bad request' });
    const body = await jsonBody(req, res);
    if (body === null) return;
    if (body.decision !== 'approve' && body.decision !== 'deny') return send(res, 400, { error: 'bad request' });
    if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') {
      return send(res, 400, { error: 'bad request' });
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : null;
    if (reason !== null && len(reason) > 500) return send(res, 400, { error: 'bad request' });
    const sealedReason = reason ? await seal(reason) : null;
    if (reason && sealedReason === null) return send(res, 502, { error: 'crypto failure' });

    let r;
    try {
      ({ rows: [r] } = await q(
        'SELECT decide_level_change($1, $2::bigint, $3, $4) AS r',
        [req.me.username, id, body.decision, sealedReason],
      ));
    } catch (err) {
      return dbError(req, res, err, 'audit', 'level_requests', 'level decision denied');
    }
    return send(res, 200, { id: String(r.r.requestId), status: r.r.status, applied: r.r.applied === true });
  }

  return { requestRaise, listRequests, decideRaise, lowerLevel };
}
