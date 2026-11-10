import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as defaultVault from './vault-api.mjs';
import { createCeremony, recoverShares } from './ceremony.mjs';
import { readDashEvents as defaultReadDash } from './events.mjs';
import { readKeyEvents as defaultReadKey } from './audit.mjs';
import { POLICY as defaultPolicy, mskInfo as defaultMsk, kekInfo as defaultKek, dekInfo as defaultDek } from './nist.mjs';
import { readCerts as defaultReadCerts } from './certs.mjs';
import { recordCerts as defaultRecordCerts, readCertHistory as defaultReadCertHistory } from './cert-history.mjs';

const MAX_BODY = 16384;
const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILS = 10;
const MAX_KEYS = 1000;
const ORIGINS = (process.env.DASH_ORIGINS || 'http://127.0.0.1:8090,http://localhost:8090').split(',').map((s) => s.trim()).filter(Boolean);
const SECURITY = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};
const STATIC = new Map([
  ['/index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'application/javascript; charset=utf-8'],
  ['/style.css', 'text/css; charset=utf-8'],
]);
const SHARE_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const fail = (status, error) => Object.assign(new Error(error), { status });
const sha = (s) => createHash('sha256').update(s).digest();
const shareOk = (s) => typeof s === 'string' && s.length >= 1 && s.length <= 100 && SHARE_RE.test(s);
const byAt = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
const head = (res, status, type, extra = {}) =>
  res.writeHead(status, { ...SECURITY, ...(type && { 'Content-Type': type }), ...extra });
const json = (res, status, body, extra) => {
  head(res, status, 'application/json', extra);
  res.end(JSON.stringify(body));
};
const empty = (res, status) => (head(res, status), res.end());
const list = (fn) => Promise.resolve().then(fn).then((r) => (Array.isArray(r) ? r : [])).catch(() => []);

async function readJson(req) {
  if (Number(req.headers['content-length']) > MAX_BODY) throw fail(413, 'payload too large');
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > MAX_BODY) throw fail(413, 'payload too large');
    chunks.push(c);
  }
  if (!total) return {};
  let v;
  try {
    v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw fail(400, 'invalid JSON body');
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw fail(400, 'invalid JSON body');
  return v;
}
export function createApp({
  token,
  mode,
  ceremony,
  vault = defaultVault,
  nodes = vault.NODES,
  readKeyEvents = defaultReadKey,
  readDashEvents = defaultReadDash,
  readCerts = defaultReadCerts,
  recordCerts = defaultRecordCerts,
  readCertHistory = defaultReadCertHistory,
  POLICY = defaultPolicy,
  mskInfo = defaultMsk,
  kekInfo = defaultKek,
  dekInfo = defaultDek,
  staticDir = '/dash/public',
} = {}) {
  const expected = sha(token);
  const fails = new Map();
  const recentFails = (ip) => {
    const live = (fails.get(ip) || []).filter((t) => Date.now() - t < WINDOW_MS);
    if (live.length) fails.set(ip, live);
    else fails.delete(ip);
    return live;
  };
  const recordFail = (ip) => {
    const now = Date.now();
    for (const [k, ts] of fails) { // prune expired on every insert
      const live = ts.filter((t) => now - t < WINDOW_MS);
      if (live.length) fails.set(k, live);
      else fails.delete(k);
    }
    const prev = fails.get(ip) || [];
    fails.delete(ip);
    fails.set(ip, [...prev, now]); // re-insert so Map order tracks recency
    while (fails.size > MAX_KEYS) fails.delete(fails.keys().next().value); // drop oldest
  };

  const getStatus = async () => {
    const nodeList = await Promise.all(
      nodes.map(async (id) => {
        const s = await vault.sealStatus(id);
        return { id, reachable: s.reachable, initialized: s.initialized, sealed: s.sealed, progress: s.progress, version: s.version };
      }),
    );
    const initialized = nodeList.some((n) => n.initialized === true);
    const sealedCount = nodeList.filter((n) => n.reachable && n.sealed).length;
    const key = await list(() => readKeyEvents({ limit: 200 }));
    const dash = await list(() => readDashEvents(200));
    const events = [...key, ...dash].sort(byAt);
    const sharesOnDisk = ceremony.sharesOnDisk();
    const rekey = await ceremony.rekeyStatus();
    return {
      mode, initialized, threshold: 3, shares: 5, sharesOnDisk, rekey, nodes: nodeList,
      msk: mskInfo({ initialized, sealedCount, nodeCount: nodes.length, events }),
      kek: kekInfo(events), dek: dekInfo(events),
    };
  };

  const getEvents = async (url) => {
    const raw = url.searchParams.get('limit') ?? '100';
    const limit = Number(raw);
    if (!/^\d+$/.test(raw) || limit < 1 || limit > 500) throw fail(400, 'invalid limit');
    const type = url.searchParams.get('type') ?? 'ALL';
    if (!['MSK', 'KEK', 'DEK', 'ALL'].includes(type)) throw fail(400, 'invalid type');
    const key = await list(() => readKeyEvents({ limit, type: type === 'ALL' ? undefined : type }));
    const dash = (await list(() => readDashEvents(limit))).filter((e) => type === 'ALL' || e.type === type);
    return [...key, ...dash].sort(byAt).slice(0, limit);
  };

  const R = {
    'GET /api/status': [200, getStatus],
    'POST /api/init': [201, () => ceremony.initCluster()],
    'POST /api/unseal': [200, ({ body }) => (shareOk(body.share) ? ceremony.unsealAll(body.share) : Promise.reject(fail(400, 'invalid share')))],
    'POST /api/shares/reveal': [200, () => ceremony.revealShares()],
    'POST /api/shares/destroy': [204, ({ body }) => (typeof body.confirm === 'string' ? ceremony.destroyShares(body.confirm) : Promise.reject(fail(400, 'confirm required')))],
    'POST /api/shares/store': [204, ({ body }) => (Array.isArray(body.shares) ? ceremony.storeShares(body.shares) : Promise.reject(fail(400, 'invalid shares')))],
    'POST /api/rekey/start': [200, () => ceremony.rekeyStart()],
    'POST /api/rekey/update': [200, ({ body }) => {
      if (typeof body.nonce !== 'string') throw fail(400, 'invalid nonce');
      if (body.share !== undefined && !shareOk(body.share)) throw fail(400, 'invalid share');
      return ceremony.rekeyProvide({ nonce: body.nonce, share: body.share });
    }],
    'POST /api/rekey/cancel': [204, () => ceremony.rekeyCancel()],
    'GET /api/events': [200, ({ url }) => getEvents(url)],
    'GET /api/policy': [200, () => POLICY],
    'GET /api/certs': [200, async () => {
      const result = await readCerts({ nodes });
      try {
        await recordCerts(result.certs);
      } catch (err) {
        console.error('cert history: record failed', err?.code || 'error');
      }
      return result;
    }],
    'GET /api/certs/history': [200, () => readCertHistory()],
  };

  const page = async (req, res, path) => {
    if (req.method === 'GET' && path === '/healthz') return json(res, 200, { ok: true });
    const file = path === '/' ? '/index.html' : path;
    const type = STATIC.get(file);
    if (req.method !== 'GET' || !type) return json(res, 404, { error: 'not found' });
    try {
      const data = await readFile(join(staticDir, file));
      head(res, 200, type);
      res.end(data);
    } catch {
      json(res, 404, { error: 'not found' });
    }
  };

  const handle = async (req, res) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return page(req, res, path);
    const origin = req.headers.origin;
    if (origin && !ORIGINS.includes(origin)) return json(res, 403, { error: 'forbidden origin' });
    const ip = req.socket.remoteAddress;
    const auth = req.headers.authorization || '';
    const given = auth.startsWith('Bearer ') ? sha(auth.slice(7)) : null;
    if (!given || !timingSafeEqual(given, expected)) {
      if (recentFails(ip).length >= MAX_FAILS) return json(res, 429, { error: 'too many failed attempts' }, { 'Retry-After': '300' });
      recordFail(ip);
      return json(res, 401, { error: 'unauthorized' });
    }
    if (req.method === 'POST' && !(req.headers['content-type'] || '').startsWith('application/json')) {
      return json(res, 415, { error: 'content-type must be application/json' });
    }
    const body = req.method === 'POST' ? await readJson(req) : {};
    const route = R[`${req.method} ${path}`];
    if (!route) {
      const allow = Object.keys(R).filter((k) => k.endsWith(` ${path}`)).map((k) => k.split(' ')[0]);
      return allow.length
        ? json(res, 405, { error: 'method not allowed' }, { Allow: allow.join(', ') })
        : json(res, 404, { error: 'not found' });
    }
    const [status, fn] = route;
    const result = await fn({ body, url: new URL(req.url, 'http://localhost') });
    return status === 204 ? empty(res, 204) : json(res, status, result);
  };

  return async (req, res) => {
    res.on('finish', () => console.log(`${req.method} ${req.url.split('?')[0]} ${res.statusCode}`));
    try {
      await handle(req, res);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      const ok = Number.isInteger(err?.status) && err.status >= 400 && err.status <= 599;
      json(res, ok ? err.status : 500, { error: ok ? err.message : 'internal error' }, err?.status === 413 ? { Connection: 'close' } : undefined);
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.KEYZONE_DASH_TOKEN;
  if (!token || token.length < 16) { console.error('KEYZONE_DASH_TOKEN missing or shorter than 16 chars'); process.exit(1); }
  const mode = process.env.KEYZONE_MODE || 'safe';
  if (mode !== 'safe' && mode !== 'unsafe') { console.error('KEYZONE_MODE must be safe or unsafe'); process.exit(1); }
  recoverShares();
  const ceremony = createCeremony({ mode });
  if (mode === 'unsafe') ceremony.autoUnsealLoop();
  const port = Number(process.env.PORT) || 8090;
  createServer(createApp({ token, mode, ceremony })).listen(port, '0.0.0.0', () => console.log(`listening ${port} mode=${mode}`));
}
