// Pure helpers for the traffic graph. No React, no DOM: checked by graph.check.ts.

export type EdgeStat = {
  source: string
  target: string
  rps: number
  errorRate: number // fraction: 0.012 = 1.2%
  avgMs: number
}
export type CryptoCall = { at: number; path: string; status: number | 'timeout' | 'error'; ms: number; probe?: boolean }
export type TrafficResponse = { ts: number; edges: EdgeStat[]; down: string[]; cryptoCalls: CryptoCall[] }
export type HistoryPoint = { ts: number; edges: EdgeStat[] }
export type Level = 'idle' | 'good' | 'warning' | 'danger'
export type Selection = { kind: 'edge'; source: string; target: string } | { kind: 'node'; id: string }

export type GraphNode = { id: string; label: string; x: number; y: number }

// Static layout. Service IDs must match the backend recorder.
export const NODES: GraphNode[] = [
  { id: 'client', label: 'Client', x: 80, y: 190 },
  { id: 'frontend', label: 'Frontend', x: 240, y: 190 },
  { id: 'backend', label: 'Backend', x: 390, y: 190 },
  { id: 'crypto-service', label: 'crypto-api', x: 560, y: 190 },
  { id: 'db', label: 'db', x: 560, y: 320 },
]
export const ZONES = [
  { label: 'Edge', x0: 0, x1: 180 },
  { label: 'App', x0: 180, x1: 428 },
  { label: 'Internal', x0: 428, x1: 900 },
]
export const VIEW_W = 900
export const VIEW_H = 400
export const NODE_R = 30
export const HISTORY_MAX = 30 // 30 samples at 2 s = 1 min

export const LEVEL_LABEL: Record<Level, string> = {
  idle: 'Idle',
  good: 'Healthy',
  warning: 'Degraded',
  danger: 'Failing',
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
        ? h.edges.filter((e) => e.source === sel.source && e.target === sel.target)
        : h.edges.filter((e) => e.target === sel.id) // node = inbound traffic
    const rps = list.reduce((s, e) => s + e.rps, 0)
    const fails = list.reduce((s, e) => s + e.rps * e.errorRate, 0)
    return { ts: h.ts, rps, errorRate: rps > 0 ? fails / rps : 0 }
  })
}

// Edge trimmed to node circles so arrows stay outside the nodes. bend 0 = straight; bend != 0 = quadratic arc, control point offset sideways by bend.
export function edgePath(a: GraphNode, b: GraphNode, bend = 0) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const x1 = a.x + ux * NODE_R
  const y1 = a.y + uy * NODE_R
  const x2 = b.x - ux * NODE_R
  const y2 = b.y - uy * NODE_R
  const start = `M ${x1.toFixed(1)} ${y1.toFixed(1)}`
  if (!bend) return `${start} L ${x2.toFixed(1)} ${y2.toFixed(1)}`
  const cx = (x1 + x2) / 2 - uy * bend
  const cy = (y1 + y2) / 2 + ux * bend
  return `${start} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

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
  const down = Array.isArray(r.down) ? r.down.filter((d): d is string => typeof d === 'string') : []
  const ts = isNum(r.ts) ? r.ts : Math.floor(Date.now() / 1000)
  const cryptoCalls = Array.isArray(r.cryptoCalls) ? r.cryptoCalls.filter(isCall) : []
  return { ts, edges, down, cryptoCalls }
}
