// Pure helpers for the traffic graph. No React, no DOM: checked by graph.check.ts.

export type EdgeStat = {
  source: string
  target: string
  rps: number
  errorRate: number // fraction: 0.012 = 1.2%
  avgMs: number
}
export type CryptoCall = {
  at: number
  path: string
  status: number | 'timeout' | 'error'
  ms: number
  probe?: boolean
}
export type TrafficResponse = {
  ts: number
  edges: EdgeStat[]
  down: string[]
  cryptoCalls: CryptoCall[]
}
export type HistoryPoint = { ts: number; edges: EdgeStat[] }
export type HistoryResponse = {
  from: string | number
  to: string | number
  bucketSeconds: number
  points: HistoryPoint[]
}

export function parseHistory(raw: unknown): HistoryResponse | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.points)) return null
  const points: HistoryPoint[] = []
  for (const point of r.points) {
    if (!point || typeof point !== 'object') return null
    const p = point as Record<string, unknown>
    const ts = isNum(p.ts)
      ? p.ts
      : typeof p.ts === 'string'
        ? Math.floor(Date.parse(p.ts) / 1000)
        : NaN
    if (!Number.isFinite(ts) || !Array.isArray(p.edges)) return null
    points.push({ ts, edges: p.edges.filter(isEdge) })
  }
  return {
    from: typeof r.from === 'string' || isNum(r.from) ? r.from : '',
    to: typeof r.to === 'string' || isNum(r.to) ? r.to : '',
    bucketSeconds: isNum(r.bucketSeconds) ? r.bucketSeconds : 0,
    points,
  }
}

export function mergeHistory(
  existing: HistoryPoint[],
  incoming: HistoryPoint[],
  max: number
): HistoryPoint[] {
  const byTs = new Map<number, HistoryPoint>()
  for (const point of existing) byTs.set(point.ts, point)
  for (const point of incoming) byTs.set(point.ts, point)
  return [...byTs.values()].sort((a, b) => a.ts - b.ts).slice(-max)
}
export type Level = 'idle' | 'good' | 'warning' | 'danger'
export type Selection =
  | { kind: 'edge'; source: string; target: string }
  | { kind: 'node'; id: string }

export type GraphNode = { id: string; label: string; x: number; y: number } // x, y: top-left of the card

export const NODE_W = 152
export const NODE_H = 50
// Pen frame layout; service IDs must match the backend recorder.
export const NODES: GraphNode[] = [
  { id: 'client', label: 'client', x: 24, y: 120 },
  { id: 'frontend', label: 'frontend', x: 196, y: 120 },
  { id: 'backend', label: 'backend', x: 392, y: 120 },
  { id: 'crypto-service', label: 'crypto-service', x: 716, y: 38 },
  { id: 'db', label: 'db', x: 716, y: 196 },
]
export const VIEW_W = 892
export const VIEW_H = 270
export const HISTORY_MAX = 120 // 120 samples: 60 prefill + 60 live

// Orthogonal route per known link. x, y: baseline of the first of two label lines.
// ponytail: hand-placed for the known links; an unknown link stays in the table but is not drawn.
export type Route = {
  d: string
  x: number
  y: number
  anchor: 'start' | 'middle'
}
export const ROUTES: Record<string, Route> = {
  'client>frontend': { d: 'M176 145 H196', x: 186, y: 108, anchor: 'middle' },
  'frontend>backend': { d: 'M348 145 H392', x: 370, y: 108, anchor: 'middle' },
  'backend>crypto-service': {
    d: 'M544 145 H600 V63 H716',
    x: 616,
    y: 55,
    anchor: 'middle',
  },
  'backend>db': {
    d: 'M544 145 H600 V221 H716',
    x: 616,
    y: 213,
    anchor: 'middle',
  },
  'client>crypto-service': {
    d: 'M100 120 V63 H716',
    x: 408,
    y: 55,
    anchor: 'middle',
  },
}

