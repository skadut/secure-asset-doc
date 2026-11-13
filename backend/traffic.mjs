// In-memory per-second edge recorder. Metadata only: fixed service IDs, counts, durations, failed flag.
export const EDGES = [
  { source: 'frontend', target: 'backend' },
  { source: 'backend', target: 'db' },
  { source: 'backend', target: 'crypto-service' },
  { source: 'client', target: 'crypto-service' },
];

const key = (s, t) => `${s}>${t}`;
const REMOTE = new Set(
  EDGES.filter((e) => e.source === 'client' || e.source === 'crypto-service').map((e) => key(e.source, e.target)),
);

// ponytail: buckets kept per edge = 60s; snapshot windows above 60s get truncated. Raise if longer windows needed.
const KEEP = 60;
const edges = new Map(EDGES.map((e) => [key(e.source, e.target), new Map()]));

// Separate 10s buffer for durable history. Never read by the live snapshot.
const HISTORY_WINDOW_MS = 10000;
const historyBuffer = new Map();

export function record(source, target, { failed, ms }, now = Date.now()) {
  const edgeKey = key(source, target);
  const secs = edges.get(edgeKey);
  if (!secs) return;
  const sec = Math.floor(now / 1000);
  let b = secs.get(sec);
  if (!b) {
    b = { count: 0, errors: 0, totalMs: 0 };
    secs.set(sec, b);
    for (const s of secs.keys()) if (s < sec - KEEP) secs.delete(s);
  }
  b.count++;
  if (failed) b.errors++;
  b.totalMs += Number.isFinite(ms) ? ms : 0;

  const bucketStart = Math.floor(now / HISTORY_WINDOW_MS) * HISTORY_WINDOW_MS;
  const hKey = `${bucketStart}|${edgeKey}`;
  let h = historyBuffer.get(hKey);
  if (!h) {
    h = { bucketStart, source, target, requestCount: 0, errorCount: 0, totalMs: 0 };
    historyBuffer.set(hKey, h);
    for (const [k, old] of historyBuffer) if (old.bucketStart < bucketStart - 2 * HISTORY_WINDOW_MS) historyBuffer.delete(k);
  }
  h.requestCount++;
  if (failed) h.errorCount++;
  h.totalMs += Number.isFinite(ms) ? ms : 0;
}

export function snapshot(windowSec = 10, now = Date.now()) {
  const cutoff = Math.floor(now / 1000) - windowSec + 1;
  return EDGES.map(({ source, target }) => {
    const secs = edges.get(key(source, target));
    let count = 0, errors = 0, ms = 0;
    for (const [s, b] of secs) {
      if (s < cutoff) { secs.delete(s); continue; }
      count += b.count;
      errors += b.errors;
      ms += b.totalMs;
    }
    return {
      source,
      target,
      rps: count / windowSec,
      errorRate: count ? errors / count : 0,
      avgMs: count ? ms / count : 0,
    };
  });
}

// Own (backend-owned) edges only. Remote edges appended by caller after a successful fetch.
export function ownSnapshot(windowSec = 10, now = Date.now()) {
  return snapshot(windowSec, now).filter((e) => !REMOTE.has(key(e.source, e.target)));
}

// Metadata-only ring buffer of backend->crypto-api calls: { at, path, status, ms, probe? }.
const CRYPTO_CAP = 200;
const cryptoRing = [];
export function recordCrypto(entry) {
  cryptoRing.push(entry);
  if (cryptoRing.length > CRYPTO_CAP) cryptoRing.shift();
}
export function cryptoLog(limit = 50) {
  return cryptoRing.slice().reverse().slice(0, limit);
}

// Only edges crypto-service can report. Unknown edges and non-finite numbers dropped silently.
export function validateRemote(items) {
  if (!Array.isArray(items)) return [];
  return items.flatMap((it) => {
    if (!it || typeof it !== 'object') return [];
    const { source, target, rps, errorRate, avgMs } = it;
    if (typeof source !== 'string' || typeof target !== 'string' || !REMOTE.has(key(source, target))) return [];
    if (![rps, errorRate, avgMs].every(Number.isFinite)) return [];
    return [{ source, target, rps, errorRate, avgMs }];
  });
}

