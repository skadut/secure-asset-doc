import http from 'node:http';
import { post as cryptoPost } from './crypto-client.mjs';

import pg from 'pg';
import { record, ownSnapshot, validateRemote, cryptoLog, makeTrafficRoutes, startHistoryWriter } from './traffic.mjs';
import { sanitizeName, ALLOWED_MIME, checkMagic, decodeFile, contentDispositionInline, MAX_BODY } from './uploads.mjs';
import { INTEGRITY_ERROR } from './protection.mjs';
import { canReadLevel, can, createLoginLimiter, checkWriteRequest, parseAllowedOrigins } from './auth.mjs';
import { lookupSession } from './session.mjs';
import { filterGrc } from './grc-filter.mjs';
import { isToken, maskedPart, maskPattern } from './tokens.mjs';
import { reveal, conceal } from './reveal.mjs';
import { truncate, maskCell, quoteIdent, clampLimit, clampOffset, resolveTable, buildSelectSql } from './dbview.mjs';
import { makeAuthRoutes } from './auth-routes.mjs';
import { makeAuditPurgeRoutes } from './audit-purge.mjs';
import { makeGrantRoutes } from './grants.mjs';
import { makeLevelRoutes } from './levels.mjs';
import { makeDeriveRoutes } from './derive.mjs';
import { makeViewerRoutes, validate } from './viewer.mjs';
import { makeDashboardRoutes } from './dashboard.mjs';
import { makeControlRoutes } from './controls.mjs';
import { matchRoute } from './router.mjs';
import { makeDocUploadRoutes } from './doc-upload.mjs';
import { makeAssetRoutes } from './asset-manage.mjs';

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 5,
});
pool.on('error', (err) => console.error(err.message));

// Records backend->db edge. Failed = query threw.
async function dbq(...args) {
  const t0 = performance.now();
  let failed = false;
  try {
    return await pool.query(...args);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    record('backend', 'db', { failed, ms: performance.now() - t0 });
  }
}

// Unrecorded health probe: dashboard polling must not inflate db edge.
async function dbUp() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// Records backend->crypto-service edge. Failed = non-200, network/timeout, or missing field.
async function cryptoCall(path, body, field) {
  const t0 = performance.now();
  let failed = true;
  try {
    const r = await cryptoPost(path, body, 10000);
    if (r.status !== 200) return { status: r.status === 503 ? 503 : 502 };
    const value = r.json?.[field];
    if (typeof value !== 'string' && typeof value !== 'boolean') return { status: 502 };
    failed = false;
    return { value };
  } catch {
    return { status: 502 };
  } finally {
    record('backend', 'crypto-service', { failed, ms: performance.now() - t0 });
  }
}

// Batch shape {<key>:[{Text}]} -> string[]. Any failure -> null (caller fails closed). Records edge like cryptoCall.
async function cryptoTexts(path, body, key = 'Ciphertext') {
  const t0 = performance.now();
  let failed = true;
  try {
    const r = await cryptoPost(path, body, 10000);
    if (r.status !== 200) return null;
    const arr = r.json?.[key];
    if (!Array.isArray(arr) || !arr.every((x) => typeof x?.text === 'string')) return null;
    failed = false;
    return arr.map((x) => x.text);
  } catch {
    return null;
  } finally {
    record('backend', 'crypto-service', { failed, ms: performance.now() - t0 });
  }
}

// Field crypto. Read side: batched, null on failure (reveal.mjs fails closed). Write side: one value, null on failure.
const fieldCrypto = {
  detokenize: (t) => cryptoTexts('/detokenize', { Masking: t.map((Text) => ({ Text })) }),
  unseal: (t) => cryptoTexts('/unseal', { Ciphertext: t.map((Text) => ({ Text })) }, 'Plaintext'),
};
async function sealText(v) {
  const r = await cryptoTexts('/seal', { Plaintext: [{ Text: v }] });
  return r?.length === 1 && r[0].startsWith('skadut-t1:') ? r[0] : null;
}
async function tokenizeText(v) {
  const r = await cryptoTexts('/tokenize', { Masking: [{ Text: v, Format: maskPattern(v), Length: 0, Position: '' }] });
  return r?.length === 1 && isToken(r[0]) && !maskedPart(r[0]).includes(':') ? r[0] : null;
}

