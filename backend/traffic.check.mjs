// Self-check: traffic recorder, prune window, zero defaults, remote validation.
{
  const now = Date.parse('2026-11-13T12:00:00Z');
  assert.deepEqual(clampHistoryRange(undefined, undefined, now), { fromMs: now - 3_600_000, toMs: now });
  assert.deepEqual(clampHistoryRange('2026-11-10T00:00:00Z', '2026-11-13T12:00:00Z', now), { fromMs: now - 86_400_000, toMs: now });
  assert.deepEqual(clampHistoryRange('2026-11-13T11:00:00Z', '2026-11-13T10:00:00Z', now), { fromMs: Date.parse('2026-11-13T10:00:00Z'), toMs: Date.parse('2026-11-13T11:00:00Z') });
  assert.equal(clampBucket(undefined), 60);
  assert.equal(clampBucket('5'), 10);
  assert.equal(clampBucket('3700'), 3600);
  assert.equal(clampBucket('bad'), 60);
  const points = aggregateHistoryPoints([
    { bucket_start: '2026-11-13T10:00:10Z', source: 'frontend', target: 'backend', window_seconds: 10, request_count: 4, error_count: 1, total_ms: '100' },
    { bucket_start: '2026-11-13T10:00:20Z', source: 'frontend', target: 'backend', window_seconds: 10, request_count: 6, error_count: 1, total_ms: '200' },
  ], 60);
  assert.deepEqual(points, [{ ts: Date.parse('2026-11-13T10:00:00Z') / 1000, edges: [{ source: 'frontend', target: 'backend', rps: 0.5, errorRate: 0.2, avgMs: 30 }] }]);
}
import assert from 'node:assert/strict';
import { record, snapshot, ownSnapshot, validateRemote, recordCrypto, cryptoLog, EDGES, writeTrafficSample, queryTrafficHistory, makeTrafficRoutes, clampHistoryRange, clampBucket, aggregateHistoryPoints } from './traffic.mjs';

const find = (snap, s, t) => snap.find((e) => e.source === s && e.target === t);

// Record 4 requests in one second: 1 failed, durations 10/20/30/40.
const T0 = 100_000;
record('frontend', 'backend', { failed: false, ms: 10 }, T0);
record('frontend', 'backend', { failed: true, ms: 20 }, T0);
record('frontend', 'backend', { failed: false, ms: 30 }, T0);
record('frontend', 'backend', { failed: false, ms: 40 }, T0);
const s1 = find(snapshot(10, T0), 'frontend', 'backend');
assert.equal(s1.rps, 0.4);
assert.equal(s1.errorRate, 0.25);
assert.equal(s1.avgMs, 25);

// Prune: bucket at sec 100 visible at now=109s (window 10), gone at now=110s.
assert.equal(find(snapshot(10, 109_000), 'frontend', 'backend').rps, 0.4);
assert.equal(find(snapshot(10, 110_000), 'frontend', 'backend').rps, 0);

// Zero defaults for all known edges, including remote ones with no data.
const empty = snapshot(10, T0 + 60_000);
assert.equal(empty.length, EDGES.length);
for (const e of empty) assert.deepEqual([e.rps, e.errorRate, e.avgMs], [0, 0, 0]);

// ownSnapshot (remote absent): only backend-owned edges, no crypto edges.
assert.deepEqual(ownSnapshot(10, T0 + 60_000).map((e) => `${e.source}>${e.target}`), ['frontend>backend', 'backend>db', 'backend>crypto-service']);

// validateRemote: keeps allowed edges, drops the rest silently.
const good = { source: 'client', target: 'crypto-service', rps: 1, errorRate: 0, avgMs: 2 };
assert.deepEqual(validateRemote([good]), [good]);
assert.deepEqual(validateRemote([
  { ...good, source: 'backend', target: 'crypto-service' }, // not crypto-service-reportable
  { ...good, target: 'keyd-9' },                            // unknown id
  { ...good, rps: Number.NaN },                             // non-finite
  { ...good, avgMs: Infinity },                             // non-finite
  { ...good, errorRate: '0.1' },                            // non-numeric
  null,
]), []);
assert.deepEqual(validateRemote(undefined), []);
assert.deepEqual(validateRemote({ source: 'client', target: 'crypto-service', rps: 1, errorRate: 0, avgMs: 1 }), []);
assert.equal(validateRemote([{ source: 'client', target: 'crypto-service', rps: 1, errorRate: 0, avgMs: 1 }]).length, 1);

// cryptoLog: default limit 50, cap 200 (oldest dropped), newest first.
const entry = (i) => ({ at: 1000 + i, path: `/p${i}`, status: 200, ms: 1 });
for (let i = 0; i < 205; i++) recordCrypto(entry(i));
assert.equal(cryptoLog().length, 50);
for (let i = 205; i < 300; i++) recordCrypto(entry(i));
const all = cryptoLog(500);
assert.equal(all.length, 200);
assert.equal(all[0].path, '/p299');
assert.equal(all.at(-1).path, '/p100');
assert.ok(all[0].at >= all.at(-1).at);

