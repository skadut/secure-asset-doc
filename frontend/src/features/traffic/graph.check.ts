// Self-check. Run: node --experimental-strip-types src/features/traffic/graph.check.ts
// @ts-expect-error node types are not in tsconfig.app.json include scope
import assert from 'node:assert/strict'
import {
  edgeLevel,
  parseTraffic,
  particleMapping,
  pushHistory,
  seriesFor,
  NODES,
  type HistoryPoint,
} from './graph.ts'

// level thresholds: 1% and 5%, idle when no rps
assert.equal(edgeLevel({ rps: 0, errorRate: 0.5 }), 'idle')
assert.equal(edgeLevel({ rps: 5, errorRate: 0 }), 'good')
assert.equal(edgeLevel({ rps: 5, errorRate: 0.01 }), 'good')
assert.equal(edgeLevel({ rps: 5, errorRate: 0.02 }), 'warning')
assert.equal(edgeLevel({ rps: 5, errorRate: 0.05 }), 'warning')
assert.equal(edgeLevel({ rps: 5, errorRate: 0.06 }), 'danger')

// particle mapping: count and speed
assert.equal(particleMapping(0).count, 0)
assert.equal(particleMapping(1).count, 1)
assert.equal(particleMapping(10).count, 1)
assert.equal(particleMapping(11).count, 2)
assert.equal(particleMapping(1000).count, 6)
assert.equal(particleMapping(0).dur, 3)
assert.ok(particleMapping(1e9).dur >= 0.8)
assert.ok(particleMapping(100).dur < particleMapping(1).dur, 'more traffic is faster')

// ring buffer keeps the newest items
assert.deepEqual(pushHistory([1, 2], 3, 2), [2, 3])
assert.deepEqual(pushHistory([1], 2, 5), [1, 2])

// node ids are unique
assert.equal(new Set(NODES.map((n) => n.id)).size, NODES.length)

// series: edge vs inbound node, error rate is weighted by rps
const history: HistoryPoint[] = [
  {
    ts: 1,
    edges: [
      { source: 'client', target: 'backend', rps: 10, errorRate: 0.1, avgMs: 5 },
      { source: 'backend', target: 'db', rps: 30, errorRate: 0, avgMs: 2 },
    ],
  },
]
assert.deepEqual(seriesFor(history, { kind: 'edge', source: 'client', target: 'backend' }), [
  { ts: 1, rps: 10, errorRate: 0.1 },
])
assert.deepEqual(seriesFor(history, { kind: 'node', id: 'db' }), [
  { ts: 1, rps: 30, errorRate: 0 },
])
assert.deepEqual(seriesFor(history, { kind: 'node', id: 'client' }), [
  { ts: 1, rps: 0, errorRate: 0 },
])

// parse: bad edges dropped, bad shape rejected
assert.equal(parseTraffic(null), null)
assert.equal(parseTraffic({ edges: 'x' }), null)
const parsed = parseTraffic({
  ts: 5,
  edges: [
    { source: 'a', target: 'b', rps: 1, errorRate: 0.2, avgMs: 3 },
    { source: 'a', target: 'b', rps: 1, errorRate: 2, avgMs: 3 },
    { source: 'a', target: 9, rps: 1, errorRate: 0, avgMs: 3 },
  ],
  down: ['db', 7],
})
assert.equal(parsed?.edges.length, 1)
assert.deepEqual(parsed?.down, ['db'])
