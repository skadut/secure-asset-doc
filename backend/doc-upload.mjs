// POST /api/documents: validated create with sealed file and protected fields. Deps injected from server.mjs.
import { authorize } from './auth.mjs';
import { validateDocBody, nextId } from './doc-create.mjs';
import { decodeFile } from './uploads.mjs';

const RETRIES = 3;

export function makeDocUploadRoutes({ q, connect, send, readRaw, forbid, cryptoCall, sealText, tokenizeText, takeUploadToken, MAX_BODY }) {
  const cryptoError = (status) =>
    status === 503 ? { status: 503, body: { error: 'unavailable' } } : { status: 502, body: { error: 'crypto failure' } };

  async function tx(fn) {
    for (let attempt = 1; ; attempt++) {
      const client = await connect();
      let released = false;
      try {
        await client.query('BEGIN');
        const out = await fn(client);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          released = true;
          client.release(rollbackError);
          throw err;
        }
        if (err.code === '23505' && attempt < RETRIES) continue;
        throw err;
      } finally {
        if (!released) client.release();
      }
    }
  }

  async function create(req, res) {
    const me = req.me;
    const ct = (req.headers['content-type'] || '').trim().toLowerCase();
    if (ct !== 'application/json' && ct !== 'application/json; charset=utf-8') {
      return send(res, 415, { error: 'unsupported media type' });
    }
    const len = Number(req.headers['content-length']);
    if (Number.isFinite(len) && len > MAX_BODY) return send(res, 413, { error: 'too large' }, { Connection: 'close' });
    if (!takeUploadToken()) return send(res, 429, { error: 'rate_limited' });
    let raw;
    try {
      raw = await readRaw(req);
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

    const v = validateDocBody(body);
    if (!v.ok) return send(res, v.status, { error: v.error });
    const doc = v.value;

    const ok = authorize(me.rankCode, 'document.c', { accessLevel: me.accessLevel, docTlp: doc.tlp, newTlp: doc.tlp });
    if (!ok) return forbid(res, me, 'document', 'new', 'document create denied');

    const c = await cryptoCall('/sealfile', { Data: doc.file.data }, 'Ciphertext');
    if (c.status) {
      const e = cryptoError(c.status);
      return send(res, e.status, e.body);
    }
    if (typeof c.value !== 'string' || !/^skadut-t1:d[0-9a-f]{16}:[A-Za-z0-9+/]+={0,2}$/.test(c.value)) {
      return send(res, 502, { error: 'crypto failure' });
    }
    const h = await cryptoCall('/hmac', { Message: doc.file.data }, 'Value');
    if (h.status) {
      const e = cryptoError(h.status);
      return send(res, e.status, e.body);
    }
    if (typeof h.value !== 'string' || !/^skadut-t1:d[0-9a-f]{16}:[A-Za-z0-9+/]+={0,2}$/.test(h.value)) {
      return send(res, 502, { error: 'crypto failure' });
    }

    const protect = doc.tlp !== 'CLEAR';
    let title = doc.title;
    let fileName = doc.file.name;
    let summary = doc.summary;
    if (protect) {
      title = await tokenizeText(doc.title);
      fileName = await tokenizeText(doc.file.name);
      summary = await sealText(doc.summary);
      if (title === null || fileName === null || summary === null) return send(res, 502, { error: 'crypto failure' });
    }

    const d = decodeFile(doc.file.data);
    if (d.status) return send(res, 400, { error: 'bad request' });
    const buf = d.buf;
    try {
      const size = buf.length;
      const out = await tx(async (client) => {
        const ids = (await client.query('SELECT id FROM documents')).rows.map((r) => r.id);
        const id = nextId('DOC', ids);
        await client.query(
          'INSERT INTO documents (id, title, type, tlp, status, owner, approver, next_review, derived_from) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)',
          [id, title, doc.type, doc.tlp, doc.status, doc.owner, doc.approver, doc.nextReview],
        );
        const ins = await client.query(
          `INSERT INTO document_versions
             (document_id, version, date, author, summary, approved_by, file_name, mime_type, size_bytes, content_base64, content_ciphertext, integrity_tag, protection)
           VALUES ($1, $2, now(), $3, $4, NULL, $5, $6, $7, NULL, $8, $9, 'encrypted')
           RETURNING date`,
          [id, doc.version, me.username, summary, fileName, doc.file.mime, size, c.value, h.value],
        );
        await client.query('SELECT log_audit($1, $2, $3, $4, $5, NULL)', [me.username, 'doc.upload', 'document', id, `Uploaded ${id} v${doc.version}`]);
        return { id, date: ins.rows[0].date };
      });
      return send(res, 201, {
        id: out.id,
        title: doc.title,
        type: doc.type,
        tlp: doc.tlp,
        status: doc.status,
        version: doc.version,
        nextReview: doc.nextReview,
        owner: doc.owner,
        approver: doc.approver,
        fileName: doc.file.name,
        size,
        uploadedBy: me.username,
        at: out.date.toISOString(),
      });
    } finally {
      buf.fill(0);
    }
  }

  return { create };
}
