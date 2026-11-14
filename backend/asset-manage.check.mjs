// Self-check: asset + document write routes with fake DB/crypto. No network.
import assert from 'node:assert/strict';
import { makeAssetRoutes } from './asset-manage.mjs';
import { makeDocUploadRoutes } from './doc-upload.mjs';
import { meJson } from './session.mjs';

const ROW = { id: 'AST-0001', name: 'PLC', type: 'PLC', site: 'S', sector: 'Water', purdue_level: 'L1', zone: 'Z1 Control', criticality: 'high', owner: 'OT', last_reviewed: new Date('2026-01-01'), status: 'active' };
const ME = { username: 'kol', rankCode: 'kolonel', accessLevel: 4 };

function harness({ row = ROW, seal = 'skadut-t1:x', token = 'masked:t1:x', deleted = 1 } = {}) {
  const log = [];
  const client = { query: async (sql, params) => {
    log.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
    if (sql.startsWith('SELECT id FROM assets WHERE')) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    if (sql.startsWith('SELECT id FROM')) return { rows: [] };
    if (sql.startsWith('SELECT id, name, type')) return { rows: row ? [row] : [] };
    if (sql.startsWith('SELECT 1 FROM assets')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('UPDATE assets')) return { rowCount: 1 };
    if (sql.startsWith('DELETE FROM assets')) return { rowCount: deleted };
    if (sql.startsWith('DELETE')) return { rowCount: 2 };
    if (sql.includes('RETURNING date')) return { rows: [{ date: new Date() }] };
    if (sql.startsWith('SELECT log_audit')) log.push(params);
    return { rows: [] };
  }, release() {} };
  const out = {};
  const deps = {
    q: async (sql) => ({ rows: sql.startsWith('SELECT id, name') && row ? [row] : [] }),
    connect: async () => client,
    send: (res, status, body) => Object.assign(out, { status, body }),
    readRaw: async (req) => Buffer.from(JSON.stringify(req.body)),
    forbid: (res) => Object.assign(out, { status: 403 }),
    sealText: async () => seal, tokenizeText: async () => token,
    cryptoCall: async () => ({ value: 'skadut-t1:d0123456789abcdef:YWJj' }),
    takeUploadToken: () => true, MAX_BODY: 1 << 24,
  };
  const req = (body, me = ME) => ({ me, body, headers: { 'content-type': 'application/json' } });
  return { assets: makeAssetRoutes(deps), docs: makeDocUploadRoutes(deps), req, out, log };
}

// patch: diff only changed fields, zone recomputed, audit carries sealed reason
{
  const h = harness();
  await h.assets.patch(h.req({ purdueLevel: 'L2', criticality: 'high', reason: 'move' }), {}, 'AST-0001');
  assert.equal(h.out.status, 200);
  assert.deepEqual(h.out.body.changed, ['purdueLevel', 'zone']);
  assert.ok(JSON.stringify(h.log).includes('skadut-t1:x'));
  assert.ok(h.log.some((entry) => Array.isArray(entry) && entry[1] === 'asset.update'));
}
{
  const h = harness();
  await h.assets.patch(h.req({ criticality: 'high', reason: 'same' }), {}, 'AST-0001');
  assert.deepEqual([h.out.status, h.out.body.error], [400, 'no changes']);
  await h.assets.patch(h.req({ criticality: 'low', reason: 'r' }, { ...ME, accessLevel: 3 }), {}, 'AST-0001');
  assert.equal(h.out.status, 403, 'level < 4');
}
{
  const h = harness({ row: null });
  await h.assets.patch(h.req({ criticality: 'low', reason: 'r' }), {}, 'AST-0009');
  assert.equal(h.out.status, 404);
}

// delete: confirmId must match; missing row rolls back -> 404; counts returned
{
  const h = harness();
  await h.assets.remove(h.req({ reason: 'r', confirmId: 'AST-0002' }), {}, 'AST-0001');
  assert.equal(h.out.status, 400);
  await h.assets.remove(h.req({ reason: 'r', confirmId: 'AST-0001' }), {}, 'AST-0001');
  assert.deepEqual(h.out.body, { id: 'AST-0001', unlinkedEvidence: 2, unlinkedDocuments: 2 });
  assert.ok(h.log.some((entry) => Array.isArray(entry) && entry[1] === 'asset.delete'));
  const g = harness({ deleted: 0 });
  await g.assets.remove(g.req({ reason: 'r', confirmId: 'AST-0001' }), {}, 'AST-0001');
  assert.equal(g.out.status, 404);
  assert.ok(g.log.includes('ROLLBACK'));
  const s = harness({ seal: null });
  await s.assets.remove(s.req({ reason: 'r', confirmId: 'AST-0001' }), {}, 'AST-0001');
  assert.equal(s.out.status, 502);
  assert.equal(s.log.length, 0, 'no write on crypto failure');
}

// create asset: tokenize failure -> 502, nothing written
{
  const h = harness({ token: null });
  await h.assets.create(h.req({ name: 'N', type: 'PLC', site: 'S2', sector: 'Water', purdueLevel: 'L1', vendor: 'V', model: 'M', firmware: 'F', ipAddress: '10.0.0.1', criticality: 'low', status: 'active', owner: 'O', lastReviewed: '2026-01-01' }), {});
  assert.equal(h.out.status, 502);
  assert.equal(h.log.length, 0);
  const created = harness();
  await created.assets.create(created.req({ name: 'N', type: 'PLC', site: 'S2', sector: 'Water', purdueLevel: 'L1', vendor: 'V', model: 'M', firmware: 'F', ipAddress: '10.0.0.1', criticality: 'low', status: 'active', owner: 'O', lastReviewed: '2026-01-01' }), {});
  assert.ok(created.log.some((entry) => Array.isArray(entry) && entry[1] === 'asset.create'));
}

// document create: non-CLEAR tokenize failure -> 502, nothing written; ceiling enforced
const DOC = { title: 'T', type: 'Policy', owner: 'O', approver: 'A', tlp: 'AMBER', status: 'draft', nextReview: '2026-12-01', version: '1.0', summary: 'S',
  file: { name: 'a.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4').toString('base64') } };
{
  const h = harness({ token: null });
  await h.docs.create(h.req(DOC), {});
  assert.equal(h.out.status, 502);
  assert.equal(h.log.length, 0);
  const r = harness();
  await r.docs.create(r.req({ ...DOC, tlp: 'RED+STRICT' }), {});
  assert.equal(r.out.status, 403, 'RED+STRICT above any level ceiling');
  await r.docs.create(r.req(DOC), {});
  assert.equal(r.out.status, 201);
  assert.equal(r.out.body.size, 8);
  assert.ok(r.log.some((entry) => Array.isArray(entry) && entry[1] === 'doc.upload'));
}

// /api/me permissions
{
  const p = meJson({ id: 'u', username: 'k', name: 'n', rankCode: 'kolonel', accessLevel: 4 }).permissions;
  assert.deepEqual(p, { canCreateDocument: true, docCreateMaxTlp: 'RED', canWriteAssets: { c: true, u: true, d: true } });
  const t = meJson({ id: 'u', username: 't', name: 'n', rankCode: 'prajurit-dua', accessLevel: 1 }).permissions;
  assert.deepEqual(t, { canCreateDocument: false, docCreateMaxTlp: null, canWriteAssets: { c: false, u: false, d: false } });
  assert.equal(meJson({ id: 'u', username: 'k', name: 'n', rankCode: 'kapten', accessLevel: 2 }).permissions.docCreateMaxTlp, 'AMBER');
}

console.log('asset-manage ok');