// Keeps an edge label fully inside the viewBox so it is never clipped at the panel edge.
export const LABEL_PAD = 4
export function clampLabelX(
  x: number,
  anchor: Route['anchor'],
  labelWidth: number
) {
  const left =
    anchor === 'start'
      ? x
      : anchor === 'middle'
        ? x - labelWidth / 2
        : x - labelWidth
  const shift =
    Math.min(Math.max(left, LABEL_PAD), VIEW_W - LABEL_PAD - labelWidth) - left
  return x + shift
}

export const LEVEL_LABEL: Record<Level, string> = {
  idle: 'Idle',
  good: 'Sehat',
  warning: 'Menurun',
  danger: 'Gagal',
}
export const LEVEL_COLOR: Record<Level, string> = {
  idle: 'var(--viz-neutral)',
  good: 'var(--viz-good)',
  warning: 'var(--viz-warning)',
  danger: 'var(--viz-danger)',
}

export function edgeLevel(e: Pick<EdgeStat, 'rps' | 'errorRate'>): Level {
  if (e.rps <= 0) return 'idle'
  if (e.errorRate > 0.05) return 'danger'
  if (e.errorRate > 0.01) return 'warning'
  return 'good'
}

// ponytail: fixed thresholds (1%, 5%); move to backend config if teams need others.
export function particleMapping(rps: number) {
  const r = rps > 0 ? rps : 0
  return {
    count: r === 0 ? 0 : Math.min(6, Math.ceil(r / 10)),
    dur: Math.max(0.8, 3 - Math.log10(r + 1)),
  }
}

export function pushHistory<T>(buf: T[], item: T, max: number): T[] {
  const next = [...buf, item]
  return next.length > max ? next.slice(next.length - max) : next
}

export function seriesFor(history: HistoryPoint[], sel: Selection) {
  return history.map((h) => {
    const list =
      sel.kind === 'edge'
        ? h.edges.filter(
            (e) => e.source === sel.source && e.target === sel.target
          )
        : h.edges.filter((e) => e.target === sel.id) // node = inbound traffic
    const rps = list.reduce((s, e) => s + e.rps, 0)
    const fails = list.reduce((s, e) => s + e.rps * e.errorRate, 0)
    return { ts: h.ts, rps, errorRate: rps > 0 ? fails / rps : 0 }
  })
}

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

function isEdge(x: unknown): x is EdgeStat {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  return (
    typeof e.source === 'string' &&
    typeof e.target === 'string' &&
    isNum(e.rps) &&
    e.rps >= 0 &&
    isNum(e.errorRate) &&
    e.errorRate >= 0 &&
    e.errorRate <= 1 &&
    isNum(e.avgMs) &&
    e.avgMs >= 0
  )
}

function isCall(x: unknown): x is CryptoCall {
  if (!x || typeof x !== 'object') return false
  const c = x as Record<string, unknown>
  return (
    isNum(c.at) &&
    c.at >= 0 &&
    typeof c.path === 'string' &&
    (isNum(c.status) || c.status === 'timeout' || c.status === 'error') &&
    isNum(c.ms) &&
    c.ms >= 0 &&
    (c.probe === undefined || typeof c.probe === 'boolean')
  )
}

// Trust boundary: backend JSON is validated; bad edges and crypto calls are dropped, not rendered.
export function parseTraffic(raw: unknown): TrafficResponse | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.edges)) return null
  const edges = r.edges.filter(isEdge)
  const down = Array.isArray(r.down)
    ? r.down.filter((d): d is string => typeof d === 'string')
    : []
  const ts = isNum(r.ts) ? r.ts : Math.floor(Date.now() / 1000)
  const cryptoCalls = Array.isArray(r.cryptoCalls)
    ? r.cryptoCalls.filter(isCall)
    : []
  return { ts, edges, down, cryptoCalls }
}
