// Derive child document routes (access level 5 only) + pure validation. Deps injected from server.mjs (DB query, send, body reader, forbid, grant/reveal helpers).
import { TLP_ORDER, canReadLevel } from './auth.mjs';

const DOC_ID = /^DOC-\d{4}$/;
const JSON_CT = /^application\/json(\s*;\s*charset=utf-8)?$/i;
const MAX_BODY = 8192;

// Child TLP must be strictly less restrictive (lower index) than parent. Unknown on either side -> false.
export function isLowerTlp(child, parent) {
  const c = TLP_ORDER.indexOf(child);
  const p = TLP_ORDER.indexOf(parent);
  return c !== -1 && p !== -1 && c < p;
}

// derived_from id is shown only if viewer can read parent (level) or holds an active grant on it (granted = grantedIds set). Else null.
export function visibleDerivedFrom(accessLevel, parent, granted) {
  if (!parent) return null;
  return canReadLevel(accessLevel, parent.tlp) || granted.has(parent.id) ? parent.id : null;
}

const fail = (error) => ({ ok: false, error });
// Code points, matching how the DB counts characters.
const len = (s) => [...s].length;

export function validateDerive(o, parentTlp) {
  const { title, tlp, summary } = o ?? {};
  if (typeof title !== 'string') return fail('title must be a string');
  const t = title.trim();
  if (len(t) < 1 || len(t) > 120) return fail('title must be 1-120 chars');
  if (!TLP_ORDER.includes(tlp)) return fail('invalid tlp');
  if (!isLowerTlp(tlp, parentTlp)) return fail('tlp must be lower than parent');
  if (typeof summary !== 'string') return fail('summary must be a string');
  const s = summary.trim();
  if (len(s) < 1 || len(s) > 4000) return fail('summary must be 1-4000 chars');
  return { ok: true, value: { title: t, tlp, summary: s } };
}

const DERIVE_RE = /^\/api\/documents\/([^/]+)\/derive$/;
const DERIVED_RE = /^\/api\/documents\/([^/]+)\/derived$/;

export function makeDeriveRoutes({ q, send, readRaw, forbid, hasGrant, grantedIds, revealTokens, seal }) {
  const isAdmin = (me) => me.accessLevel === 5;

  // SQLSTATE from derive_document -> HTTP. Unknown -> rethrow (500).
  function dbError(res, err) {
    if (err.code === '42501') return send(res, 403, { error: 'forbidden' });
    if (err.code === 'P0002') return send(res, 404, { error: 'not found' });
    if (err.code === '22023') return send(res, 400, { error: 'bad request' });
    throw err;
  }

  async function derive(req, res, id) {
    if (!isAdmin(req.me)) return forbid(res, req.me, 'document', id, 'derive api denied');
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
    const { rows } = await q('SELECT tlp FROM documents WHERE id = $1', [id]);
    const parent = rows[0];
    if (!parent || !(canReadLevel(req.me.accessLevel, parent.tlp) || (await hasGrant(req.me.id, id)))) {
      return send(res, 404, { error: 'not found' });
    }
    const v = validateDerive(body, parent.tlp);
    if (!v.ok) return send(res, 400, { error: v.error });
    // Non-CLEAR summary stored sealed (skadut-t1:...); CLEAR stays plain.
    const summary = v.value.tlp === 'CLEAR' ? v.value.summary : await seal(v.value.summary);
    if (summary === null) return send(res, 502, { error: 'crypto failure' });
    let r;
    try {
      ({ rows: [r] } = await q('SELECT derive_document($1, $2, $3, $4, $5) AS r', [req.me.username, id, v.value.title, v.value.tlp, summary]));
    } catch (err) {
      return dbError(res, err);
    }
    return send(res, 201, { documentId: r.r.documentId, auditId: r.r.auditId });
  }

  async function derived(req, res, id) {
    if (!DOC_ID.test(id)) return send(res, 400, { error: 'bad request' });
    const { rows } = await q('SELECT d.tlp, d.derived_from, p.tlp AS up_tlp FROM documents d LEFT JOIN documents p ON p.id = d.derived_from WHERE d.id = $1', [id]);
    const parent = rows[0];
    if (!parent || !(canReadLevel(req.me.accessLevel, parent.tlp) || (await hasGrant(req.me.id, id)))) {
      return send(res, 404, { error: 'not found' });
    }
    const { rows: kids } = await q('SELECT id, title, tlp FROM documents WHERE derived_from = $1 ORDER BY id', [id]);
    const granted = await grantedIds(req.me.id);
    const children = kids
      .filter((c) => canReadLevel(req.me.accessLevel, c.tlp) || granted.has(c.id))
      .map((c) => ({ id: c.id, title: c.title, tlp: c.tlp, versions: [] }));
    await revealTokens(children);
    return send(res, 200, {
      derivedFrom: visibleDerivedFrom(req.me.accessLevel, parent.derived_from ? { id: parent.derived_from, tlp: parent.up_tlp } : null, granted),
      children: children.map(({ id: cid, title, tlp }) => ({ id: cid, title, tlp })),
    });
  }

  return [
    { re: DERIVE_RE, methods: ['POST'], run: (req, res, [id]) => derive(req, res, id) },
    { re: DERIVED_RE, methods: ['GET'], run: (req, res, [id]) => derived(req, res, id) },
  ];
}
