// ponytail: topology uses fixed coordinates; horizontal scrolling preserves edge labels on narrow screens.
import { useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { Circle, CircleCheck, CircleX, TriangleAlert } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getMe } from '@/lib/session'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { Chip } from '@/components/chip'
import {
  edgeLevel,
  edgePath,
  LEVEL_COLOR,
  LEVEL_LABEL,
  NODE_R,
  NODES,
  particleMapping,
  seriesFor,
  VIEW_H,
  VIEW_W,
  ZONES,
  type CryptoCall,
  type EdgeStat,
  type HistoryPoint,
  type Level,
  type Selection,
} from './graph'
import { useTraffic } from './use-traffic'

const LEVEL_ICON = {
  idle: Circle,
  good: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
}
const RANK: Record<Level, number> = { idle: 0, good: 1, warning: 2, danger: 3 }
const nodeLabel = (id: string) => NODES.find((n) => n.id === id)?.label ?? id
const sameSel = (a: Selection | null, b: Selection) =>
  a?.kind === b.kind &&
  (a.kind === 'node'
    ? a.id === (b as { id: string }).id
    : a.source === (b as { source: string }).source &&
      a.target === (b as { target: string }).target)
const worse = (a: Level, b: Level) => (RANK[b] > RANK[a] ? b : a)

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

function nodeMetrics(id: string, edges: EdgeStat[], down: string[]) {
  const inbound = edges.filter((e) => e.target === id)
  const incident = edges.filter((e) => e.source === id || e.target === id)
  const rps = inbound.reduce((s, e) => s + e.rps, 0)
  const fails = inbound.reduce((s, e) => s + e.rps * e.errorRate, 0)
  const ms = inbound.reduce((s, e) => s + e.rps * e.avgMs, 0)
  let level: Level = down.includes(id) ? 'danger' : 'idle'
  for (const e of incident) level = worse(level, edgeLevel(e))
  return { rps, errorRate: rps > 0 ? fails / rps : 0, avgMs: rps > 0 ? ms / rps : 0, level }
}

function StatusTag({ level }: { level: Level }) {
  const Icon = LEVEL_ICON[level]
  return (
    <span className='inline-flex items-center gap-1.5 text-sm'>
      <Icon aria-hidden className='size-4' style={{ color: LEVEL_COLOR[level] }} />
      {LEVEL_LABEL[level]}
    </span>
  )
}