// Global token bucket for /api/traffic: 5 req/s, burst 5.
let tokens = 5;
let last = Date.now();
function takeToken() {
  const t = Date.now();
  tokens = Math.min(5, tokens + ((t - last) / 1000) * 5);
  last = t;
  if (tokens < 1) return false;
  tokens -= 1;
  return true;
}

// Upload token bucket: 2 req/s, burst 2.
let upTokens = 2;
let upLast = Date.now();
function takeUploadToken() {
  const t = Date.now();
  upTokens = Math.min(2, upTokens + ((t - upLast) / 1000) * 2);
  upLast = t;
  if (upTokens < 1) return false;
  upTokens -= 1;
  return true;
}

const SAFE_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const DOC_ID = /^DOC-\d{4}$/;
const VERSION = /^\d+\.\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const day = (d) => d.toISOString().slice(0, 10);
const instant = (d) => d.toISOString().replace(/\.000Z$/, 'Z');
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

// Collects body up to MAX_BODY. Over cap -> null; rest is drained without buffering.
// Not fully read within BODY_TIMEOUT_MS -> rejects with ETIMEDOUT. Timer cleared on every settle path.
const BODY_TIMEOUT_MS = 20000;
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(v);
    };
    const timer = setTimeout(() => finish(reject, Object.assign(new Error('body timeout'), { code: 'ETIMEDOUT' })), BODY_TIMEOUT_MS);
    req.on('data', (c) => {
      if (done) return;
      total += c.length;
      if (total > MAX_BODY) {
        chunks.length = 0;
        return finish(resolve, null);
      }
      chunks.push(c);
    });
    req.on('end', () => finish(resolve, Buffer.concat(chunks)));
    req.on('error', (err) => finish(reject, err));
  });
}

// In-flight POST /api/uploads handlers. Cap checked before body read; decremented in finally.
const MAX_INFLIGHT = 3;
let inFlight = 0;

const limiter = createLoginLimiter();
const APP_ORIGINS = parseAllowedOrigins(process.env.APP_ORIGINS);
const authRoutes = makeAuthRoutes({ q: dbq, send, readRaw: readBody, limiter });

async function grc() {
  const [a, d, v, c, ev, l, e] = await Promise.all([
    dbq('SELECT id, name, type, site, sector, purdue_level, zone, vendor, model, firmware, ip_address, criticality, owner, last_reviewed, status FROM assets ORDER BY id'),
    dbq('SELECT id, title, type, tlp, status, owner, approver, next_review FROM documents ORDER BY id'),
    // ponytail: version sort is lexical; fine for single-digit parts, use numeric sort when minor reaches 10+
    dbq('SELECT document_id, version, date, author, summary, approved_by, file_name, mime_type, (content_base64 IS NOT NULL OR content_ciphertext IS NOT NULL) AS has_file FROM document_versions ORDER BY document_id, version DESC'),
    dbq("SELECT id, fn, category, category_name, outcome FROM csf_subcategories ORDER BY array_position(ARRAY['GV','ID','PR','DE','RS','RC']::text[], fn), id"),
    dbq('SELECT subcategory_id, document_id, asset_id, note FROM evidence_links ORDER BY id'),
    dbq('SELECT asset_id, document_id FROM asset_document_links ORDER BY asset_id, document_id'),
    // ponytail: audit view capped at 5000 newest events; add pagination when older history is needed.
    dbq('SELECT * FROM (SELECT id, at, actor, action, object_type, object_id, summary, changes FROM audit_events ORDER BY id DESC LIMIT 5000) t ORDER BY id'),
  ]);

  const versionsByDoc = new Map();
  for (const r of v.rows) {
    const list = versionsByDoc.get(r.document_id) ?? [];
    list.push(clean({
      version: r.version,
      date: day(r.date),
      author: r.author,
      summary: r.summary,
      approvedBy: r.approved_by,
      file: r.has_file ? { name: r.file_name, mime: r.mime_type, url: `/api/files/${r.document_id}/${r.version}` } : undefined,
    }));
    versionsByDoc.set(r.document_id, list);
  }

  // Additive UI data. Missing table (older DB) degrades to an empty list instead of failing /api/grc.
  const ctl = await dbq('SELECT id, family, name, implementation, location FROM nist_controls ORDER BY id').catch(() => ({ rows: [] }));

  return {
    controls: ctl.rows.map((r) => ({
      id: r.id,
      family: r.family,
      name: r.name,
      implementation: r.implementation,
      location: r.location,
    })),
    assets: a.rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      site: r.site,
      sector: r.sector,
      purdueLevel: r.purdue_level,
      zone: r.zone,
      vendor: r.vendor,
      model: r.model,
      firmware: r.firmware,
      ipAddress: r.ip_address,
      criticality: r.criticality,
      owner: r.owner,
      lastReviewed: day(r.last_reviewed),
      status: r.status,
    })),
    documents: d.rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      tlp: r.tlp,
      status: r.status,
      owner: r.owner,
      approver: r.approver,
      nextReview: day(r.next_review),
      versions: versionsByDoc.get(r.id) ?? [],
    })),
    csfSubcategories: c.rows.map((r) => ({
      id: r.id,
      fn: r.fn,
      category: r.category,
      categoryName: r.category_name,
      outcome: r.outcome,
    })),
    evidenceLinks: ev.rows.map((r) => clean({
      subcategoryId: r.subcategory_id,
      documentId: r.document_id,
      assetId: r.asset_id,
      note: r.note,
    })),
    assetDocLinks: l.rows.map((r) => ({ assetId: r.asset_id, documentId: r.document_id })),
    auditEvents: e.rows.map((r) => clean({
      id: r.id,
      at: instant(r.at),
      actor: r.actor,
      action: r.action,
      objectType: r.object_type,
      objectId: r.object_id,
      summary: r.summary,
      changes: r.changes,
    })),
  };
}

