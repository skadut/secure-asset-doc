// ponytail: node positions and link routes are fixed; a link with no route stays in the table but is not drawn.
import { useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { Circle, CircleCheck, CircleX, TriangleAlert } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getMe } from '@/lib/session'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { CardPanel } from '@/components/card-panel'
import { PageHead } from '@/components/page-head'
import { EmptyState } from '@/components/empty-state'
import { SkeletonRows } from '@/components/skeleton-rows'
import { StatusDot } from '@/components/status-dot'
import {
  edgeLevel,
  LEVEL_LABEL,
  NODE_H,
  NODE_W,
  NODES,
  particleMapping,
  ROUTES,
  seriesFor,
  VIEW_H,
  VIEW_W,
  type EdgeStat,
  type HistoryPoint,
  type Level,
  type Selection,
} from './graph'
import { useTraffic } from './use-traffic'

const LEVEL_ICON = { idle: Circle, good: CircleCheck, warning: TriangleAlert, danger: CircleX }
const RANK: Record<Level, number> = { idle: 0, good: 1, warning: 2, danger: 3 }
const TONE = { idle: 'ink', good: 'pass', warning: 'warn', danger: 'fail' } as const
const TEXT = { idle: 'text-ink-3', good: 'text-pass', warning: 'text-warn', danger: 'text-fail' } as const
const FILL = { idle: 'fill-ink-3', good: 'fill-pass', warning: 'fill-warn', danger: 'fill-fail' } as const
const BG = { idle: 'bg-ink-3', good: 'bg-pass', warning: 'bg-warn', danger: 'bg-fail' } as const
const STROKE = { idle: 'stroke-line-2', good: 'stroke-line-2', warning: 'stroke-warn', danger: 'stroke-fail' } as const

const nodeLabel = (id: string) => NODES.find((n) => n.id === id)?.label ?? id
const sameSel = (a: Selection | null, b: Selection) =>
  a?.kind === b.kind &&
  (a.kind === 'node'
    ? a.id === (b as { id: string }).id
    : a.source === (b as { source: string }).source && a.target === (b as { target: string }).target)
const worse = (a: Level, b: Level) => (RANK[b] > RANK[a] ? b : a)
const pct = (r: number) => `${(r * 100).toFixed(1)}%`
const hms = (ts: number) => {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false
  )
}

// Node figures use inbound links; a node with no inbound link (client) falls back to its outbound links.
function nodeMetrics(id: string, edges: EdgeStat[], down: string[]) {
  const inbound = edges.filter((e) => e.target === id)
  const flow = inbound.length > 0 ? inbound : edges.filter((e) => e.source === id)
  const rps = flow.reduce((s, e) => s + e.rps, 0)
  const fails = flow.reduce((s, e) => s + e.rps * e.errorRate, 0)
  const ms = flow.reduce((s, e) => s + e.rps * e.avgMs, 0)
  let level: Level = down.includes(id) ? 'danger' : 'idle'
  for (const e of edges.filter((x) => x.source === id || x.target === id)) level = worse(level, edgeLevel(e))
  return { rps, errorRate: rps > 0 ? fails / rps : 0, avgMs: rps > 0 ? ms / rps : 0, level }
}

