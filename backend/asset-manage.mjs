// POST/PATCH/DELETE /api/assets: validated writes with sealed fields. Deps injected from server.mjs.
import { authorize } from './auth.mjs';
import { validateAssetBody, validateAssetPatch, zoneFor, nextId } from './assets-write.mjs';
import { MAX_BODY } from './uploads.mjs';

const JSON_CT = /^application\/json(\s*;\s*charset=utf-8)?$/i;
const RETRIES = 3;
const PATCH_COLS = {
  name: 'name', type: 'type', site: 'site', purdueLevel: 'purdue_level',
  criticality: 'criticality', status: 'status', lastReviewed: 'last_reviewed', owner: 'owner',
};
const ROW_SQL = `SELECT id, name, type, site, sector, purdue_level, zone, vendor, model, firmware, ip_address,
  criticality, owner, last_reviewed, status FROM assets WHERE id = $1 FOR UPDATE`;

const dayOf = (v) => (v == null ? v : new Date(v).toISOString().slice(0, 10));

export function makeAssetRoutes({ q, connect, send, readRaw, forbid, sealText, tokenizeText, cryptoCall }) {
  async function readJson(req) {
    const ct = (req.headers['content-type'] || '').trim().toLowerCase();
    if (!JSON_CT.test(ct)) return { status: 415, error: 'unsupported media type' };
    const len = Number(req.headers['content-length']);
    if (Number.isFinite(len) && len > MAX_BODY) return { status: 413, error: 'too large' };
    let raw;
    try {
      raw = await readRaw(req);
    } catch (err) {
      if (err.code === 'ETIMEDOUT') return { status: 408, error: 'timeout' };
      throw err;
    }
    if (raw === null) return { status: 413, error: 'too large' };
    try {
      const parsed = JSON.parse(raw.toString('utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { status: 400, error: 'bad request' };
      }
      return { body: parsed };
    } catch {
      return { status: 400, error: 'bad request' };
    }
  }

  function fail(res, p) {
    return send(res, p.status, { error: p.error }, p.status === 413 || p.status === 408 ? { Connection: 'close' } : {});
  }

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
    const p = await readJson(req);
    if (p.status) return fail(res, p);
    const v = validateAssetBody(p.body);
    if (!v.ok) return send(res, 400, { error: v.error });
    const a = v.value;

    const ok = authorize(me.rankCode, 'asset.c', { accessLevel: me.accessLevel }) && me.accessLevel >= 4;
    if (!ok) return forbid(res, me, 'asset', 'new', 'asset create denied');

    // ponytail: pre-check outside the tx; concurrent same-name creates can both pass. Add a unique index on (site, lower(name)) to close it.
    const dup = await q('SELECT 1 FROM assets WHERE site = $1 AND lower(name) = lower($2) LIMIT 1', [a.site, a.name]);
    if (dup.rows.length > 0) return send(res, 409, { error: 'conflict', field: 'name' });

    const model = await sealText(a.model);
    const firmware = await sealText(a.firmware);
    const ip = await tokenizeText(a.ipAddress);
    if (model === null || firmware === null || ip === null) return send(res, 502, { error: 'crypto failure' });

    const zone = zoneFor(a.purdueLevel, a.type);
    const id = await tx(async (client) => {
      const ids = (await client.query('SELECT id FROM assets')).rows.map((r) => r.id);
      const nid = nextId('AST', ids);
      await client.query(
        `INSERT INTO assets (id, name, type, site, sector, purdue_level, zone, vendor, model, firmware, ip_address, criticality, owner, last_reviewed, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [nid, a.name, a.type, a.site, a.sector, a.purdueLevel, zone, a.vendor, model, firmware, ip, a.criticality, a.owner, a.lastReviewed, a.status],
      );
      await client.query('SELECT log_audit($1, $2, $3, $4, $5, NULL)', [me.username, 'asset.create', 'asset', nid, `Created ${nid} ${a.name}`]);
      return nid;
    });
    return send(res, 201, { id, zone, at: new Date().toISOString() });
  }

  async function patch(req, res, id) {
    const me = req.me;
    const p = await readJson(req);
    if (p.status) return fail(res, p);
    if (typeof p.body !== 'object' || p.body === null || Array.isArray(p.body)) return send(res, 400, { error: 'bad request' });
    const v = validateAssetPatch(p.body);
    if (!v.ok) return send(res, 400, { error: v.error });
    const { reason, ...fields } = v.value;
    if (!/^AST-\d{4,}$/.test(id)) return send(res, 400, { error: 'bad request' });

    const ok = authorize(me.rankCode, 'asset.u', { accessLevel: me.accessLevel }) && me.accessLevel >= 4;
    if (!ok) return forbid(res, me, 'asset', id, 'asset update denied');

    const sealed = await sealText(reason);
    if (sealed === null) return send(res, 502, { error: 'crypto failure' });

    try {
      const changed = await tx(async (client) => {
        const row = (await client.query(ROW_SQL, [id])).rows[0];
        if (!row) throw Object.assign(new Error('not found'), { notFound: true });

        if (fields.name !== undefined || fields.site !== undefined) {
          const name = fields.name ?? row.name;
          const site = fields.site ?? row.site;
          const dup = await client.query('SELECT 1 FROM assets WHERE id <> $1 AND site = $2 AND lower(name) = lower($3) LIMIT 1', [id, site, name]);
          if (dup.rowCount > 0) throw Object.assign(new Error('conflict'), { conflict: true });
        }

        const updates = [];
        const changes = [];
        for (const [key, val] of Object.entries(fields)) {
          const col = PATCH_COLS[key];
          const from = key === 'lastReviewed' ? dayOf(row[col]) : row[col];
          if (from === val) continue;
          updates.push([col, val]);
          changes.push({ field: key, from, to: val });
        }
        if (updates.some(([col]) => col === 'type' || col === 'purdue_level')) {
          const zone = zoneFor(fields.purdueLevel ?? row.purdue_level, fields.type ?? row.type);
          if (zone !== row.zone) {
            updates.push(['zone', zone]);
            changes.push({ field: 'zone', from: row.zone, to: zone });
          }
        }
        if (updates.length === 0) throw Object.assign(new Error('no changes'), { noChanges: true });
        const updated = await client.query(`UPDATE assets SET ${updates.map(([col], i) => `${col} = $${i + 1}`).join(', ')} WHERE id = $${updates.length + 1}`, [...updates.map(([, val]) => val), id]);
        if (updated.rowCount !== 1) throw Object.assign(new Error('not found'), { notFound: true });
        await client.query('SELECT log_audit($1, $2, $3, $4, $5, $6::jsonb)', [
          me.username, 'asset.update', 'asset', id, `Updated ${id}: ${changes.map((c) => c.field).join(', ')}`, JSON.stringify([...changes, { field: 'reason', from: '', to: sealed }]),
        ]);
        return changes.map((c) => c.field);
      });
      return send(res, 200, { id, changed });
    } catch (err) {
      if (err.notFound) return send(res, 404, { error: 'not found' });
      if (err.conflict) return send(res, 409, { error: 'conflict', field: 'name' });
      if (err.noChanges) return send(res, 400, { error: 'no changes' });
      throw err;
    }
  }

  async function remove(req, res, id) {
    const me = req.me;
    const p = await readJson(req);
    if (p.status) return fail(res, p);
    if (typeof p.body !== 'object' || p.body === null || Array.isArray(p.body)) return send(res, 400, { error: 'bad request' });
    const body = p.body;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 1 || reason.length > 500 || body.confirmId !== id) return send(res, 400, { error: 'bad request' });
    if (!/^AST-\d{4,}$/.test(id)) return send(res, 400, { error: 'bad request' });

    const ok = authorize(me.rankCode, 'asset.d', { accessLevel: me.accessLevel }) && me.accessLevel >= 4;
    if (!ok) return forbid(res, me, 'asset', id, 'asset delete denied');

    const sealed = await sealText(reason);
    if (sealed === null) return send(res, 502, { error: 'crypto failure' });

    try {
      const out = await tx(async (client) => {
        const current = await client.query('SELECT id FROM assets WHERE id = $1 FOR UPDATE', [id]);
        if (current.rowCount === 0) throw Object.assign(new Error('not found'), { notFound: true });
        const ev = await client.query('DELETE FROM evidence_links WHERE asset_id = $1', [id]);
        const dl = await client.query('DELETE FROM asset_document_links WHERE asset_id = $1', [id]);
        const del = await client.query('DELETE FROM assets WHERE id = $1', [id]);
        if (del.rowCount === 0) throw Object.assign(new Error('not found'), { notFound: true });
        const counts = { unlinkedEvidence: ev.rowCount, unlinkedDocuments: dl.rowCount };
        await client.query('SELECT log_audit($1, $2, $3, $4, $5, $6::jsonb)', [
          me.username, 'asset.delete', 'asset', id, `Deleted ${id}`,
          JSON.stringify([
            { field: 'unlinkedEvidence', from: 0, to: counts.unlinkedEvidence },
            { field: 'unlinkedDocuments', from: 0, to: counts.unlinkedDocuments },
            { field: 'reason', from: '', to: sealed },
          ]),
        ]);
        return counts;
      });
      return send(res, 200, { id, ...out });
    } catch (err) {
      if (err.notFound) return send(res, 404, { error: 'not found' });
      throw err;
    }
  }

  return { create, patch, remove };
}