const cryptoErr = (status) => (status === 503 ? { status: 503, body: { error: 'crypto unavailable' } } : { status: 502, body: { error: 'crypto failure' } });

// Returns { value: base64 } to send, or { status, body } on failure. Never returns bytes on failure.
async function fileBase64(row) {
  if (row.protection === 'none') return { value: row.content_base64 };
  if (row.protection === 'integrity') {
    const v = await cryptoCall('/verifyhmac', { Message: row.content_base64, HMACstring: row.integrity_tag }, 'Value');
    if (v.status) return cryptoErr(v.status);
    return v.value === true ? { value: row.content_base64 } : { status: 500, body: { error: INTEGRITY_ERROR } };
  }
  if (row.protection === 'encrypted') {
    const c = await cryptoCall('/unsealfile', { Ciphertext: row.content_ciphertext }, 'Data');
    if (c.status) return cryptoErr(c.status);
    const v = await cryptoCall('/verifyhmac', { Message: c.value, HMACstring: row.integrity_tag }, 'Value');
    if (v.status) return cryptoErr(v.status);
    return v.value === true ? { value: c.value } : { status: 500, body: { error: INTEGRITY_ERROR } };
  }
  return { status: 500, body: { error: 'unknown protection' } };
}

// Active grant (not revoked, not expired) for one doc.
async function hasGrant(userId, documentId) {
  const r = await dbq(
    'SELECT 1 FROM document_access_grants WHERE document_id = $1 AND user_id = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())',
    [documentId, userId],
  );
  return r.rows.length > 0;
}

// Doc ids with active grant for user.
async function grantedIds(userId) {
  const r = await dbq(
    'SELECT document_id FROM document_access_grants WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())',
    [userId],
  );
  return new Set(r.rows.map((x) => x.document_id));
}

// Active grantees per document, for the security-officer listing. Map(docId -> [username]).
async function activeGrantees() {
  const r = await dbq(
    `SELECT g.document_id, u.username
       FROM document_access_grants g JOIN users u ON u.id = g.user_id
      WHERE g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
      ORDER BY g.document_id, u.username`,
  );
  const m = new Map();
  for (const row of r.rows) {
    const list = m.get(row.document_id) ?? [];
    list.push(row.username);
    m.set(row.document_id, list);
  }
  return m;
}

// Reveals protected fields of readable docs (title, version summary, file name) and assets (model, firmware, ip).
// One /detokenize and one /unseal batch. Fail closed: maskedPart for tokens, '***' for sealed text.
async function revealTokens(documents, assets = []) {
  const targets = [];
  for (const d of documents) {
    targets.push([d, 'title']);
    for (const v of d.versions) {
      targets.push([v, 'summary']);
      if (v.file) targets.push([v.file, 'name']);
    }
  }
  for (const a of assets) targets.push([a, 'model'], [a, 'firmware'], [a, 'ipAddress']);
  await reveal(targets, fieldCrypto);
}

