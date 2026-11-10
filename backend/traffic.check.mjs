// Self-check: traffic recorder, prune window, zero defaults, remote validation.
import assert from 'node:assert/strict';
import { record, snapshot, ownSnapshot, validateRemote, recordCrypto, cryptoLog, EDGES } from './traffic.mjs';

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

console.log('traffic ok');
