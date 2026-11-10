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

export function record(source, target, { failed, ms }, now = Date.now()) {
  const secs = edges.get(key(source, target));
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
