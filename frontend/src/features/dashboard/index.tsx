import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  assets,
  auditEvents,
  csfSubcategories,
  documents,
  evidenceLinks,
  TODAY,
  type AuditEvent,
} from '@/data/grc'
import { coverage } from '@/lib/grc'
import { listAccessRequests } from '@/lib/access-api'
import { getMe } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { DocStatusBadge, ReviewStatusBadge } from '@/components/status-badge'
import { PageHead } from '@/components/page-head'
import { StatStrip } from '@/components/stat-strip'
import { CardPanel } from '@/components/card-panel'
import { TlpMark } from '@/components/tlp-mark'
import { StatusDot } from '@/components/status-dot'
import { Chip } from '@/components/chip'
import { EmptyState } from '@/components/empty-state'

const DAY_MS = 86_400_000
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS)
const daysFromToday = (date: string) => dayNumber(date) - dayNumber(TODAY)
const dueLabel = (days: number) => days < 0 ? 'Terlambat' : days === 0 ? 'Hari ini' : `Dalam ${days} hari`
const dateLabel = (date: string) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00Z`))

type DashboardHeatmapRow = { date: string; hour: number; cause: string; count: number }
type DashboardSummary = {
  generatedAt?: string
  sessions?: { active?: number }
  access?: {
    pending?: number
    decided?: number
    avgDecisionSeconds?: number | null
    denied7d?: number
    heatmap?: DashboardHeatmapRow[]
  }
  series?: { date: string; audit: number; documents?: number }[]
}

const isHeatmapRow = (row: unknown): row is DashboardHeatmapRow => {
  if (typeof row !== 'object' || row === null) return false
  const candidate = row as Partial<DashboardHeatmapRow>
  return typeof candidate.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate.date) && Number.isInteger(candidate.hour) && candidate.hour !== undefined && candidate.hour >= 0 && candidate.hour < 24 && typeof candidate.cause === 'string' && typeof candidate.count === 'number' && candidate.count >= 0
}

const formatDecisionSeconds = (seconds: number) => seconds < 60 ? `${Math.round(seconds)} detik` : seconds < 3600 ? `${(seconds / 60).toFixed(1)} menit` : `${(seconds / 3600).toFixed(1)} jam`

export function Dashboard() {
  const me = getMe()
  const canSeeRequests = Boolean(me?.can.access?.request || me?.can.access?.approve)
  const [now] = useState(() => Date.now())
  const requests = useQuery({ queryKey: ['access-requests'], queryFn: listAccessRequests, retry: false, enabled: canSeeRequests })
  const dashboardQuery = useQuery<DashboardSummary | null>({
    queryKey: ['dashboard-summary'],
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/dashboard/summary?days=14', { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: unknown = await res.json()
      if (typeof data !== 'object' || data === null) return null
      const candidate = data as DashboardSummary
      const seriesValid = Array.isArray(candidate.series) && candidate.series.every((row) => typeof row?.date === 'string' && typeof row?.audit === 'number' && Number.isFinite(row.audit))
      const heatmapValid = Array.isArray(candidate.access?.heatmap) && candidate.access.heatmap.every(isHeatmapRow)
      const sessionsValid = typeof candidate.sessions?.active === 'number'
      const accessValid = candidate.access === undefined || typeof candidate.access === 'object'
      if (!seriesValid && !heatmapValid && !sessionsValid && !accessValid) return null
      return candidate
    },
  })
  const summary = dashboardQuery.data
  const pending = requests.data?.filter((request) => request.status === 'pending') ?? []
  const heatmapRows = summary?.access?.heatmap?.filter(isHeatmapRow) ?? []
  const serverSeries = summary?.series?.filter((row) => typeof row?.date === 'string' && typeof row?.audit === 'number' && Number.isFinite(row.audit)) ?? []
  const hasServerSeries = serverSeries.length > 0
  const avgDecisionSeconds = summary?.access?.avgDecisionSeconds
  const avgDecisionValue = typeof avgDecisionSeconds === 'number' && Number.isFinite(avgDecisionSeconds) ? formatDecisionSeconds(avgDecisionSeconds) : 'Belum tersedia'
  const statRequestsValue = !canSeeRequests ? '—' : requests.isPending ? '…' : requests.isError ? '—' : pending.length
  const view = useMemo(() => {
    const reviewQueue = documents.map((doc) => ({ doc, days: daysFromToday(doc.nextReview) })).filter(({ days }) => days <= 30).sort((a, b) => a.days - b.days)
    const csfRows = csfSubcategories.map((subcategory) => ({ subcategory, state: coverage(subcategory.id, evidenceLinks, documents, TODAY) })).filter(({ state }) => state !== 'covered').sort((a, b) => Number(b.state === 'gap') - Number(a.state === 'gap'))
    const staleAssets = assets.filter((asset) => asset.criticality === 'high' && daysFromToday(asset.lastReviewed) < -365).sort((a, b) => a.lastReviewed.localeCompare(b.lastReviewed))
    const denied = auditEvents.filter((event) => event.action === 'access.denied')
    const cutoff = now - 7 * DAY_MS
    const deniedWeek = denied.filter((event) => Date.parse(event.at) >= cutoff && Date.parse(event.at) <= now).length
    const latest = [...auditEvents].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
    const countsByDay = new Map<string, number>()
    for (const event of auditEvents) {
      const day = event.at.slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) countsByDay.set(day, (countsByDay.get(day) ?? 0) + 1)
    }
    const fallbackActivity = Array.from({ length: 14 }, (_, offset) => {
      const date = new Date((dayNumber(TODAY) - 13 + offset) * DAY_MS).toISOString().slice(0, 10)
      return { date, count: countsByDay.get(date) ?? 0 }
    })
    return { reviewQueue, csfRows, staleAssets, deniedWeek, latest, activity: fallbackActivity }
  }, [now])
  const activity = hasServerSeries ? serverSeries.map((row) => ({ date: row.date, count: row.audit })) : view.activity

  return <>
    <Header><Search /><div className='ms-auto flex items-center gap-2'><ThemeSwitch /><ConfigDrawer /><ProfileDropdown /></div></Header>
    <Main>
      <div className='space-y-3'>
        <PageHead title='Apa yang perlu perhatian hari ini' eyebrow={`OVERVIEW / DASHBOARD · ${TODAY}`} note='Data dari /api/grc' actions={<Button asChild variant='outline' className='min-h-11 rounded-none'><Link to='/documents'>Buka registri</Link></Button>} />
        <section aria-label='Hal yang perlu perhatian' className='grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3'>
          <AttentionCard number={view.reviewQueue.length} label='Dokumen perlu tinjauan' detail={`${view.reviewQueue.filter(({ days }) => days < 0).length} terlambat · ${view.reviewQueue.filter(({ days }) => days >= 0).length} jatuh tempo dalam 30 hari`} to='/documents' tone='warn' />
          <AttentionCard number={view.csfRows.length} label='Subkategori CSF tanpa bukti terkini' detail={`${csfSubcategories.length} subkategori · ${view.csfRows.filter(({ state }) => state === 'gap').length} gap · ${view.csfRows.filter(({ state }) => state === 'partial').length} partial`} to='/evidence' tone='fail' />
          <AttentionCard number={view.staleAssets.length} label='Aset kritikal belum ditinjau' detail='Kritikalitas tinggi · tinjauan lebih dari 365 hari' to='/assets' />
        </section>
        <StatStrip items={[
          { label: 'Otorisasi ganda menunggu', value: statRequestsValue, sub: !canSeeRequests ? 'Tidak tersedia untuk izin akun ini' : requests.isError ? 'Gagal memuat permintaan' : 'Permintaan akses tertunda' },
          { label: 'Rata-rata waktu putusan', value: avgDecisionValue, sub: 'API tidak menyediakan durasi keputusan' },
          { label: 'Penolakan akses · 7 hari', value: view.deniedWeek, sub: 'Event access.denied pada audit' },
          { label: 'Sesi aktif sekarang', value: typeof summary?.sessions?.active === 'number' ? summary.sessions.active : 'Belum tersedia', sub: 'API GRC tidak memuat sesi aktif' },
        ]} />
      </div>

      <div className='mt-4 grid min-w-0 grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]'>
        <CardPanel title='Aktivitas audit per hari' meta={hasServerSeries ? '14 hari terakhir · /api/dashboard/summary' : '14 hari terakhir · hitungan dari timestamp auditEvents'}>
          {activity.some((day) => day.count > 0) ? <ActivityChart rows={activity} /> : <p className='p-4 text-sm text-ink-2'>Belum ada event audit dalam rentang ini.</p>}
        </CardPanel>
        <CardPanel title='Penolakan dan login gagal' meta='Hari × blok 4 jam'>
          {heatmapRows.length ? <Heatmap rows={heatmapRows} /> : <Unavailable title='Heatmap jam belum tersedia' description='Audit menyimpan waktu event, tetapi belum menyediakan agregasi login gagal per blok jam.' />}
        </CardPanel>
      </div>

      <div className='mt-4 grid min-w-0 grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]'>
        <CardPanel title='Antrean tinjauan dokumen' meta={`${view.reviewQueue.length} dokumen · terlambat atau jatuh tempo dalam 30 hari`} actions={<Link className='min-h-11 inline-flex items-center text-sm underline underline-offset-4' to='/documents'>Buka registri</Link>}>
          {view.reviewQueue.length ? <div className='overflow-x-auto'>
            <table className='w-full min-w-[620px] border-collapse text-left text-sm'>
              <thead><tr className='border-b border-line-strong font-mono text-[10px] text-ink-2'><th className='px-3 py-2 font-normal'>Dokumen</th><th className='px-3 py-2 font-normal'>TLP</th><th className='px-3 py-2 font-normal'>Status</th><th className='px-3 py-2 font-normal'>Tinjauan</th><th className='px-3 py-2 text-right font-normal'>Hari</th></tr></thead>
              <tbody>{view.reviewQueue.slice(0, 6).map(({ doc, days }) => <tr key={doc.id} className='border-b border-line last:border-0'>
                <td className='max-w-[240px] px-3 py-3'><Link className='font-mono text-xs underline underline-offset-4' to='/documents/$documentId' params={{ documentId: doc.id }}>{doc.id}</Link><span className='block truncate text-xs text-ink-2' title={doc.title}>{doc.title}</span></td>
                <td className='px-3 py-3'><TlpMark tlp={doc.tlp} /></td><td className='px-3 py-3'><DocStatusBadge status={doc.status} /></td>
                <td className='px-3 py-3 font-mono text-xs tabular-nums'>{doc.nextReview}<span className='block font-sans text-ink-2'><ReviewStatusBadge days={days} date={dueLabel(days)} /></span></td>
                <td className={`px-3 py-3 text-right font-mono text-xs tabular-nums ${days < 0 ? 'text-fail' : days <= 14 ? 'text-warn' : 'text-ink-2'}`}>{days > 0 ? '+' : ''}{days}</td>
              </tr>)}</tbody>
            </table>
          </div> : <EmptyState title='Tidak ada dokumen yang perlu ditinjau' desc='Semua tanggal tinjauan yang tersedia lebih dari 30 hari lagi.' />}
        </CardPanel>

        <div className='grid min-w-0 gap-3'>
          <CardPanel title='CSF tanpa bukti terkini' meta={`${view.csfRows.length} / ${csfSubcategories.length}`} actions={<Link className='min-h-11 inline-flex items-center text-xs underline underline-offset-4' to='/evidence'>Lihat bukti</Link>}>
            {view.csfRows.length ? view.csfRows.slice(0, 5).map(({ subcategory, state }) => <div key={subcategory.id} className='flex min-w-0 items-center justify-between gap-2 border-b border-line px-3 py-2.5 last:border-0'>
              <div className='min-w-0'><Link to='/evidence' hash={`subcategory-${subcategory.id}`} className='font-mono text-xs underline underline-offset-4'>{subcategory.id}</Link><p className='truncate text-xs text-ink-2' title={subcategory.outcome}>{subcategory.outcome}</p></div>
              <StatusDot tone={state === 'gap' ? 'fail' : 'warn'}>{state === 'gap' ? 'Gap' : 'Partial'}</StatusDot>
            </div>) : <p className='p-3 text-sm text-ink-2'>Semua subkategori memiliki bukti terkini.</p>}
          </CardPanel>
          <CardPanel title='Aktivitas terbaru' meta='Audit log'>
            {view.latest.length ? view.latest.map((event) => <div key={event.id} className='flex min-w-0 gap-3 border-b border-line px-3 py-2.5 last:border-0'>
              <time className='shrink-0 font-mono text-xs tabular-nums text-ink-2'>{new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(event.at))}</time>
              <div className='min-w-0'><p className='text-xs leading-5'>{event.summary}</p><p className='truncate font-mono text-[10px] text-ink-2'>{event.actor} · <ObjectLink event={event} /></p></div>
            </div>) : <p className='p-3 text-sm text-ink-2'>Belum ada aktivitas audit.</p>}
            <Link className='mx-3 my-2 inline-flex min-h-11 items-center text-xs underline underline-offset-4' to='/audit-log'>Buka audit log</Link>
          </CardPanel>
        </div>
      </div>

      {requests.isError && <p role='status' className='mt-3 border border-line p-3 text-sm text-ink-2'>Permintaan akses gagal dimuat. Ringkasan menunggu tidak tersedia.</p>}
      {requests.isPending && <p role='status' className='mt-3 text-sm text-ink-2'>Memuat permintaan akses…</p>}
      {!requests.isPending && !requests.isError && pending.length === 0 && me?.can.access?.request && <div className='mt-3'><Chip tone='line'>Tidak ada permintaan akses menunggu</Chip></div>}
    </Main>
  </>
}

function AttentionCard({ number, label, detail, to, tone = 'ink' }: { number: number; label: string; detail: string; to: '/documents' | '/evidence' | '/assets'; tone?: 'ink' | 'warn' | 'fail' }) {
  return <Link to={to} className='group min-w-0 border border-line bg-surface p-3.5 text-ink no-underline transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-strong'>
    <div className='flex items-start justify-between gap-2'><strong className={`font-[var(--head)] text-[30px] leading-none tabular-nums ${tone === 'ink' ? 'text-ink' : `text-${tone}`}`}>{number}</strong><span className='font-mono text-[9px] text-ink-3'>/api/grc</span></div>
    <span className='mt-2 block text-sm font-semibold'>{label}</span><span className='mt-1 block text-xs leading-5 text-ink-2'>{detail}</span>
  </Link>
}

function ActivityChart({ rows }: { rows: { date: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count))
  const width = 700
  const height = 172
  const gap = 5
  const barWidth = (width - gap * (rows.length - 1)) / rows.length
  return <div className='p-3'>
    <svg viewBox={`0 0 ${width} ${height}`} role='img' aria-label={`Aktivitas audit harian. Total ${rows.reduce((sum, row) => sum + row.count, 0)} event dalam 14 hari.`} className='block h-auto max-h-[220px] w-full'>
      {[0, 0.5, 1].map((fraction) => { const y = height - 20 - fraction * (height - 38); return <g key={fraction}><line x1='0' x2={width} y1={y} y2={y} stroke='var(--line)' strokeWidth='1' /><text x='0' y={y - 3} fill='var(--ink-2)' fontSize='10'>{Math.round(max * fraction)}</text></g> })}
      {rows.map((row, index) => { const h = row.count / max * (height - 38); const x = index * (barWidth + gap); return <g key={row.date}><title>{`${row.date}: ${row.count} event audit`}</title><rect x={x} y={height - 20 - h} width={barWidth} height={h} fill='var(--chart-1)' /><text x={x + barWidth / 2} y={height - 4} textAnchor='middle' fill='var(--ink-2)' fontSize='9'>{index % 2 === 0 || index === rows.length - 1 ? dateLabel(row.date) : ''}</text></g> })}
    </svg>
    <p className='mt-2 text-xs text-ink-2'>Jumlah event audit per tanggal, termasuk tanggal tanpa event (0). Bukan jumlah pembukaan dokumen.</p>
  </div>
}

function Heatmap({ rows }: { rows: DashboardHeatmapRow[] }) {
  const cells = new Map<string, { count: number; causes: Set<string> }>()
  for (const row of rows) {
    const key = `${row.date}:${row.hour}`
    const cell = cells.get(key) ?? { count: 0, causes: new Set<string>() }
    cell.count += row.count
    cell.causes.add(row.cause)
    cells.set(key, cell)
  }
  const dates = Array.from(new Set(rows.map((row) => row.date))).sort()
  const max = Math.max(1, ...Array.from(cells.values(), (cell) => cell.count))
  const total = Array.from(cells.values()).reduce((sum, cell) => sum + cell.count, 0)
  return <div className='overflow-x-auto p-3' role='img' aria-label={`Heatmap penolakan dan login gagal, total ${total} kejadian pada ${dates.length} tanggal`}>
    <div className='min-w-[620px] space-y-1'>
      {dates.map((date) => <div key={date} className='grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2'>
        <span className='font-mono text-[10px] text-ink-2'>{dateLabel(date)}</span>
        <div className='grid gap-px' style={{ gridTemplateColumns: 'repeat(24,minmax(0,1fr))' }}>
          {Array.from({ length: 24 }, (_, hour) => {
            const cell = cells.get(`${date}:${hour}`)
            const count = cell?.count ?? 0
            const cause = Array.from(cell?.causes ?? []).sort().join(', ')
            return <span key={hour} title={`${date} ${hour}:00 · ${cause}: ${count}`} className='aspect-square rounded-[1px] bg-[var(--chart-1)]' style={{ opacity: count ? Math.max(0.12, count / max) : 0.04 }} />
          })}
        </div>
      </div>)}
    </div>
  </div>
}

function Unavailable({ title, description }: { title: string; description: string }) {
  return <div className='min-h-36 p-3'><p className='text-sm font-medium text-ink'>{title}</p><p className='mt-1 max-w-prose text-xs leading-5 text-ink-2'>{description}</p></div>
}

function ObjectLink({ event }: { event: AuditEvent }) {
  if (event.objectType === 'asset') return <Link className='underline underline-offset-2' to='/assets/$assetId' params={{ assetId: event.objectId }}>{event.objectId}</Link>
  if (event.objectType === 'document') return <Link className='underline underline-offset-2' to='/documents/$documentId' params={{ documentId: event.objectId }}>{event.objectId}</Link>
  return <Link className='underline underline-offset-2' to='/audit-log'>{event.objectId}</Link>
}