const BUCKET_SQL = 'INSERT INTO traffic_samples (bucket_start, source, target, window_seconds, request_count, error_count, total_ms) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (bucket_start, source, target) DO UPDATE SET window_seconds = EXCLUDED.window_seconds, request_count = EXCLUDED.request_count, error_count = EXCLUDED.error_count, total_ms = EXCLUDED.total_ms';

// Writes one edge sample for a bucket. Accepts a snapshot row ({rps,errorRate,avgMs}) or explicit counts.
// Idempotent per (bucket_start, source, target): a re-write replaces, never accumulates.
export async function writeTrafficSample(q, sample, bucketStart, windowSec = 10) {
  if (!sample || typeof sample !== 'object') return false;
  const { source, target } = sample;
  if (typeof source !== 'string' || typeof target !== 'string' || !edges.has(key(source, target))) return false;
  if (!Number.isInteger(windowSec) || windowSec < 1) return false;
  const at = bucketStart instanceof Date ? bucketStart : new Date(bucketStart);
  if (Number.isNaN(at.getTime())) return false;
  const requestCount = Number.isInteger(sample.requestCount) && sample.requestCount >= 0
    ? sample.requestCount
    : Math.max(0, Math.round((sample.rps ?? 0) * windowSec));
  const errorCount = Number.isInteger(sample.errorCount) && sample.errorCount >= 0
    ? sample.errorCount
    : Math.max(0, Math.min(requestCount, Math.round((sample.errorRate ?? 0) * requestCount)));
  const totalMs = Number.isFinite(sample.totalMs) && sample.totalMs >= 0
    ? Math.round(sample.totalMs)
    : Math.max(0, Math.round((sample.avgMs ?? 0) * requestCount));
  await q(BUCKET_SQL, [at, source, target, windowSec, requestCount, errorCount, totalMs]);
  return true;
}

// Newest buckets first. Invalid `since` -> null (caller answers 400).
export async function queryTrafficHistory(q, { limit = 60, since } = {}) {
  const n = Number.isInteger(limit) && limit >= 1 && limit <= 1000 ? limit : 60;
  const at = since === undefined || since === null || since === '' ? null : new Date(since);
  if (at !== null && Number.isNaN(at.getTime())) return null;
  const { rows } = await q(
    at === null
      ? 'SELECT bucket_start, source, target, window_seconds, request_count, error_count, total_ms FROM traffic_samples ORDER BY bucket_start DESC LIMIT $1'
      : 'SELECT bucket_start, source, target, window_seconds, request_count, error_count, total_ms FROM traffic_samples WHERE bucket_start >= $2 ORDER BY bucket_start DESC LIMIT $1',
    at === null ? [n] : [n, at],
  );
  return rows.map((r) => ({
    bucketStart: new Date(r.bucket_start).toISOString(),
    source: r.source,
    target: r.target,
    windowSeconds: r.window_seconds,
    requestCount: r.request_count,
    errorCount: r.error_count,
    totalMs: Number(r.total_ms),
  }));
}

// Pure history helpers. Kept separate so the checks can exercise them without a DB.
const ONE_HOUR_MS = 60 * 60 * 1000;
const MAX_RANGE_MS = 24 * ONE_HOUR_MS;

export function clampHistoryRange(from, to, now = Date.now()) {
  const parsedTo = to === undefined || to === null || to === '' ? NaN : Date.parse(to);
  const parsedFrom = from === undefined || from === null || from === '' ? NaN : Date.parse(from);
  let toMs = Number.isFinite(parsedTo) ? parsedTo : now;
  let fromMs = Number.isFinite(parsedFrom) ? parsedFrom : toMs - ONE_HOUR_MS;
  if (fromMs > toMs) [fromMs, toMs] = [toMs, fromMs];
  if (toMs - fromMs > MAX_RANGE_MS) fromMs = toMs - MAX_RANGE_MS;
  return { fromMs, toMs };
}

export function clampBucket(bucket) {
  if (bucket === null || bucket === undefined || bucket === '') return 60;
  const n = Number(bucket);
  return Number.isFinite(n) ? Math.min(3600, Math.max(10, Math.floor(n))) : 60;
}