// ponytail: whole file buffered in memory (max 25 MiB); stream from object storage when files grow
async function file(res, me, documentId, version, viewerSession) {
  if (viewerSession) {
    const ok = await validate(dbq, { sessionId: viewerSession, userId: me.id, documentId });
    if (!ok) return send(res, 403, { error: 'forbidden' });
  }
  const r = await dbq(
    'SELECT v.file_name, v.mime_type, v.protection, v.content_base64, v.content_ciphertext, v.integrity_tag, d.tlp FROM document_versions v JOIN documents d ON d.id = v.document_id WHERE v.document_id = $1 AND v.version = $2 AND (v.content_base64 IS NOT NULL OR v.content_ciphertext IS NOT NULL)',
    [documentId, version],
  );
  const row = r.rows[0];
  // Above ceiling and no grant: 404, not 403, so existence is not revealed.
  if (!row || !(canReadLevel(me.accessLevel, row.tlp) || (await hasGrant(me.id, documentId)))) {
    return send(res, 404, { error: 'not found' });
  }
  const got = await fileBase64(row);
  if (got.status) return send(res, got.status, got.body);
  let name = row.file_name || 'download';
  if (isToken(name)) {
    const plain = await cryptoTexts('/detokenize', { Masking: [{ Text: name }] });
    name = plain && plain.length === 1 ? plain[0] : maskedPart(name);
  }
  const body = Buffer.from(got.value, 'base64');
  got.value = null;
  res.once('close', () => body.fill(0));
  res.writeHead(200, {
    'Content-Type': SAFE_MIME.has(row.mime_type) ? row.mime_type : 'application/octet-stream',
    'Content-Length': body.length,
    'Content-Disposition': `inline; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// Startup only, not per request. Never throws.
async function warnUnprotected() {
  try {
    const r = await dbq(
      "SELECT count(*)::int AS n FROM document_versions WHERE protection <> 'encrypted' AND (content_base64 IS NOT NULL OR content_ciphertext IS NOT NULL)",
    );
    const n = r.rows[0].n;
    if (n > 0) console.warn(`WARN: ${n} document versions not sealed; run db/scripts/protect-documents.mjs`);
  } catch {
    console.warn('WARN: protection check skipped');
  }
}

async function uploadCreate(req, res, me) {
  const ct = (req.headers['content-type'] || '').trim().toLowerCase();
  if (ct !== 'application/json' && ct !== 'application/json; charset=utf-8') {
    return send(res, 415, { error: 'unsupported media type' });
  }
  const len = Number(req.headers['content-length']);
  if (Number.isFinite(len) && len > MAX_BODY) return send(res, 413, { error: 'too large' }, { Connection: 'close' });
  if (!takeUploadToken()) return send(res, 429, { error: 'rate_limited' });
  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    if (err.code === 'ETIMEDOUT') return send(res, 408, { error: 'timeout' }, { Connection: 'close' });
    throw err;
  }
  if (raw === null) return send(res, 413, { error: 'too large' }, { Connection: 'close' });
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return send(res, 400, { error: 'bad request' });
  }
  if (!body || typeof body !== 'object' || typeof body.name !== 'string' || typeof body.mime !== 'string' || typeof body.data !== 'string') {
    return send(res, 400, { error: 'bad request' });
  }
  const name = sanitizeName(body.name);
  if (name === null || !ALLOWED_MIME.includes(body.mime)) return send(res, 400, { error: 'bad request' });
  const d = decodeFile(body.data);
  if (d.status === 413) return send(res, 413, { error: 'too large' });
  if (d.status) return send(res, 400, { error: 'bad request' });
  const buf = d.buf;
  try {
    if (!checkMagic(body.mime, buf)) return send(res, 400, { error: 'bad request' });
    const c = await cryptoCall('/sealfile', { Data: body.data }, 'Ciphertext');
    if (c.status) return send(res, c.status, c.status === 503 ? { error: 'unavailable' } : { error: 'crypto unavailable' });
    const token = await tokenizeText(name);
    if (token === null) return send(res, 502, { error: 'crypto failure' });
    const r = await dbq(
      'INSERT INTO uploaded_files (name, mime, size_bytes, ciphertext, uploaded_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, mime, size_bytes, uploaded_at',
      [token, body.mime, buf.length, c.value, me.id],
    );
    const u = r.rows[0];
    return send(res, 201, { id: u.id, name, mime: u.mime, size: u.size_bytes, uploadedAt: u.uploaded_at.toISOString(), uploadedBy: me.username });
  } finally {
    buf.fill(0);
  }
}

async function uploadList(res) {
  const r = await dbq(
    'SELECT f.id, f.name, f.mime, f.size_bytes, f.uploaded_at, u.username AS uploaded_by FROM uploaded_files f LEFT JOIN users u ON u.id = f.uploaded_by ORDER BY f.uploaded_at DESC LIMIT 50',
  );
  await reveal(r.rows.map((u) => [u, 'name']), fieldCrypto);
  return send(res, 200, r.rows.map((u) => ({ id: u.id, name: u.name, mime: u.mime, size: u.size_bytes, uploadedAt: u.uploaded_at.toISOString(), uploadedBy: u.uploaded_by ?? null })));
}

async function uploadContent(res, id) {
  if (!UUID.test(id)) return send(res, 400, { error: 'bad request' });
  const r = await dbq('SELECT ciphertext, name, mime FROM uploaded_files WHERE id = $1', [id]);
  const row = r.rows[0];
  if (!row) return send(res, 404, { error: 'not found' });
  const c = await cryptoCall('/unsealfile', { Ciphertext: row.ciphertext }, 'Data');
  if (c.status) return send(res, c.status, c.status === 503 ? { error: 'unavailable' } : { error: 'crypto unavailable' });
  await reveal([[row, 'name']], fieldCrypto);
  const buf = Buffer.from(c.value, 'base64');
  res.once('close', () => buf.fill(0));
  try {
    res.writeHead(200, {
      'Content-Type': row.mime,
      'Content-Length': buf.length,
      'Content-Disposition': contentDispositionInline(row.name),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  } catch (err) {
    buf.fill(0);
    throw err;
  }
}

// Merges own snapshot with crypto-service's /internal/traffic. Fetch/parse failure -> down, no crypto edges.
async function traffic(superAdmin) {
  const down = [];
  const edges = ownSnapshot(10);
  try {
    const r = await fetch('http://crypto-api:2797/internal/traffic', { signal: AbortSignal.timeout(1000) });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const json = await r.json();
    if (!Array.isArray(json)) throw new Error('bad shape');
    edges.push(...validateRemote(json));
  } catch {
    down.push('crypto-service');
  }
  if (!(await dbUp())) down.push('db');
  return { ts: Math.floor(Date.now() / 1000), edges, down, ...(superAdmin ? { cryptoCalls: cryptoLog(50) } : {}) };
}

// Audit a 403 with actor = username. Failure to audit never changes the response.
async function deny(me, objectType, objectId, summary) {
  try {
    await dbq('SELECT log_access_denied($1, $2, $3, $4)', [me.username, objectType, objectId, summary]);
  } catch (err) {
    console.error('audit failed: ' + err.message);
  }
}
const forbid = async (res, me, objectType, objectId, summary) => {
  await deny(me, objectType, objectId, summary);
  return send(res, 403, { error: 'forbidden' });
};

const auditPurge = makeAuditPurgeRoutes({ q: dbq, send, readRaw: readBody, forbid });
const fieldDeps = { seal: sealText, reveal: (targets) => reveal(targets, fieldCrypto) };
const grantRoutes = makeGrantRoutes({ q: dbq, send, readRaw: readBody, forbid, ...fieldDeps });
const levelRoutes = makeLevelRoutes({ q: dbq, send, readRaw: readBody, forbid, ...fieldDeps });
const deriveRoutes = makeDeriveRoutes({ q: dbq, send, readRaw: readBody, forbid, hasGrant, grantedIds, revealTokens, seal: sealText });
const viewerRoutes = makeViewerRoutes({ q: dbq, send, forbid, canReadLevel, hasGrant });
const viewerPluralRoutes = viewerRoutes;
const dashboardRoutes = makeDashboardRoutes({ q: dbq, send, forbid });
const controlRoutes = makeControlRoutes({ q: dbq, send });
const trafficRoutes = makeTrafficRoutes({ q: dbq, send, forbid });
const connect = () => pool.connect();
const docUploadRoutes = makeDocUploadRoutes({ q: dbq, connect, send, readRaw: readBody, forbid, cryptoCall, sealText, tokenizeText, takeUploadToken, MAX_BODY });
const assetRoutes = makeAssetRoutes({ q: dbq, connect, send, readRaw: readBody, forbid, sealText, tokenizeText, cryptoCall });

// Database view (superAdmin only, read-only transactions). Long strings cut by truncate().
async function dbviewTables(client) {
  const names = (await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)).rows.map((r) => r.table_name);
  const cols = (await client.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)).rows;
  const byTable = new Map(names.map((t) => [t, []]));
  for (const c of cols) byTable.get(c.table_name)?.push({ name: c.column_name, dataType: c.data_type });
  return byTable;
}
const dbviewCol = (c) => ({ name: c.name, type: c.dataType });
function dbviewCell(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : String(v);
  return v; // string/number/boolean as-is; pg-parsed json/array values are already JSON-safe
}
async function dbviewReadOnly(res, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const out = await fn(client);
    await client.query('COMMIT');
    return send(res, out.status, out.body);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Route table. pub: no session. Method check happens in matchRoute (405 + Allow).
// next: CRUD routes (documents, assets, users) added here in the next step.
const ROUTES = [
  { re: /^\/api\/health$/, methods: ['GET'], pub: true, run: async (req, res) => {
    if (!(await dbUp())) return send(res, 503, { error: 'unavailable' });
    return send(res, 200, { ok: true });
  } },
  { re: /^\/api\/login$/, methods: ['POST'], pub: true, run: (req, res) => authRoutes.login(req, res) },
  { re: /^\/api\/auth\/login$/, methods: ['POST'], pub: true, run: (req, res) => authRoutes.login(req, res) },
  { re: /^\/api\/auth\/otp$/, methods: ['POST'], pub: true, run: (req, res) => authRoutes.otp(req, res) },
  { re: /^\/api\/auth\/device-check$/, methods: ['GET'], pub: true, run: (req, res) => authRoutes.deviceCheck(req, res) },
  { re: /^\/api\/logout$/, methods: ['POST'], run: (req, res) => authRoutes.logout(req, res) },
  { re: /^\/api\/me$/, methods: ['GET'], run: (req, res) => authRoutes.me(req, res) },
  { re: /^\/api\/me\/preferences$/, methods: ['GET'], run: (req, res) => authRoutes.getPreferences(req, res) },
  { re: /^\/api\/me\/preferences$/, methods: ['PATCH'], run: (req, res) => authRoutes.patchPreferences(req, res) },
  { re: /^\/api\/ranks$/, methods: ['GET'], run: (req, res) => authRoutes.ranks(req, res) },
  { re: /^\/api\/traffic$/, methods: ['GET'], run: async (req, res) => {
    if (req.me?.superAdmin !== true) return forbid(res, req.me, 'traffic', 'view', 'traffic view denied');
    if (!takeToken()) return send(res, 429, { error: 'rate_limited' });
    return send(res, 200, await traffic(req.me?.superAdmin === true));
  } },
  { re: /^\/api\/traffic\/history$/, methods: ['GET'], run: (req, res) => trafficRoutes.history(req, res) },
  { re: /^\/api\/dashboard\/summary$/, methods: ['GET'], run: (req, res) => dashboardRoutes.summary(req, res) },
  { re: /^\/api\/grants\/expiring$/, methods: ['GET'], run: (req, res) => dashboardRoutes.expiringGrants(req, res) },
  { re: /^\/api\/controls$/, methods: ['GET'], run: (req, res) => controlRoutes.list(req, res) },
  { re: /^\/api\/grc$/, methods: ['GET'], run: async (req, res) => {
    const so = req.me.securityOfficer === true;
    const out = filterGrc(await grc(), {
      accessLevel: req.me.accessLevel,
      grantedIds: await grantedIds(req.me.id),
      securityOfficer: so,
      granteesByDoc: so ? await activeGrantees() : undefined,
      superAdmin: req.me.superAdmin === true,
    });
    const assetRead = can(req.me.rankCode, req.me.accessLevel, so, req.me.superAdmin === true).asset.r;
    if (!assetRead) conceal(out.assets.flatMap((a) => [[a, 'model'], [a, 'firmware'], [a, 'ipAddress']]));
    await revealTokens(out.documents.filter((d) => d.tokenOnly !== true), assetRead ? out.assets : []);
    return send(res, 200, out);
  } },
  { re: /^\/api\/uploads$/, methods: ['GET', 'POST'], run: async (req, res) => {
    if (req.method === 'POST') {
      if (inFlight >= MAX_INFLIGHT) return send(res, 429, { error: 'rate_limited' });
      inFlight++;
      try {
        return await uploadCreate(req, res, req.me);
      } finally {
        inFlight--;
      }
    }
    if (!can(req.me.rankCode).upload.r) return forbid(res, req.me, 'upload', 'list', 'upload list denied');
    return uploadList(res);
  } },
  { re: /^\/api\/uploads\/([^/]+)\/content$/, methods: ['GET'], run: async (req, res, [id]) => {
    if (!can(req.me.rankCode).upload.r) return forbid(res, req.me, 'upload', id, 'upload content denied');
    return uploadContent(res, id);
  } },
  { re: /^\/api\/files\/([^/]+)\/([^/]+)$/, methods: ['GET'], run: async (req, res, [doc, ver]) => {
    if (!DOC_ID.test(doc) || !VERSION.test(ver)) return send(res, 400, { error: 'bad request' });
    const viewerSession = new URL(req.url, 'http://localhost').searchParams.get('viewerSession') ?? undefined;
    return file(res, req.me, doc, ver, viewerSession ?? undefined);
  } },
  { re: /^\/api\/documents$/, methods: ['POST'], run: async (req, res) => {
    if (inFlight >= MAX_INFLIGHT) return send(res, 429, { error: 'rate_limited' });
    inFlight++;
    try {
      return await docUploadRoutes.create(req, res);
    } finally {
      inFlight--;
    }
  } },
  { re: /^\/api\/assets$/, methods: ['POST'], run: (req, res) => assetRoutes.create(req, res) },
  { re: /^\/api\/assets\/([^/]+)$/, methods: ['PATCH'], run: (req, res, [id]) => assetRoutes.patch(req, res, id) },
  { re: /^\/api\/assets\/([^/]+)$/, methods: ['DELETE'], run: (req, res, [id]) => assetRoutes.remove(req, res, id) },
  { re: /^\/api\/audit\/purge-preview$/, methods: ['GET'], run: (req, res) => auditPurge.preview(req, res) },
  { re: /^\/api\/audit\/purge$/, methods: ['POST'], run: (req, res) => auditPurge.purge(req, res) },
  { re: /^\/api\/documents\/([^/]+)\/viewer-session$/, methods: ['POST'], run: (req, res, [id]) => viewerRoutes.create(req, res, id) },
  { re: /^\/api\/documents\/([^/]+)\/viewer-sessions$/, methods: ['POST'], run: (req, res, [id]) => viewerPluralRoutes.create(req, res, id) },
  { re: /^\/api\/viewer-sessions\/([^/]+)$/, methods: ['GET'], run: (req, res, [id]) => viewerRoutes.validate(req, res, id) },
  { re: /^\/api\/viewer-sessions\/([^/]+)$/, methods: ['DELETE'], run: (req, res, [id]) => viewerRoutes.destroy(req, res, id) },
  { re: /^\/api\/users$/, methods: ['GET'], run: (req, res) => grantRoutes.users(req, res) },
  { re: /^\/api\/access-requests$/, methods: ['GET'], run: (req, res) => grantRoutes.requests(req, res) },
  { re: /^\/api\/access-requests\/([^/]+)\/decision$/, methods: ['POST'], run: (req, res, [id]) => grantRoutes.decide(req, res, id) },
  { re: /^\/api\/documents\/([^/]+)\/access-requests$/, methods: ['POST'], run: (req, res, [id]) => grantRoutes.createRequest(req, res, id) },
  { re: /^\/api\/documents\/([^/]+)\/grants$/, methods: ['GET'], run: (req, res, [id]) => grantRoutes.list(req, res, id) },
  { re: /^\/api\/documents\/([^/]+)\/grants\/([^/]+)$/, methods: ['DELETE'], run: (req, res, [id, username]) => grantRoutes.revoke(req, res, id, username) },
  { re: /^\/api\/users\/([^/]+)\/level-requests$/, methods: ['POST'], run: (req, res, [username]) => levelRoutes.requestRaise(req, res, username) },
  { re: /^\/api\/level-requests$/, methods: ['GET'], run: (req, res) => levelRoutes.listRequests(req, res) },
  { re: /^\/api\/level-requests\/([^/]+)\/decision$/, methods: ['POST'], run: (req, res, [id]) => levelRoutes.decideRaise(req, res, id) },
  { re: /^\/api\/db\/tables$/, methods: ['GET'], run: async (req, res) => {
    if (req.me.superAdmin !== true) return forbid(res, req.me, 'database', 'tables', 'database view denied');
    return dbviewReadOnly(res, async (client) => {
      const byTable = await dbviewTables(client);
      const tables = [];
      for (const [name, columns] of byTable) {
        const n = (await client.query(`SELECT count(*)::int AS n FROM public.${quoteIdent(name)}`)).rows[0].n;
        tables.push({ name, rowCount: n, columns: columns.map(dbviewCol) });
      }
      return { status: 200, body: { tables } };
    });
  } },
  { re: /^\/api\/db\/tables\/([^/]+)$/, methods: ['GET'], run: async (req, res, [raw]) => {
    let name;
    try { name = decodeURIComponent(raw); } catch { return send(res, 404, { error: 'not found' }); }
    if (req.me.superAdmin !== true) return forbid(res, req.me, 'database', name, 'database view denied');
    const sp = new URL(req.url, 'http://localhost').searchParams;
    const limit = clampLimit(sp.get('limit'));
    const offset = clampOffset(sp.get('offset'));
    return dbviewReadOnly(res, async (client) => {
      const byTable = await dbviewTables(client);
      const table = resolveTable(name, [...byTable.keys()]);
      if (table === null) return { status: 404, body: { error: 'not found' } };
      const columns = byTable.get(table);
      const pk = (await client.query(
        `SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY' ORDER BY kcu.ordinal_position LIMIT 1`,
        [table],
      )).rows[0]?.column_name ?? null;
      const total = (await client.query(`SELECT count(*)::int AS n FROM public.${quoteIdent(table)}`)).rows[0].n;
      const sel = await client.query(buildSelectSql(table, columns, pk, limit, offset), [limit, offset]);
      const rows = sel.rows.map((r) => columns.map((c) => truncate(maskCell(c.name, dbviewCell(r[c.name])))));
      return { status: 200, body: { table, columns: columns.map(dbviewCol), rows, total, limit, offset } };
    });
  } },
  ...deriveRoutes,
];