// writeTrafficSample: edge validated, snapshot row -> counts, explicit counts kept, upsert SQL.
{
  const calls = [];
  const q = async (sql, params) => { calls.push([sql, params]); return { rows: [] }; };
  const bucket = new Date('2026-11-13T10:00:00Z');
  assert.equal(await writeTrafficSample(q, { source: 'frontend', target: 'backend', rps: 0.4, errorRate: 0.25, avgMs: 25 }, bucket, 10), true);
  assert.match(calls[0][0], /ON CONFLICT \(bucket_start, source, target\) DO UPDATE/);
  assert.deepEqual(calls[0][1], [bucket, 'frontend', 'backend', 10, 4, 1, 100]);
  assert.equal(await writeTrafficSample(q, { source: 'frontend', target: 'backend', requestCount: 7, errorCount: 2, totalMs: 55 }, '2026-11-13T10:00:00Z', 10), true);
  assert.deepEqual(calls[1][1], [new Date('2026-11-13T10:00:00Z'), 'frontend', 'backend', 10, 7, 2, 55]);
  assert.equal(await writeTrafficSample(q, { source: 'frontend', target: 'keyd-9', rps: 1 }, bucket), false, 'unknown edge');
  assert.equal(await writeTrafficSample(q, { source: 'frontend', target: 'backend' }, 'not-a-date'), false);
  assert.equal(await writeTrafficSample(q, { source: 'frontend', target: 'backend' }, bucket, 0), false);
  assert.equal(calls.length, 2, 'invalid samples never hit the DB');
}

// queryTrafficHistory: newest first, limit clamp, optional since, camelCase mapping, total_ms -> Number.
{
  const calls = [];
  const rows = [{ bucket_start: new Date('2026-11-13T10:00:10Z'), source: 'frontend', target: 'backend', window_seconds: 10, request_count: 5, error_count: 0, total_ms: '120' }];
  const q = async (sql, params) => { calls.push([sql, params]); return { rows }; };
  const out = await queryTrafficHistory(q);
  assert.deepEqual(out, [{ bucketStart: '2026-11-13T10:00:10.000Z', source: 'frontend', target: 'backend', windowSeconds: 10, requestCount: 5, errorCount: 0, totalMs: 120 }]);
  assert.deepEqual(calls[0][1], [60]);
  assert.match(calls[0][0], /ORDER BY bucket_start DESC LIMIT \$1$/);
  await queryTrafficHistory(q, { limit: 5, since: '2026-11-13T09:00:00Z' });
  assert.deepEqual(calls[1][1], [5, new Date('2026-11-13T09:00:00Z')]);
  assert.match(calls[1][0], /bucket_start >= \$2/);
  assert.equal(await queryTrafficHistory(q, { since: 'nope' }), null);
  await queryTrafficHistory(q, { limit: 5000 });
  assert.deepEqual(calls.at(-1)[1], [60], 'out-of-range limit falls back to 60');
}

// makeTrafficRoutes().history: superAdmin only; { samples }; bad limit/since -> 400.
{
  const res = () => {
    const r = { status: null, body: null, headers: {}, writeHead(s, h = {}) { this.status = s; Object.assign(this.headers, h); }, end(b) { this.body = b; } };
    return r;
  };
  const send = (r, status, body) => { r.writeHead(status); r.end(JSON.stringify(body)); };
  const forbid = (r) => { r.writeHead(403); r.end(JSON.stringify({ error: 'forbidden' })); };
  const q = async () => ({ rows: [] });
  const { history } = makeTrafficRoutes({ q, send, forbid });
  const ok = res();
  await history({ me: { superAdmin: true }, url: '/api/traffic/history' }, ok);
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(JSON.parse(ok.body)).sort(), ['bucketSeconds', 'from', 'points', 'to']);
  assert.deepEqual(JSON.parse(ok.body).points, []);
  const denied = res();
  await history({ me: { superAdmin: false }, url: '/api/traffic/history' }, denied);
  assert.equal(denied.status, 403);
  const badLimit = res();
  await history({ me: { superAdmin: true }, url: '/api/traffic/history?limit=0' }, badLimit);
  assert.equal(badLimit.status, 400);
  const badSince = res();
  await history({ me: { superAdmin: true }, url: '/api/traffic/history?since=nope' }, badSince);
  assert.equal(badSince.status, 400);
  const row = { bucket_start: new Date('2026-11-13T10:00:10Z'), source: 'frontend', target: 'backend', window_seconds: 10, request_count: 5, error_count: 1, total_ms: '50' };
  const ranged = res();
  const { history: history2 } = makeTrafficRoutes({ q: async (sql, params) => { assert.match(sql, /bucket_start >= \$1/); return { rows: [row] }; }, send, forbid });
  await history2({ me: { superAdmin: true }, url: '/api/traffic/history?from=2026-11-13T10:00:00Z&to=2026-11-13T10:10:00Z&bucket=30' }, ranged);
  assert.equal(ranged.status, 200);
  const body = JSON.parse(ranged.body);
  assert.equal(body.bucketSeconds, 30);
  assert.equal(body.from, '2026-11-13T10:00:00.000Z');
  assert.deepEqual(body.points, [{ ts: Date.parse('2026-11-13T10:00:00Z') / 1000, edges: [{ source: 'frontend', target: 'backend', rps: 0.5, errorRate: 0.2, avgMs: 10 }] }]);
  const badRange = res();
  await history2({ me: { superAdmin: true }, url: '/api/traffic/history?from=nope' }, badRange);
  assert.equal(badRange.status, 400);
}

console.log('traffic ok');