export function aggregateHistoryPoints(rows, bucketSeconds) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const epoch = Math.floor(new Date(row.bucket_start).getTime() / 1000);
    if (!Number.isFinite(epoch)) continue;
    const ts = Math.floor(epoch / bucketSeconds) * bucketSeconds;
    const edgeKey = key(row.source, row.target);
    let point = groups.get(ts);
    if (!point) { point = new Map(); groups.set(ts, point); }
    let edge = point.get(edgeKey);
    if (!edge) { edge = { source: row.source, target: row.target, requests: 0, errors: 0, totalMs: 0, windowSec: 0 }; point.set(edgeKey, edge); }
    edge.requests += Number(row.request_count) || 0;
    edge.errors += Number(row.error_count) || 0;
    edge.totalMs += Number(row.total_ms) || 0;
    edge.windowSec += Number(row.window_seconds) || 0;
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ts, grouped]) => ({
      ts,
      edges: [...grouped.values()]
        .map(({ source, target, requests, errors, totalMs, windowSec }) => ({
          source, target, rps: requests / windowSec,
          errorRate: requests ? errors / requests : 0,
          avgMs: requests ? totalMs / requests : 0,
        }))
        .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)),
    }));
}

// Buffered history writer and retention. Call startHistoryWriter(q) once at startup.
// Signature: startHistoryWriter(q) -> { stop() }. q is the same SQL executor used by the routes.
export function startHistoryWriter(q) {
  let writerTimer = null;
  let retentionTimer = null;
  // Flush at most every 10s; historyBuffer is independent of live snapshot state.
  writerTimer = setInterval(async () => {
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    const ready = [];
    for (const [k, sample] of historyBuffer) {
      if (sample.bucketStart < cutoff) {
        historyBuffer.delete(k);
        ready.push(sample);
      }
    }
    for (const sample of ready) {
      try {
        await writeTrafficSample(q, sample, new Date(sample.bucketStart), 10);
      } catch (err) {
        console.error(`traffic history write failed: ${err && err.message ? err.message : err}`);
      }
    }
  }, 10000);
  // Retention: drop samples older than 7 days, hourly.
  retentionTimer = setInterval(() => {
    q("DELETE FROM traffic_samples WHERE bucket_start < NOW() - interval '7 days'")
      .catch((err) => console.error(`traffic retention failed: ${err && err.message ? err.message : err}`));
  }, ONE_HOUR_MS);
  return { stop: () => { clearInterval(writerTimer); clearInterval(retentionTimer); } };
}

export function makeTrafficRoutes({ q, send, forbid }) {
  async function history(req, res) {
    if (req.me?.superAdmin !== true) return forbid(res, req.me, 'traffic', 'view', 'traffic view denied');
    const sp = new URL(req.url, 'http://localhost').searchParams;
    const fromRaw = sp.get('from');
    const toRaw = sp.get('to');
    if ((fromRaw && !Number.isFinite(Date.parse(fromRaw))) || (toRaw && !Number.isFinite(Date.parse(toRaw)))) {
      return send(res, 400, { error: 'bad request' });
    }
    // Legacy aliases are still validated when present.
    const rawLimit = sp.get('limit');
    if (rawLimit !== null && (!Number.isInteger(Number(rawLimit)) || Number(rawLimit) < 1 || Number(rawLimit) > 1000)) {
      return send(res, 400, { error: 'bad request' });
    }
    const rawSince = sp.get('since');
    if (rawSince && !Number.isFinite(Date.parse(rawSince))) return send(res, 400, { error: 'bad request' });
    const bucketSeconds = clampBucket(sp.get('bucket'));
    const { fromMs, toMs } = clampHistoryRange(fromRaw, toRaw);
    const fromDate = new Date(fromMs);
    const toDate = new Date(toMs);
    const { rows } = await q(
      'SELECT bucket_start, source, target, window_seconds, request_count, error_count, total_ms FROM traffic_samples WHERE bucket_start >= $1 AND bucket_start <= $2 ORDER BY bucket_start ASC',
      [fromDate, toDate],
    );
    return send(res, 200, {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      bucketSeconds,
      points: aggregateHistoryPoints(rows, bucketSeconds),
    });
  }
  return { history };
}
