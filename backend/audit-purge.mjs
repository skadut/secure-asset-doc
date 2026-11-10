// PATI-only audit purge: preview count and purge app audit_events older than a UTC date. Deps injected from server.mjs.
import { can } from './auth.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const JSON_CT = /^application\/json(\s*;\s*charset=utf-8)?$/i;
const MAX_BODY = 4096;

// Real UTC calendar date, not after today. Returns ISO 00:00:00Z string or null.
function parseBefore(s) {
  if (typeof s !== 'string' || !DATE.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const iso = new Date(t).toISOString();
  if (iso.slice(0, 10) !== s) return null;
  if (s > new Date().toISOString().slice(0, 10)) return null;
  return iso;
}

export function makeAuditPurgeRoutes({ q, send, readRaw, forbid }) {
  async function preview(req, res) {
    if (!can(req.me.rankCode).audit.purge) return forbid(res, req.me, 'audit', 'purge', 'audit purge denied');
    const before = parseBefore(new URL(req.url, 'http://localhost').searchParams.get('before'));
    if (!before) return send(res, 400, { error: 'bad request' });
    const { rows } = await q(
      "SELECT count(*)::int AS count, min(at) AS oldest FROM audit_events WHERE at < $1::timestamptz AND action <> 'purge'",
      [before],
    );
    const r = rows[0];
    return send(res, 200, { before, count: r.count, oldest: r.oldest ? r.oldest.toISOString() : null });
  }

  async function purge(req, res) {
    if (!can(req.me.rankCode).audit.purge) return forbid(res, req.me, 'audit', 'purge', 'audit purge denied');
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
    if (!body || typeof body !== 'object') return send(res, 400, { error: 'bad request' });
    const before = parseBefore(body.before);
    if (!before) return send(res, 400, { error: 'bad request' });
    if (body.confirm !== `PURGE AUDIT BEFORE ${body.before}`) return send(res, 400, { error: 'confirmation mismatch' });
    const { rows } = await q('SELECT purge_audit_events($1, $2::timestamptz) AS r', [req.me.username, before]);
    const { deleted, tombstoneId } = rows[0].r;
    return send(res, 200, { deleted, tombstoneId, before });
  }

  return { preview, purge };
}