const pct = (r: number) => `${(r * 100).toFixed(1)}%`
const hms = (ts: number) => {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
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
  const pos = new Map(NODES.map((n) => [n.id, n]))
  const focus = hover ?? (selected?.kind === 'node' ? selected.id : null)
  const isSelEdge = (e: EdgeStat) => selected?.kind === 'edge' && selected.source === e.source && selected.target === e.target
  const linked = (id: string, e: EdgeStat) => (e.source === focus && e.target === id) || (e.target === focus && e.source === id)
  const activate = (ev: KeyboardEvent<SVGGElement>, s: Selection) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return
    ev.preventDefault()
    onSelect(s)
  }
  const focusRing = 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className='h-auto w-full min-w-[640px]' role='group' aria-label='Service traffic graph. Data also appears in the links table below.'>
      {ZONES.map((z) => (
        <g key={z.label}>
          <rect x={z.x0 + 4} y={4} width={z.x1 - z.x0 - 8} height={VIEW_H - 8} className='fill-muted/40' />
          <text x={z.x0 + 16} y={26} className='fill-muted-foreground text-xs'>{z.label}</text>
        </g>
      ))}
      {edges.map((e) => {
        const a = pos.get(e.source)
        const b = pos.get(e.target)
        if (!a || !b) return null
        const lvl = edgeLevel(e)
        const d = edgePath(a, b, e.source === 'client' && e.target === 'crypto-service' ? -140 : 0)
        const lit = !focus || e.source === focus || e.target === focus || isSelEdge(e)
        const { count, dur } = particleMapping(e.rps)
        return (
          <g
            key={`${e.source}>${e.target}`}
            opacity={lit ? 1 : 0.2}
            className={focusRing}
            role='button'
            tabIndex={0}
            aria-pressed={isSelEdge(e)}
            aria-label={`${e.source} to ${e.target}, ${e.rps.toFixed(1)} requests per second, ${pct(e.errorRate)} errors, ${e.avgMs.toFixed(0)} ms average`}
            onClick={() => onSelect({ kind: 'edge', source: e.source, target: e.target })}
            onKeyDown={(ev) => activate(ev, { kind: 'edge', source: e.source, target: e.target })}
          >
            <path d={d} fill='none' stroke='transparent' strokeWidth={18} />
            <path d={d} fill='none' style={{ stroke: LEVEL_COLOR[lvl] }} strokeWidth={isSelEdge(e) ? 4 : 2} strokeOpacity={e.rps > 0 ? 0.85 : 0.4} strokeDasharray={e.rps > 0 ? undefined : '4 6'} />
            {!reduced && Array.from({ length: count }, (_, i) => (
              <circle key={i} r={3.5} style={{ fill: LEVEL_COLOR[lvl] }}>
                <animateMotion dur={`${dur}s`} begin={`${(i * dur) / count}s`} repeatCount='indefinite' path={d} />
              </circle>
            ))}
          </g>
        )
      })}
      {NODES.map((n) => {
        const m = nodeMetrics(n.id, edges, down)
        const isSelNode = selected?.kind === 'node' && selected.id === n.id
        const lit = !focus || focus === n.id || edges.some((e) => linked(n.id, e))
        return (
          <g
            key={n.id}
            transform={`translate(${n.x} ${n.y})`}
            opacity={lit ? 1 : 0.25}
            className={focusRing}
            role='button'
            tabIndex={0}
            aria-pressed={isSelNode}
            aria-label={`${n.label}, ${LEVEL_LABEL[m.level]}, ${m.rps.toFixed(1)} requests per second in, ${pct(m.errorRate)} errors, ${m.avgMs.toFixed(0)} ms average`}
            onClick={() => onSelect({ kind: 'node', id: n.id })}
            onKeyDown={(ev) => activate(ev, { kind: 'node', id: n.id })}
            onPointerEnter={() => setHover(n.id)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(n.id)}
            onBlur={() => setHover(null)}
          >
            <circle r={NODE_R} style={{ fill: 'var(--card)', stroke: LEVEL_COLOR[m.level] }} strokeWidth={isSelNode ? 5 : 3} />
            <text y={NODE_R + 18} textAnchor='middle' className='fill-foreground text-sm'>{n.label}</text>
            <text y={NODE_R + 34} textAnchor='middle' className='fill-muted-foreground text-xs tabular-nums'>{`${LEVEL_LABEL[m.level]} · ${m.rps.toFixed(1)} rps in`}</text>
          </g>
        )
      })}
    </svg>
  )
}