const server = http.createServer(async (req, res) => {
  const start = performance.now();
  res.on('finish', () => {
    const p = req.url.split('?')[0];
    if (p !== '/api/traffic' && p !== '/api/traffic/history' && p !== '/api/health') {
      record('frontend', 'backend', { failed: res.statusCode >= 500, ms: performance.now() - start });
    }
  });
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (!pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    const hit = matchRoute(ROUTES, req.method, pathname);
    if (!hit) return send(res, 404, { error: 'not found' });
    if (hit.status === 405) return send(res, 405, { error: 'method not allowed' }, { Allow: hit.allow.join(', ') });
    const { route, params } = hit;
    if (!route.pub) {
      req.me = await lookupSession(dbq, req.headers.cookie);
      if (!req.me) return send(res, 401, { error: 'unauthenticated' });
      const csrf = checkWriteRequest(req.method, req.headers, APP_ORIGINS);
      if (csrf) {
        if (csrf.status === 403) await deny(req.me, 'user', req.me.username, 'csrf origin rejected');
        return send(res, csrf.status, { error: csrf.error });
      }
    } else {
      const csrf = checkWriteRequest(req.method, req.headers, APP_ORIGINS);
      if (csrf) return send(res, csrf.status, { error: csrf.error });
    }
    return await route.run(req, res, params);
  } catch (err) {
    console.error(err.message);
    if (res.headersSent) res.end();
    else send(res, 500, { error: 'internal' });
  }
});

const historyWriter = startHistoryWriter(dbq);
process.once('SIGTERM', () => { historyWriter.stop(); server.close(); });
process.once('SIGINT', () => { historyWriter.stop(); server.close(); });
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => warnUnprotected());
