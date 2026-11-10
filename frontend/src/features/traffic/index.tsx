// ponytail: static node layout, no zoom or pan; edge labels live in the table, not on the graph (they collide).
import { useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { Circle, CircleCheck, CircleX, TriangleAlert } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { getMe } from '@/lib/session'
import { useTraffic } from './use-traffic'

const LEVEL_ICON = { idle: Circle, good: CircleCheck, warning: TriangleAlert, danger: CircleX }
const RANK: Record<Level, number> = { idle: 0, good: 1, warning: 2, danger: 3 }
const worse = (a: Level, b: Level) => (RANK[b] > RANK[a] ? b : a)
const touchClass = 'min-h-11 min-w-11'
const nodeLabel = (id: string) => NODES.find((n) => n.id === id)?.label ?? id
const sameSel = (a: Selection | null, b: Selection) =>
  a?.kind === b.kind &&
  (a.kind === 'node'
    ? a.id === (b as { id: string }).id
    : a.source === (b as { source: string }).source &&
      a.target === (b as { target: string }).target)

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
  return {
    rps,
    errorRate: rps > 0 ? fails / rps : 0,
    avgMs: rps > 0 ? ms / rps : 0,
    level,
  }
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
  const isSelEdge = (e: EdgeStat) =>
    selected?.kind === 'edge' && selected.source === e.source && selected.target === e.target
  const linked = (id: string, e: EdgeStat) =>
    (e.source === focus && e.target === id) || (e.target === focus && e.source === id)
  const activate = (ev: KeyboardEvent<SVGGElement>, s: Selection) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return
    ev.preventDefault()
    onSelect(s)
  }
  const focusRing = 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className='h-auto min-w-[640px] w-full'
      role='group'
      aria-label='Service traffic graph. The same data is listed in the tables below.'
    >
      {ZONES.map((z) => (
        <g key={z.label}>
          <rect
            x={z.x0 + 4}
            y={4}
            width={z.x1 - z.x0 - 8}
            height={VIEW_H - 8}
            rx={12}
            className='fill-muted/40'
          />
          <text x={z.x0 + 16} y={26} className='fill-muted-foreground text-xs'>
            {z.label}
          </text>
        </g>
      ))}

      {edges.map((e) => {
        const a = pos.get(e.source)
        const b = pos.get(e.target)
        if (!a || !b) return null
        const lvl = edgeLevel(e)
        const color = LEVEL_COLOR[lvl]
        // client -> crypto-service runs past frontend and backend on the same row; arc it above.
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
            <path
              d={d}
              fill='none'
              style={{ stroke: color }}
              strokeWidth={isSelEdge(e) ? 4 : 2}
              strokeOpacity={e.rps > 0 ? 0.85 : 0.4}
              strokeDasharray={e.rps > 0 ? undefined : '4 6'}
            />
            {!reduced &&
              Array.from({ length: count }, (_, i) => (
                <circle key={i} r={3.5} style={{ fill: color }}>
                  <animateMotion
                    dur={`${dur}s`}
                    begin={`${(i * dur) / count}s`}
                    repeatCount='indefinite'
                    path={d}
                  />
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
            <circle
              r={NODE_R}
              style={{ fill: 'var(--card)', stroke: LEVEL_COLOR[m.level] }}
              strokeWidth={isSelNode ? 5 : 3}
            />
            <text y={NODE_R + 18} textAnchor='middle' className='fill-foreground text-sm'>
              {n.label}
            </text>
            <text y={NODE_R + 34} textAnchor='middle' className='fill-muted-foreground text-xs tabular-nums'>
              {`${LEVEL_LABEL[m.level]} · ${m.rps.toFixed(1)} rps in`}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function MiniChart({
  title,
  values,
  dataClass,
}: {
  title: string
  values: { t: string; v: number }[]
  dataClass: string
}) {
  return (
    <figure className='flex flex-col gap-2'>
      <figcaption className='text-sm font-medium'>{title}</figcaption>
      {values.length < 2 ? (
        <p className='text-sm text-muted-foreground'>Collecting samples.</p>
      ) : (
        <div className='h-40 text-muted-foreground'>
          <ResponsiveContainer width='100%' height='100%'>
            <LineChart data={values} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke='currentColor' strokeOpacity={0.15} vertical={false} />
              <XAxis
                dataKey='t'
                tick={{ fontSize: 12, fill: 'currentColor' }}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
              />
              <YAxis
                tick={{ fontSize: 12, fill: 'currentColor' }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--card)',
                  border: '1px solid var(--border)',
                  color: 'var(--card-foreground)',
                  borderRadius: 8,
                }}
              />
              <Line
                type='monotone'
                dataKey='v'
                name={title}
                className={dataClass}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
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
  if (!sel) {
    return (
      <div data-glass-panel>
        <Card className='border-0 bg-transparent shadow-none'>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-muted-foreground'>
              Select a service or a link in the graph, service list or table to see its history.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const title =
    sel.kind === 'node' ? nodeLabel(sel.id) : `${nodeLabel(sel.source)} to ${nodeLabel(sel.target)}`
  const edge =
    sel.kind === 'edge'
      ? edges.find((e) => e.source === sel.source && e.target === sel.target)
      : undefined
  const m =
    sel.kind === 'node'
      ? nodeMetrics(sel.id, edges, down)
      : edge
        ? { rps: edge.rps, errorRate: edge.errorRate, avgMs: edge.avgMs, level: edgeLevel(edge) }
        : undefined
  const series = seriesFor(history, sel)
  const time = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour12: false })
  const rpsValues = series.map((p) => ({ t: time(p.ts), v: Number(p.rps.toFixed(2)) }))
  const errValues = series.map((p) => ({ t: time(p.ts), v: Number((p.errorRate * 100).toFixed(2)) }))
  const isCrypto = sel.kind === 'node' ? sel.id === 'crypto-service' : sel.target === 'crypto-service'
  const cutoff = now - 60000
  const byPath = new Map<string, number>()
  for (const c of cryptoCalls) {
    if (c.at >= cutoff) byPath.set(c.path, (byPath.get(c.path) ?? 0) + 1)
  }

  return (
    <div data-glass-panel>
      <Card className='border-0 bg-transparent shadow-none'>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-5'>
          {m ? (
            <dl className='grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4'>
              <div>
                <dt className='text-muted-foreground'>{sel.kind === 'node' ? 'In rps' : 'rps'}</dt>
                <dd className='font-mono tabular-nums'>{m.rps.toFixed(1)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>Error rate</dt>
                <dd className='font-mono tabular-nums'>{pct(m.errorRate)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>Avg ms</dt>
                <dd className='font-mono tabular-nums'>{m.avgMs.toFixed(0)}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>Status</dt>
                <dd>
                  <StatusTag level={m.level} />
                </dd>
              </div>
            </dl>
          ) : (
            <p className='text-sm text-muted-foreground'>No traffic in the current window.</p>
          )}
          <MiniChart title='Requests per second' values={rpsValues} dataClass='stroke-chart-1' />
          <MiniChart title='Error rate (%)' values={errValues} dataClass='stroke-chart-2' />
          {isCrypto && isSuperAdmin && (
            <section className='flex flex-col gap-2'>
              <h3 className='text-sm font-medium'>crypto-api activity</h3>
              {byPath.size === 0 ? (
                <p className='text-sm text-muted-foreground'>0 calls in the last 60 s.</p>
              ) : (
                <ul className='flex flex-col gap-1 text-sm'>
                  {[...byPath].map(([path, count]) => (
                    <li key={path} className='flex justify-between gap-4'>
                      <span className='font-mono'>{path}</span>
                      <span className='tabular-nums'>{count}</span>
                    </li>
                  ))}
                </ul>
              )}
              {cryptoCalls.length === 0 ? (
                <p className='text-sm text-muted-foreground'>
                  No crypto-api calls yet. Calls appear here as the app reads or protects data.
                </p>
              ) : (
                <div data-slot='table-container' className='rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='px-1.5'>Time</TableHead>
                        <TableHead className='px-1.5'>Endpoint</TableHead>
                        <TableHead className='px-1.5'>Status</TableHead>
                        <TableHead className='px-1.5 text-right'>Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cryptoCalls.map((c, i) => (
                        <TableRow key={`${c.at}-${i}`}>
                          <TableCell className='px-1.5 tabular-nums'>{hms(c.at)}</TableCell>
                          <TableCell className='px-1.5'>
                            <span className='font-mono'>{c.path}</span>
                            {c.probe === true && (
                              <span className='ml-2 text-xs text-muted-foreground'>health probe</span>
                            )}
                          </TableCell>
                          <TableCell className='px-1.5'>{String(c.status)}</TableCell>
                          <TableCell className='px-1.5 text-right tabular-nums'>{`${c.ms} ms`}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className='text-xs text-muted-foreground'>
                Backend-side log, in memory, last 200 calls, resets on restart. Calls from seed scripts run in their own process and are not listed.
              </p>
            </section>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function Traffic() {
  const { data, history, error, loading } = useTraffic(2000)
  const isSuperAdmin = getMe()?.superAdmin === true
  const [sel, setSel] = useState<Selection | null>(null)
  const reduced = useReducedMotion()
  const edges = data?.edges ?? []
  const down = data?.down ?? []
  const choose = (s: Selection) => setSel((prev) => (prev && sameSel(prev, s) ? null : s))
  const sorted = [...edges].sort((a, b) => b.rps - a.rps)
  const updated = data ? new Date(data.ts * 1000).toLocaleTimeString() : null

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='focus-strong flex flex-1 flex-col gap-6'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>Service traffic</h1>
          <p className='text-muted-foreground'>
            Live requests between services, refreshed every 2 seconds.
            {updated && <span className='tabular-nums'> Updated {updated}.</span>}
          </p>
        </div>

        {error && !data && (
          <Alert variant='destructive' role='alert'>
            <TriangleAlert />
            <AlertTitle>Traffic unavailable</AlertTitle>
            <AlertDescription>Could not load /api/traffic. Retrying every 2 seconds.</AlertDescription>
          </Alert>
        )}
        {error && data && (
          <p role='status' className='text-sm text-muted-foreground'>
            Connection lost. Showing data from {updated}. Retrying.
          </p>
        )}

        {loading ? (
          <Skeleton className='h-[400px] w-full' />
        ) : (
          <>
            {data && edges.length === 0 && down.length === 0 && (
              <p className='text-muted-foreground'>No traffic in the last 10 s</p>
            )}
            <div className='flex flex-wrap gap-2' role='group' aria-label='Services'>
              {NODES.map((n) => {
                const m = nodeMetrics(n.id, edges, down)
                return (
                  <Button
                    key={n.id}
                    variant='outline'
                    className={touchClass}
                    aria-pressed={sel?.kind === 'node' && sel.id === n.id}
                    onClick={() => choose({ kind: 'node', id: n.id })}
                  >
                    <span className='font-mono'>{n.label}</span>
                    <StatusTag level={m.level} />
                  </Button>
                )
              })}
            </div>
            <div data-glass-panel className='overflow-x-auto p-3'>
              <Graph
                edges={edges}
                down={down}
                selected={sel}
                onSelect={choose}
                reduced={reduced}
              />
            </div>
          </>
        )}

        <p className='text-sm'>
          Healthy: under 1% errors. Degraded: 1% to 5%. Failing: over 5% or service down. Idle: no
          requests in the window. Each status also appears as text.
        </p>

        <div className='grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
          <Detail
            sel={sel}
            edges={edges}
            down={down}
            history={history}
            cryptoCalls={data?.cryptoCalls ?? []}
            isSuperAdmin={isSuperAdmin}
            now={(data?.ts ?? 0) * 1000}
          />

          <section className='flex min-w-0 flex-col gap-2'>
            <h2 className='text-xl font-semibold'>Links</h2>
            <div data-slot='table-container' className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='px-1.5'>From</TableHead>
                    <TableHead className='px-1.5'>To</TableHead>
                    <TableHead className='px-1.5 text-right'>rps</TableHead>
                    <TableHead className='px-1.5 text-right'>Errors</TableHead>
                    <TableHead className='px-1.5 text-right'>Avg ms</TableHead>
                    <TableHead className='px-1.5'>Status</TableHead>
                    <TableHead>
                      <span className='sr-only'>Details</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((e) => {
                    const isSel =
                      sel?.kind === 'edge' && sel.source === e.source && sel.target === e.target
                    return (
                      <TableRow key={`${e.source}>${e.target}`}>
                        <TableCell className='px-1.5 font-mono'>{e.source}</TableCell>
                        <TableCell className='px-1.5 font-mono'>{e.target}</TableCell>
                        <TableCell className='px-1.5 text-right tabular-nums'>{e.rps.toFixed(1)}</TableCell>
                        <TableCell className='px-1.5 text-right tabular-nums'>{pct(e.errorRate)}</TableCell>
                        <TableCell className='px-1.5 text-right tabular-nums'>{e.avgMs.toFixed(0)}</TableCell>
                        <TableCell className='px-1.5'>
                          <StatusTag level={edgeLevel(e)} />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant='link'
                            className={`${touchClass} px-2`}
                            aria-pressed={isSel}
                            aria-label={`Show details for ${e.source} to ${e.target}`}
                            onClick={() => choose({ kind: 'edge', source: e.source, target: e.target })}
                          >
                            Show
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {sorted.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className='text-muted-foreground'>
                        No links in the current window.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {down.length > 0 && (
              <p className='text-sm'>
                Unreachable services: <span className='font-mono'>{down.join(', ')}</span>
              </p>
            )}
          </section>
        </div>

        <p className='text-sm text-muted-foreground'>
          In-memory, 10 s window, resets on restart. Endpoint has no auth (app has no auth yet).
        </p>
      </Main>
    </>
  )
}