function MiniChart({ title, values, dataClass }: { title: string; values: { t: string; v: number }[]; dataClass: string }) {
  return (
    <figure className='flex flex-col gap-2'>
      <figcaption className='text-sm font-medium'>{title}</figcaption>
      {values.length < 2 ? (
        <p className='text-sm text-muted-foreground'>PENDING · History across reloads is unavailable.</p>
      ) : (
        <div className='h-40 text-muted-foreground'>
          <ResponsiveContainer width='100%' height='100%'>
            <LineChart data={values} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke='currentColor' strokeOpacity={0.15} vertical={false} />
              <XAxis dataKey='t' tick={{ fontSize: 12, fill: 'currentColor' }} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tick={{ fontSize: 12, fill: 'currentColor' }} tickLine={false} axisLine={false} width={44} />
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
  cryptoCalls,
  isSuperAdmin,
  now,
}: {
  sel: Selection | null
  edges: EdgeStat[]
  down: string[]
  history: HistoryPoint[]
  cryptoCalls: CryptoCall[]
  isSuperAdmin: boolean
  now: number
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
  const isCrypto = sel?.kind === 'node' ? sel.id === 'crypto-service' : sel?.target === 'crypto-service'
  const cutoff = now - 60000
  const byPath = new Map<string, number>()
  for (const c of cryptoCalls) if (c.at >= cutoff) byPath.set(c.path, (byPath.get(c.path) ?? 0) + 1)

  return (
    <CardPanel title={title} meta='history: PENDING' className='min-w-0'>
      {m ? (
        <div className='grid grid-cols-2 gap-3 p-3 sm:grid-cols-4'>
          <div><p className='font-mono text-[8px] text-ink-3'>REQ / SEC</p><p className='font-mono text-sm tabular-nums'>{m.rps.toFixed(1)}</p></div>
          <div><p className='font-mono text-[8px] text-ink-3'>ERROR</p><p className='font-mono text-sm tabular-nums'>{pct(m.errorRate)}</p></div>
          <div><p className='font-mono text-[8px] text-ink-3'>AVG</p><p className='font-mono text-sm tabular-nums'>{m.avgMs.toFixed(0)} ms</p></div>
          <div><p className='font-mono text-[8px] text-ink-3'>STATUS</p><StatusTag level={m.level} /></div>
        </div>
      ) : <p className='px-3 py-3 text-sm text-muted-foreground'>Select a service or link to inspect the current snapshot.</p>}
      <div className='grid gap-4 border-t border-line p-3 sm:grid-cols-2'>
        <MiniChart title='Requests per second' values={rpsValues} dataClass='stroke-chart-1' />
        <MiniChart title='Error rate (%)' values={errValues} dataClass='stroke-chart-2' />
      </div>
      <p className='border-t border-line px-3 py-2 font-mono text-[9px] text-ink-3'>PENDING · History is in memory only and resets on reload.</p>
      {isCrypto && isSuperAdmin && (
        <section className='border-t border-line'>
          <header className='flex items-center justify-between gap-2 bg-surface-2 px-3 py-2'>
            <h3 className='font-mono text-[8.5px] uppercase tracking-[.08em]'>Crypto events</h3>
            <span className='font-mono text-[8px] text-ink-3'>last 50</span>
          </header>
          {byPath.size > 0 && <ul className='flex flex-wrap gap-x-5 gap-y-1 px-3 py-2 font-mono text-[9px]'>{[...byPath].map(([path, count]) => <li key={path}>{path}: {count}</li>)}</ul>}
          {cryptoCalls.length === 0 ? (
            <p className='px-3 py-3 text-sm text-muted-foreground'>No crypto-service events recorded in this process.</p>
          ) : (
            <div className='scroll-x overflow-x-auto'>
              <Table>
                <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Endpoint</TableHead><TableHead>Status</TableHead><TableHead className='text-right'>Duration</TableHead></TableRow></TableHeader>
                <TableBody>{cryptoCalls.map((c, i) => <TableRow key={`${c.at}-${i}`}>
                  <TableCell className='font-mono tabular-nums'>{hms(c.at)}</TableCell>
                  <TableCell className='font-mono'>{c.path}{c.probe === true && <span className='ml-2 text-xs text-muted-foreground'>health probe</span>}</TableCell>
                  <TableCell>{String(c.status)}</TableCell>
                  <TableCell className='text-right tabular-nums'>{c.ms} ms</TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </div>
          )}
          <p className='px-3 py-2 text-xs text-muted-foreground'>Backend memory only, up to 200 calls; resets on restart.</p>
        </section>
      )}
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
              eyebrow='OPERATIONS · SERVICE TRAFFIC'
              note={<span className='inline-flex items-center gap-2'><StatusDot tone={error ? 'warn' : 'pass'}>{error ? 'PAUSED · CONNECTION LOST' : 'LIVE · POLLING 2 DETIK'}</StatusDot>{updated && <time>{updated}</time>}</span>}
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
                    <button key={n.id} type='button' aria-pressed={selected} onClick={() => choose({ kind: 'node', id: n.id })} className={`flex min-h-11 min-w-0 items-center justify-between gap-2 border bg-surface px-3 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${selected ? 'border-line-strong' : 'border-line'}`}>
                      <span className='min-w-0'><span className='block truncate font-mono text-[10px] text-ink'>{n.id}</span><span className='mt-1 block'><StatusDot tone={m.level === 'good' ? 'pass' : m.level === 'warning' ? 'warn' : m.level === 'danger' ? 'fail' : 'ink'}>{LEVEL_LABEL[m.level]}</StatusDot></span></span>
                      <span className='font-mono text-[9px] tabular-nums text-ink-2'>{m.rps.toFixed(1)} rps</span>
                    </button>
                  )
                })}
              </div>

              <div className='grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,390px)]'>
                <CardPanel title='Stage graph' meta={`SNAPSHOT · ${updated ?? ''}`}>
                  <div className='scroll-x overflow-x-auto p-2' role='region' aria-label='Scrollable service graph'>
                    <Graph edges={edges} down={down} selected={sel} onSelect={choose} reduced={reduced} />
                  </div>
                  {historyAvailable === false && (
                    <p className='border-t border-line px-3 py-2 text-sm text-muted-foreground'>Riwayat trafik belum tersedia dari server</p>
                  )}
                  <p className='border-t border-line px-3 py-2 font-mono text-[9px] text-ink-3'>One current 10-second window. History across reloads is unavailable.</p>
                </CardPanel>

                <CardPanel title='Crypto events' meta={`${data.cryptoCalls.length} returned`} className='min-w-0'>
                  {data.cryptoCalls.length === 0 ? (
                    <p className='px-3 py-4 text-sm text-muted-foreground'>No crypto-service events recorded in this process.</p>
                  ) : (
                    <div className='scroll-x max-h-[360px] overflow-auto'>
                      <Table>
                        <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Endpoint</TableHead><TableHead>Status</TableHead><TableHead className='text-right'>ms</TableHead></TableRow></TableHeader>
                        <TableBody>{data.cryptoCalls.map((call, index) => <TableRow key={`${call.at}-${index}`}>
                          <TableCell className='whitespace-nowrap font-mono text-[10px] tabular-nums'>{hms(call.at)}</TableCell>
                          <TableCell className='font-mono text-[10px]'>{call.path}{call.probe && <span className='block text-[9px] text-muted-foreground'>health probe</span>}</TableCell>
                          <TableCell><Chip tone={call.status === 200 ? 'pass' : 'fail'}>{String(call.status)}</Chip></TableCell>
                          <TableCell className='text-right font-mono text-[10px] tabular-nums'>{call.ms}</TableCell>
                        </TableRow>)}</TableBody>
                      </Table>
                    </div>
                  )}
                  <p className='border-t border-line px-3 py-2 text-xs text-muted-foreground'>Backend in-memory log, last 200 calls, resets on restart.</p>
                </CardPanel>
              </div>

              <CardPanel title='Service links' meta='10-second window'>
                {edges.length === 0 ? <p className='px-3 py-4 text-sm text-muted-foreground'>No links in the current window.</p> : (
                  <div className='scroll-x overflow-x-auto'>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>DARI</TableHead><TableHead>KE</TableHead><TableHead>AKSES</TableHead><TableHead className='text-right'>ERROR</TableHead><TableHead className='text-right'>AVG</TableHead><TableHead>STATUS</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>{edges.map((e) => <TableRow key={`${e.source}>${e.target}`}>
                        <TableCell className='font-mono text-[10px]'>{e.source}</TableCell><TableCell className='font-mono text-[10px]'>{e.target}</TableCell>
                        <TableCell className='font-mono text-[10px] tabular-nums'>{e.rps.toFixed(1)} req/s</TableCell>
                        <TableCell className='text-right font-mono text-[10px] tabular-nums'>{pct(e.errorRate)}</TableCell>
                        <TableCell className='text-right font-mono text-[10px] tabular-nums'>{e.avgMs.toFixed(0)} ms</TableCell>
                        <TableCell><StatusDot tone={edgeLevel(e) === 'good' ? 'pass' : edgeLevel(e) === 'warning' ? 'warn' : edgeLevel(e) === 'danger' ? 'fail' : 'ink'}>{LEVEL_LABEL[edgeLevel(e)]}</StatusDot></TableCell>
                      </TableRow>)}</TableBody>
                    </Table>
                  </div>
                )}
              </CardPanel>

              <Detail sel={sel} edges={edges} down={down} history={history} cryptoCalls={data.cryptoCalls} isSuperAdmin={isSuperAdmin} now={(data.ts ?? 0) * 1000} />
            </>}
            <p className='font-mono text-[9px] text-ink-3'>Snapshot endpoint: 10-second aggregate. Local history exists only during this page session; cross-reload history: PENDING.</p>
          </>
        )}
      </Main>
    </>
  )
}