function StatusTag({ level }: { level: Level }) {
  const Icon = LEVEL_ICON[level]
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${TEXT[level]}`}>
      <Icon aria-hidden className='size-4' />
      {LEVEL_LABEL[level]}
    </span>
  )
}

function Graph({
  edges,
  down,
  selected,
  onSelect,
  reduced,
}: {
  edges: EdgeStat[]
  down: string[]
  selected: Selection | null
  onSelect: (s: Selection) => void
  reduced: boolean
}) {
  const [hover, setHover] = useState<string | null>(null)
  const focus = hover ?? (selected?.kind === 'node' ? selected.id : null)
  const byKey = new Map(edges.map((e) => [`${e.source}>${e.target}`, e]))
  const isSelEdge = (source: string, target: string) =>
    selected?.kind === 'edge' && selected.source === source && selected.target === target
  const activate = (ev: KeyboardEvent<SVGGElement>, s: Selection) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return
    ev.preventDefault()
    onSelect(s)
  }
  const focusRing = 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className='h-auto w-full min-w-[720px]' role='group' aria-label='Service traffic graph. Data also appears in the links table below.'>
      {Object.entries(ROUTES).map(([key, route]) => {
        const [source, target] = key.split('>')
        const e = byKey.get(key) ?? { source, target, rps: 0, errorRate: 0, avgMs: 0 }
        const lvl = edgeLevel(e)
        const lit = !focus || e.source === focus || e.target === focus || isSelEdge(source, target)
        const { count, dur } = particleMapping(e.rps)
        return (
          <g
            key={key}
            opacity={lit ? 1 : 0.2}
            className={focusRing}
            role='button'
            tabIndex={0}
            aria-pressed={isSelEdge(source, target)}
            aria-label={`${source} to ${target}, ${e.rps.toFixed(1)} requests per second, ${pct(e.errorRate)} errors, ${e.avgMs.toFixed(0)} ms average`}
            onClick={() => onSelect({ kind: 'edge', source, target })}
            onKeyDown={(ev) => activate(ev, { kind: 'edge', source, target })}
          >
            <path d={route.d} fill='none' stroke='transparent' strokeWidth={18} />
            <path
              d={route.d}
              fill='none'
              className={STROKE[lvl]}
              strokeWidth={isSelEdge(source, target) ? 3 : 1.5}
              strokeDasharray={e.rps > 0 ? undefined : '4 6'}
            />
            <text x={route.x} y={route.y} textAnchor={route.anchor} className={`font-mono text-[10px] tabular-nums ${TEXT[lvl]}`}>
              {`${e.rps.toFixed(1)} rps · ${pct(e.errorRate)} · ${e.avgMs.toFixed(0)} ms`}
            </text>
            {!reduced && e.rps > 0 && Array.from({ length: count }, (_, i) => (
              <circle key={i} r={3} className={FILL[lvl]}>
                <animateMotion dur={`${dur}s`} begin={`${(i * dur) / count}s`} repeatCount='indefinite' path={route.d} />
              </circle>
            ))}
          </g>
        )
      })}
      {NODES.map((n) => {
        const m = nodeMetrics(n.id, edges, down)
        const isSelNode = selected?.kind === 'node' && selected.id === n.id
        const lit = !focus || focus === n.id || edges.some((e) => (e.source === focus && e.target === n.id) || (e.target === focus && e.source === n.id))
        return (
          <g
            key={n.id}
            transform={`translate(${n.x} ${n.y})`}
            opacity={lit ? 1 : 0.25}
            className={focusRing}
            role='button'
            tabIndex={0}
            aria-pressed={isSelNode}
            aria-label={`${n.label}, ${LEVEL_LABEL[m.level]}, ${m.rps.toFixed(1)} requests per second, ${pct(m.errorRate)} errors, ${m.avgMs.toFixed(0)} ms average`}
            onClick={() => onSelect({ kind: 'node', id: n.id })}
            onKeyDown={(ev) => activate(ev, { kind: 'node', id: n.id })}
            onPointerEnter={() => setHover(n.id)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(n.id)}
            onBlur={() => setHover(null)}
          >
            <rect width={NODE_W} height={NODE_H} className={`fill-surface ${isSelNode ? 'stroke-line-strong' : 'stroke-line'}`} strokeWidth={isSelNode ? 2 : 1} />
            <circle cx={10} cy={15} r={3} className={FILL[m.level]} />
            <text x={20} y={19} className='fill-ink font-mono text-[10px] font-medium'>{n.label}</text>
            <text x={10} y={38} className='fill-ink-3 font-mono text-[9px] tabular-nums'>{`${m.rps.toFixed(1)} rps · ${m.avgMs.toFixed(0)} ms`}</text>
          </g>
        )
      })}
    </svg>
  )
}

function MiniChart({ title, values, dataClass, emptyText }: { title: string; values: { t: string; v: number }[]; dataClass: string; emptyText: string }) {
  return (
    <figure className='flex flex-col gap-2'>
      <figcaption className='font-mono text-[9px] uppercase tracking-[.08em] text-ink'>{title}</figcaption>
      {values.length < 2 ? (
        <p className='border border-dashed border-line px-3 py-6 text-center text-sm text-ink-2'>{emptyText}</p>
      ) : (
        <div className='h-40 text-ink-3'>
          <ResponsiveContainer width='100%' height='100%'>
            <LineChart data={values} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke='currentColor' strokeOpacity={0.15} vertical={false} />
              <XAxis dataKey='t' tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tick={{ fontSize: 11, fill: 'currentColor' }} tickLine={false} axisLine={false} width={44} />
              <Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', color: 'var(--card-foreground)', borderRadius: 0 }} />
              <Line type='monotone' dataKey='v' name={title} className={dataClass} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  )
}

function Detail({
  sel,
  edges,
  down,
  history,
  historyAvailable,
}: {
  sel: Selection | null
  edges: EdgeStat[]
  down: string[]
  history: HistoryPoint[]
  historyAvailable: boolean | null
}) {
  const title = !sel ? 'Snapshot details' : sel.kind === 'node' ? nodeLabel(sel.id) : `${nodeLabel(sel.source)} to ${nodeLabel(sel.target)}`
  const edge = sel?.kind === 'edge' ? edges.find((e) => e.source === sel.source && e.target === sel.target) : undefined
  const m = sel?.kind === 'node'
    ? nodeMetrics(sel.id, edges, down)
    : edge
      ? { rps: edge.rps, errorRate: edge.errorRate, avgMs: edge.avgMs, level: edgeLevel(edge) }
      : undefined
  const series = sel ? seriesFor(history, sel) : []
  const time = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour12: false })
  const rpsValues = series.map((p) => ({ t: time(p.ts), v: Number(p.rps.toFixed(2)) }))
  const errValues = series.map((p) => ({ t: time(p.ts), v: Number((p.errorRate * 100).toFixed(2)) }))
  const emptyText = historyAvailable === false
    ? 'Riwayat trafik belum tersedia dari server.'
    : sel
      ? 'Belum ada cukup titik riwayat. Riwayat terkumpul selama halaman ini terbuka.'
      : 'Pilih layanan atau link untuk melihat riwayat.'

  return (
    <CardPanel title={title} meta='Live window' className='min-w-0'>
      {m ? (
        <div className='grid grid-cols-2 gap-3 p-4 sm:grid-cols-4'>
          <div><p className='font-mono text-[8px] uppercase text-ink-3'>REQ / SEC</p><p className='font-mono text-sm tabular-nums'>{m.rps.toFixed(1)}</p></div>
          <div><p className='font-mono text-[8px] uppercase text-ink-3'>ERROR</p><p className='font-mono text-sm tabular-nums'>{pct(m.errorRate)}</p></div>
          <div><p className='font-mono text-[8px] uppercase text-ink-3'>AVG</p><p className='font-mono text-sm tabular-nums'>{m.avgMs.toFixed(0)} ms</p></div>
          <div><p className='font-mono text-[8px] uppercase text-ink-3'>STATUS</p><StatusTag level={m.level} /></div>
        </div>
      ) : <p className='px-4 py-4 text-sm text-ink-2'>Pilih layanan atau link untuk melihat snapshot saat ini.</p>}
      <div className='grid gap-4 border-t border-line p-4 sm:grid-cols-2'>
        <MiniChart title='Requests per second' values={rpsValues} dataClass='stroke-chart-1' emptyText={emptyText} />
        <MiniChart title='Error rate (%)' values={errValues} dataClass='stroke-chart-2' emptyText={emptyText} />
      </div>
    </CardPanel>
  )
}

export function Traffic() {
  const { data, history, error, forbidden, loading, historyAvailable } = useTraffic(2000)
  const isSuperAdmin = getMe()?.superAdmin === true
  const [sel, setSel] = useState<Selection | null>(null)
  const reduced = useReducedMotion()
  const edges = data?.edges ?? []
  const down = data?.down ?? []
  const choose = (s: Selection) => setSel((prev) => (prev && sameSel(prev, s) ? null : s))
  const updated = data ? new Date(data.ts * 1000).toLocaleTimeString() : null

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-4'>
        {forbidden || !isSuperAdmin ? (
          <Alert variant='destructive' role='alert'>
            <TriangleAlert />
            <AlertTitle>Hanya super admin</AlertTitle>
            <AlertDescription>Akun ini tidak memiliki izin membuka data service traffic.</AlertDescription>
          </Alert>
        ) : (
          <>
            <PageHead
              title='Service traffic'
              eyebrow='SUPER ADMIN · POLLING 2 DETIK'
              note={<span className='inline-flex items-center gap-3'><span>WINDOW 10 DETIK</span><StatusDot tone={error ? 'warn' : 'pass'}>{error ? 'PAUSED · CONNECTION LOST' : 'LIVE'}</StatusDot>{updated && <time>{updated}</time>}</span>}
            />
            {error && <Alert variant='destructive' role='alert'><TriangleAlert /><AlertTitle>Traffic endpoint unavailable</AlertTitle><AlertDescription>{data ? `Showing the last successful snapshot from ${updated}. Retrying every 2 seconds.` : 'Could not load /api/traffic. Retrying every 2 seconds.'}</AlertDescription></Alert>}
            {loading ? (
              <CardPanel title='Loading service snapshot'><div className='p-2'><SkeletonRows rows={3} cols={4} /></div></CardPanel>
            ) : data && edges.length === 0 && down.length === 0 ? (
              <EmptyState title='No traffic in the current window' desc='The endpoint returned no edge activity or unreachable services in its 10-second window.' />
            ) : null}

            {data && !loading && <>
              <div className='grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5' role='group' aria-label='Services'>
                {NODES.map((n) => {
                  const m = nodeMetrics(n.id, edges, down)
                  const selected = sel?.kind === 'node' && sel.id === n.id
                  return (
                    <button key={n.id} type='button' aria-pressed={selected} onClick={() => choose({ kind: 'node', id: n.id })} className={`flex min-h-11 min-w-0 items-center gap-3 border bg-surface px-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${selected ? 'border-line-strong' : 'border-line'}`}>
                      <span className={`size-[7px] shrink-0 rounded-full ${BG[m.level]}`} aria-hidden />
                      <span className='min-w-0'>
                        <span className='block truncate font-mono text-[10px] font-medium text-ink'>{n.label}</span>
                        <span className='mt-1 block'><StatusDot tone={TONE[m.level]}>{LEVEL_LABEL[m.level]}</StatusDot></span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className='grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,390px)]'>
                <CardPanel title='Topologi & edge' meta={updated ? `Terakhir ${updated}` : undefined} className='min-w-0'>
                  <div className='scroll-x overflow-x-auto p-3' role='region' aria-label='Scrollable service graph'>
                    <Graph edges={edges} down={down} selected={sel} onSelect={choose} reduced={reduced} />
                  </div>
                </CardPanel>

                <CardPanel title='Panggilan crypto-api' meta={`${data.cryptoCalls.length} terbaru`} className='min-w-0'>
                  {data.cryptoCalls.length === 0 ? (
                    <p className='px-4 py-4 text-sm text-ink-2'>No crypto-service events recorded in this process.</p>
                  ) : (
                    <div className='scroll-x max-h-[300px] overflow-auto'>
                      <Table>
                        <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Endpoint</TableHead><TableHead>Status</TableHead><TableHead className='text-right'>ms</TableHead></TableRow></TableHeader>
                        <TableBody>{data.cryptoCalls.map((call, index) => <TableRow key={`${call.at}-${index}`}>
                          <TableCell className='whitespace-nowrap font-mono text-[10px] tabular-nums text-ink-3'>{hms(call.at)}</TableCell>
                          <TableCell className='font-mono text-[10px] text-ink'>{call.path}{call.probe && <span className='block text-[9px] text-ink-3'>health probe</span>}</TableCell>
                          <TableCell className={`font-mono text-[10px] ${call.status === 200 ? 'text-pass' : 'text-fail'}`}>{String(call.status)}</TableCell>
                          <TableCell className='text-right font-mono text-[10px] tabular-nums text-ink-3'>{call.ms}</TableCell>
                        </TableRow>)}</TableBody>
                      </Table>
                    </div>
                  )}
                </CardPanel>
              </div>

              <CardPanel title='Service links' meta='Window 10 detik'>
                {edges.length === 0 ? <p className='px-4 py-4 text-sm text-ink-2'>No links in the current window.</p> : (
                  <div className='scroll-x overflow-x-auto'>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>DARI</TableHead><TableHead>KE</TableHead><TableHead className='text-right'>RPS</TableHead><TableHead className='text-right'>ERROR</TableHead><TableHead className='text-right'>AVG</TableHead><TableHead>STATUS</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>{edges.map((e) => {
                        const lvl = edgeLevel(e)
                        return <TableRow key={`${e.source}>${e.target}`}>
                          <TableCell className='font-mono text-[10px] text-ink'>{e.source}</TableCell>
                          <TableCell className='font-mono text-[10px] text-ink'>{e.target}</TableCell>
                          <TableCell className='text-right font-mono text-[10px] tabular-nums text-ink-2'>{e.rps.toFixed(1)}</TableCell>
                          <TableCell className={`text-right font-mono text-[10px] tabular-nums ${TEXT[lvl]}`}>{pct(e.errorRate)}</TableCell>
                          <TableCell className='text-right font-mono text-[10px] tabular-nums text-ink-2'>{e.avgMs.toFixed(0)} ms</TableCell>
                          <TableCell><StatusDot tone={TONE[lvl]}>{LEVEL_LABEL[lvl]}</StatusDot></TableCell>
                        </TableRow>
                      })}</TableBody>
                    </Table>
                  </div>
                )}
              </CardPanel>

              <Detail sel={sel} edges={edges} down={down} history={history} historyAvailable={historyAvailable} />
            </>}
            <p className='font-mono text-[9px] text-ink-3'>Snapshot endpoint: 10-second aggregate. History is kept in this page session only.</p>
          </>
        )}
      </Main>
    </>
  )
}
