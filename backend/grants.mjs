// Access grants + dual-authorization access requests. Deps injected from server.mjs (DB query, send, body reader, forbid).
import { approverRole } from './auth.mjs';

const DOC_ID = /^DOC-\d{4}$/;
const REQUEST_ID = /^\d{1,18}$/;
const USERNAME = /^[a-z0-9.-]{3,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const JSON_CT = /^application\/json(\s*;\s*charset=utf-8)?$/i;
const MAX_BODY = 4096;

// null/absent -> null. 'YYYY-MM-DD' -> end of that UTC day. Full ISO -> parsed. Anything else -> undefined.
export function parseExpiresAt(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  let t;
  if (DATE.test(v)) {
    const d = new Date(`${v}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return undefined;
    t = Date.parse(`${v}T23:59:59Z`);
  } else if (ISO.test(v)) {
    t = Date.parse(v);
  } else {
    return undefined;
  }
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

const canManage = (me) => me.accessLevel === 5 || me.securityOfficer === true;

// Pure pre-check mirroring decide_access_request. Returns null when the decision may proceed.
export function decisionError(me, request, approvals) {
  if (request.status !== 'pending') return 'not-pending';
  if (me.username === request.requestedBy || me.username === request.grantee) return 'self';
  if (approvals.some((a) => a.approver === me.username)) return 'duplicate';
  const role = approverRole(me, approvals.map((a) => a.role));
  if (role === null) return 'role';
  if (approvals.some((a) => a.role === role)) return 'role-taken';
  return null;
}

export function makeGrantRoutes({ q, send, readRaw, forbid, reveal, seal }) {
  // SQLSTATE -> HTTP. 42501 is audited through forbid. Unknown -> rethrow (500).
  function dbError(req, res, err, objectType, objectId, summary) {
    if (err.code === '42501') return forbid(res, req.me, objectType, objectId, summary);
    if (err.code === 'P0002') return send(res, 404, { error: 'not found' });
    if (err.code === '22023') return send(res, 400, { error: 'bad request' });
    if (err.code === '23505' || err.code === '55000') return send(res, 409, { error: 'conflict' });
    throw err;
  }

  async function list(req, res, id) {
    if (!canManage(req.me)) return forbid(res, req.me, 'document', id, 'grant api denied');
    if (!DOC_ID.test(id)) return send(res, 400, { error: 'bad request' });
    const doc = await q('SELECT 1 FROM documents WHERE id = $1', [id]);
    if (doc.rows.length === 0) return send(res, 404, { error: 'not found' });
    const { rows } = await q(
      `SELECT u.username, r.name AS rank_name, u.access_level, u.unit, u.unit_head, gb.username AS granted_by,
              g.granted_at, g.expires_at, (g.expires_at IS NULL OR g.expires_at > now()) AS active
         FROM document_access_grants g
         JOIN users u ON u.id = g.user_id
         LEFT JOIN ranks r ON r.code = u.rank_code
         LEFT JOIN users gb ON gb.id = g.granted_by
        WHERE g.document_id = $1 AND g.revoked_at IS NULL
        ORDER BY u.username`,
      [id],
    );
    return send(res, 200, rows.map((r) => ({
      username: r.username,
      rankName: r.rank_name ?? null,
      accessLevel: r.access_level,
      unit: r.unit ?? null,
      unitHead: r.unit_head === true,
      grantedBy: r.granted_by ?? null,
      grantedAt: r.granted_at.toISOString(),
      expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
      active: r.active,
    })));
  }

  async function revoke(req, res, id, username) {
    if (!canManage(req.me)) return forbid(res, req.me, 'document', id, 'grant api denied');
    if (!DOC_ID.test(id) || !USERNAME.test(username)) return send(res, 400, { error: 'bad request' });
    try {
      await q('SELECT revoke_document_access($1, $2, $3) AS r', [req.me.username, id, username]);
    } catch (err) {
      return dbError(req, res, err, 'document', id, 'grant revoke denied');
    }
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
  }

  async function users(req, res) {
    if (!canManage(req.me)) return forbid(res, req.me, 'user', 'list', 'grant api denied');
    const { rows } = await q(
      'SELECT u.username, u.name, r.name AS rank_name, r.golongan, u.access_level, u.unit, u.unit_head, u.security_officer FROM users u LEFT JOIN ranks r ON r.code = u.rank_code WHERE u.active ORDER BY r.sort, u.username',
    );
    return send(res, 200, rows.map((r) => ({
      username: r.username,
      name: r.name ?? null,
      rankName: r.rank_name ?? null,
      golongan: r.golongan ?? null,
      accessLevel: r.access_level,
      unit: r.unit ?? null,
      unitHead: r.unit_head === true,
      securityOfficer: r.security_officer === true,
    })));
  }

  async function requests(req, res) {
    if (!canManage(req.me)) return forbid(res, req.me, 'audit', 'access_requests', 'access request list denied');
    const { rows } = await q(
      `SELECT r.id, r.document_id, d.tlp, r.grantee, gu.unit AS grantee_unit, r.requested_by,
              r.reason, r.expires_at, r.status, r.created_at
         FROM access_requests r
         JOIN documents d ON d.id = r.document_id
         LEFT JOIN users gu ON gu.username = r.grantee
        ORDER BY r.id DESC
        LIMIT 200`,
    );
    const approvalsByRequest = new Map();
    if (rows.length) {
      const a = await q(
        `SELECT request_id, approver, role, decision, reason, at
           FROM access_approvals
          WHERE request_id = ANY($1::bigint[])
          ORDER BY at`,
        [rows.map((r) => r.id)],
      );
      for (const row of a.rows) {
        const key = String(row.request_id);
        const list = approvalsByRequest.get(key) ?? [];
        list.push({
          approver: row.approver,
          role: row.role,
          decision: row.decision,
          reason: row.reason ?? null,
          at: row.at.toISOString(),
        });
        approvalsByRequest.set(key, list);
      }
    }
    const out = rows.map((r) => ({
      id: String(r.id),
      documentId: r.document_id,
      tlp: r.tlp,
      grantee: r.grantee,
      granteeUnit: r.grantee_unit ?? null,
      requestedBy: r.requested_by,
      reason: r.reason,
      expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      approvals: approvalsByRequest.get(String(r.id)) ?? [],
    }));
    const targets = out.flatMap((r) => [[r, 'reason'], ...r.approvals.map((a) => [a, 'reason'])]);
    await reveal(targets);
    return send(res, 200, out);
  }

  async function createRequest(req, res, id) {
    if (!canManage(req.me)) return forbid(res, req.me, 'document', id, 'access request denied');
    if (!DOC_ID.test(id)) return send(res, 400, { error: 'bad request' });
    if (!JSON_CT.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: 'unsupported media type' });
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) return send(res, 413, { error: 'too large' }, { Connection: 'close' });
    const raw = await readRaw(req);
    if (raw === null || raw.length > MAX_BODY) return send(res, 413, { error: 'too large' }, { Connection: 'close' });
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return send(res, 400, { error: 'bad request' });
    }
    if (!body || typeof body !== 'object' || typeof body.grantee !== 'string' || !USERNAME.test(body.grantee)) {
      return send(res, 400, { error: 'bad request' });
    }
    if (typeof body.reason !== 'string') return send(res, 400, { error: 'bad request' });
    const reason = body.reason.trim();
    if ([...reason].length < 1 || [...reason].length > 500) return send(res, 400, { error: 'bad request' });
    const expiresAt = parseExpiresAt(body.expiresAt);
    if (expiresAt === undefined) return send(res, 400, { error: 'bad request' });
    const sealed = await seal(reason);
    if (sealed === null) return send(res, 502, { error: 'crypto failure' });
    let r;
    try {
      ({ rows: [r] } = await q('SELECT request_document_access($1, $2, $3, $4, $5::timestamptz) AS r', [req.me.username, id, body.grantee, sealed, expiresAt]));
    } catch (err) {
      return dbError(req, res, err, 'document', id, 'access request denied');
    }
    return send(res, 201, { id: String(r.r.requestId), status: 'pending' });
  }

  async function decide(req, res, id) {
    if (!canManage(req.me)) return forbid(res, req.me, 'audit', 'access_requests', 'access decision denied');
    if (!REQUEST_ID.test(id)) return send(res, 400, { error: 'bad request' });
    if (!JSON_CT.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: 'unsupported media type' });
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) return send(res, 413, { error: 'too large' }, { Connection: 'close' });
    const raw = await readRaw(req);
    if (raw === null || raw.length > MAX_BODY) return send(res, 413, { error: 'too large' }, { Connection: 'close' });
    let body;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return send(res, 400, { error: 'bad request' });
    }
    if (!body || typeof body !== 'object' || (body.decision !== 'approve' && body.decision !== 'deny')) {
      return send(res, 400, { error: 'bad request' });
    }
    if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') {
      return send(res, 400, { error: 'bad request' });
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : null;
    if (reason !== null && [...reason].length > 500) return send(res, 400, { error: 'bad request' });
    // Empty reason stays NULL (DB NULLIFs it); non-empty is sealed.
    const sealedReason = reason ? await seal(reason) : null;
    if (reason && sealedReason === null) return send(res, 502, { error: 'crypto failure' });

    const { rows } = await q(
      'SELECT document_id, requested_by, grantee, status FROM access_requests WHERE id = $1',
      [id],
    );
    const row = rows[0];
    if (!row) return send(res, 404, { error: 'not found' });
    const { rows: approvals } = await q(
      'SELECT approver, role FROM access_approvals WHERE request_id = $1',
      [id],
    );
    const err = decisionError(
      { username: req.me.username, accessLevel: req.me.accessLevel, securityOfficer: req.me.securityOfficer === true, superAdmin: req.me.superAdmin === true },
      { requestedBy: row.requested_by, grantee: row.grantee, status: row.status },
      approvals,
    );
    if (err) {
      if (err === 'self' || err === 'role') {
        return forbid(res, req.me, 'document', row.document_id, `access decision denied: ${err}`);
      }
      return send(res, 409, { error: 'conflict' });
    }

    let r;
    try {
      ({ rows: [r] } = await q(
        'SELECT decide_access_request($1, $2::bigint, $3, $4) AS r',
        [req.me.username, id, body.decision, sealedReason],
      ));
    } catch (e) {
      return dbError(req, res, e, 'document', row.document_id, 'access decision denied');
    }
    return send(res, 200, { id: String(r.r.requestId), status: r.r.status, granted: r.r.granted === true });
  }

  return { list, revoke, users, requests, createRequest, decide };
}
