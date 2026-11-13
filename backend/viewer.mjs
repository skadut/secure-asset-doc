// Time-boxed viewer sessions for in-browser document viewing. Deps injected from server.mjs.
const DOC_ID = /^DOC-\d{4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tighter TLP -> shorter viewing window. Unknown TLP -> null (fail closed).
export function sessionLimitSeconds(tlp) {
  if (tlp === 'RED' || tlp === 'RED+STRICT') return 600;
  if (tlp === 'AMBER' || tlp === 'AMBER+STRICT') return 900;
  if (tlp === 'GREEN' || tlp === 'CLEAR') return 1800;
  return null;
}

// validate(q, session): check an unexpired session scoped to its user and document.
export async function validate(q, { sessionId, userId, documentId } = {}) {
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) return false;
  const { rows } = await q(
    'SELECT 1 FROM viewer_sessions WHERE id = $1 AND user_id = $2 AND document_id = $3 AND expires_at > now()',
    [sessionId, userId, documentId],
  );
  return rows.length > 0;
}
export function makeViewerRoutes({ q, send, forbid, canReadLevel, hasGrant }) {
  // Same ceiling as /api/files: level, or an active grant on top of it.
  const canView = async (me, documentId, tlp) =>
    canReadLevel(me.accessLevel, tlp) || (await hasGrant(me.id, documentId));

  async function create(req, res, id) {
    if (!DOC_ID.test(id)) return send(res, 400, { error: 'bad request' });
    const { rows } = await q('SELECT tlp FROM documents WHERE id = $1', [id]);
    const doc = rows[0];
    // 404 on both unknown and unreadable, so existence is not revealed.
    if (!doc || !(await canView(req.me, id, doc.tlp))) return send(res, 404, { error: 'not found' });
    const seconds = sessionLimitSeconds(doc.tlp);
    if (seconds === null) return send(res, 403, { error: 'forbidden' });
    const r = await q(
      "INSERT INTO viewer_sessions (user_id, document_id, expires_at) VALUES ($1, $2, now() + ($3::int * interval '1 second')) RETURNING id, document_id, created_at, expires_at",
      [req.me.id, id, seconds],
    );
    const s = r.rows[0];
    const issuedAt = s.created_at.toISOString();
    return send(res, 201, {
      sessionId: s.id,
      documentId: s.document_id,
      issuedAt,
      expiresAt: s.expires_at.toISOString(),
      ttlSeconds: seconds,
      id: s.id,
      createdAt: issuedAt,
    });
  }

  async function validate(req, res, id) {
    if (!UUID.test(id)) return send(res, 404, { error: 'not found' });
    const { rows } = await q(
      'SELECT s.id, s.document_id, s.expires_at, d.tlp FROM viewer_sessions s JOIN documents d ON d.id = s.document_id WHERE s.id = $1 AND s.user_id = $2',
      [id, req.me.id],
    );
    const s = rows[0];
    if (!s) return send(res, 404, { error: 'not found' });
    if (new Date(s.expires_at).getTime() <= Date.now()) return send(res, 410, { error: 'expired' });
    if (!(await canView(req.me, s.document_id, s.tlp))) return send(res, 403, { error: 'forbidden' });
    return send(res, 200, { valid: true, id: s.id, documentId: s.document_id, expiresAt: new Date(s.expires_at).toISOString() });
  }

  async function destroy(req, res, id) {
    if (!UUID.test(id)) return send(res, 404, { error: 'not found' });
    const r = await q('DELETE FROM viewer_sessions WHERE id = $1 AND user_id = $2', [id, req.me.id]);
    if (!r.rowCount) return send(res, 404, { error: 'not found' });
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
  }

  return { create, validate, destroy };
}
