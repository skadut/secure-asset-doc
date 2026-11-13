import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  assets,
  auditEvents,
  CSF_FUNCTIONS,
  csfSubcategories,
  documents,
  evidenceLinks,
  TODAY,
  type AuditEvent,
  type CsfFunction,
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
import { reviewScheduleRows, tlpRows } from './viz-data'

const DAY_MS = 86_400_000
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS)
const daysFromToday = (date: string) => dayNumber(date) - dayNumber(TODAY)
const dueLabel = (days: number) => days < 0 ? 'Terlambat' : days === 0 ? 'Hari ini' : `Dalam ${days} hari`
const dateLabel = (date: string) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00Z`))
const isoDay = (offset: number) => new Date((dayNumber(TODAY) + offset) * DAY_MS).toISOString().slice(0, 10)
const WEEK_DATES = Array.from({ length: 7 }, (_, index) => isoDay(index - 6))
const BLOCKS = ['00–03', '04–07', '08–11', '12–15', '16–19', '20–23']
const blockOf = (hour: number) => Math.floor(hour / 4)
// Heatmap cell level: 0 = none, 1, 2, 3 = three or more. Opacity of the --chart-1 fill per level.
const LEVEL_OPACITY = [0, 0.3, 0.6, 1]
const levelOf = (count: number) => Math.min(3, count)

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

type ExpiringGrant = { user: string; documentId: string; expiresAt: string }
const isExpiringGrant = (row: unknown): row is ExpiringGrant => {
  if (typeof row !== 'object' || row === null) return false
  const candidate = row as Partial<ExpiringGrant>
  return typeof candidate.user === 'string' && typeof candidate.documentId === 'string' && typeof candidate.expiresAt === 'string' && Number.isFinite(Date.parse(candidate.expiresAt))
}
// Under one day: hours. Otherwise whole days ahead, rounded up.
const expiryLabel = (expiresAt: string, now: number) => {
  const ms = Date.parse(expiresAt) - now
  return ms < DAY_MS ? `${Math.max(1, Math.round(ms / 3_600_000))} jam` : `+${Math.ceil(ms / DAY_MS)} hari`
}

const TONE_BORDER ={ ink: 'border-t-line-strong', warn: 'border-t-warn', fail: 'border-t-fail' } as const
const TONE_TEXT = { ink: 'text-ink', warn: 'text-warn', fail: 'text-fail' } as const

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
  // Same authz as /api/grants/expiring (L5 or security officer). Not requested otherwise, so no denied audit noise.
  const canSeeGrants = Boolean(me && (me.accessLevel === 5 || me.securityOfficer))
  const grants = useQuery<{ grants: ExpiringGrant[]; noExpiry: number }>({
    queryKey: ['grants-expiring'],
    enabled: canSeeGrants,
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/grants/expiring?days=30', { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: unknown = await res.json()
      const candidate = (typeof data === 'object' && data !== null ? data : {}) as { grants?: unknown; noExpiry?: unknown }
      return {
        grants: Array.isArray(candidate.grants) ? candidate.grants.filter(isExpiringGrant) : [],
        noExpiry: typeof candidate.noExpiry === 'number' && Number.isInteger(candidate.noExpiry) && candidate.noExpiry >= 0 ? candidate.noExpiry : 0,
      }
    },
  })
  const expiring = [...(grants.data?.grants ?? [])].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
  const noExpiry = grants.data?.noExpiry ?? 0

  const view = useMemo(() => {
    const reviewQueue = documents.map((doc) => ({ doc, days: daysFromToday(doc.nextReview) })).filter(({ days }) => days <= 30).sort((a, b) => a.days - b.days)
    const csfRows = csfSubcategories.map((subcategory) => ({ subcategory, state: coverage(subcategory.id, evidenceLinks, documents, TODAY) })).filter(({ state }) => state !== 'covered').sort((a, b) => Number(b.state === 'gap') - Number(a.state === 'gap'))
    const csfByFunction = (Object.keys(CSF_FUNCTIONS) as CsfFunction[]).map((fn) => {
      const states = csfSubcategories.filter((sub) => sub.fn === fn).map((sub) => coverage(sub.id, evidenceLinks, documents, TODAY))
      return { fn, name: CSF_FUNCTIONS[fn], total: states.length, covered: states.filter((s) => s === 'covered').length, partial: states.filter((s) => s === 'partial').length, gap: states.filter((s) => s === 'gap').length }
    })
    const staleAssets = assets.filter((asset) => asset.criticality === 'high' && daysFromToday(asset.lastReviewed) < -365).sort((a, b) => a.lastReviewed.localeCompare(b.lastReviewed))
    const cutoff = now - 7 * DAY_MS
    const deniedWeek = auditEvents.filter((event) => event.action === 'access.denied' && Date.parse(event.at) >= cutoff && Date.parse(event.at) <= now).length
    const latest = [...auditEvents].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5)
    const countsByDay = new Map<string, number>()
    for (const event of auditEvents) {
      const day = event.at.slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) countsByDay.set(day, (countsByDay.get(day) ?? 0) + 1)
    }
    const fallbackActivity = Array.from({ length: 14 }, (_, index) => {
      const date = isoDay(index - 13)
      return { date, count: countsByDay.get(date) ?? 0 }
    })
    return { reviewQueue, csfRows, csfByFunction, staleAssets, deniedWeek, latest, activity: fallbackActivity }
  }, [now])
  const activity = hasServerSeries ? serverSeries.map((row) => ({ date: row.date, count: row.audit })) : view.activity
  const activityTotal = activity.reduce((sum, day) => sum + day.count, 0)
  const activityMean = activity.length ? Math.round(activityTotal / activity.length * 10) / 10 : 0
  // Real daily series from the summary heatmap: audit events whose action contains "denied", per day (7 days).
  const deniedSeries = summary ? WEEK_DATES.map((date) => heatmapRows.filter((row) => row.date === date && row.cause.includes('denied')).reduce((sum, row) => sum + row.count, 0)) : undefined
  const deniedWeek = deniedSeries ? deniedSeries.reduce((sum, value) => sum + value, 0) : view.deniedWeek
  const tlpData = tlpRows(documents)
  const reviewRows = reviewScheduleRows(documents, TODAY)
  const reviewCount = (key: string) => reviewRows.find((row) => row.key === key)?.value ?? 0
  // Pen buckets: Terlambat / 0–30 / 31–90 / >90 (91–180 and over 180 merged).
  const reviewData = [
    { key: 'overdue', label: 'Terlambat', value: reviewCount('overdue') },
    { key: 'd0_30', label: '0–30 hari', value: reviewCount('d0_30') },
    { key: 'd31_90', label: '31–90 hari', value: reviewCount('d31_90') },
    { key: 'over90', label: '>90 hari', value: reviewCount('d91_180') + reviewCount('over180') },
  ]

  return <>
    <Header><Search /><div className='ms-auto flex items-center gap-2'><ThemeSwitch /><ConfigDrawer /><ProfileDropdown /></div></Header>
    <Main>
      <div className='space-y-3.5'>
        <PageHead title='Apa yang perlu perhatian hari ini' eyebrow={`OVERVIEW / DASHBOARD · ${TODAY}`} note='Data dari /api/grc' actions={<Button asChild variant='outline' className='min-h-11 rounded-none'><Link to='/documents'>Buka registri</Link></Button>} />
        <section aria-label='Hal yang perlu perhatian' className='grid min-w-0 grid-cols-1 gap-3.5 md:grid-cols-3'>
          <AttentionCard number={view.reviewQueue.length} label='Dokumen perlu tinjauan' detail={`${view.reviewQueue.filter(({ days }) => days < 0).length} terlambat · ${view.reviewQueue.filter(({ days }) => days >= 0).length} jatuh tempo dalam 30 hari`} to='/documents' tone='warn' />
          <AttentionCard number={view.csfRows.length} label='Subkategori CSF tanpa bukti terkini' detail={`${csfSubcategories.length} subkategori · ${view.csfRows.filter(({ state }) => state === 'gap').length} gap · ${view.csfRows.filter(({ state }) => state === 'partial').length} partial`} to='/evidence' tone='fail' />
          <AttentionCard number={view.staleAssets.length} label='Aset kritikal belum ditinjau' detail='Kritikalitas tinggi · tinjauan lebih dari 365 hari' to='/assets' tone='warn' />
        </section>
        <StatStrip items={[
          { label: 'Otorisasi ganda menunggu', value: statRequestsValue, sub: !canSeeRequests ? 'Tidak tersedia untuk izin akun ini' : requests.isError ? 'Gagal memuat permintaan' : 'Permintaan akses tertunda' },
          { label: 'Rata-rata waktu putusan', value: avgDecisionValue, sub: 'Dari pengajuan sampai keputusan' },
          { label: 'Penolakan akses · 7 hari', value: deniedWeek, sub: 'Event access.denied di audit · 7 hari', spark: deniedSeries },
          { label: 'Sesi aktif sekarang', value: typeof summary?.sessions?.active === 'number' ? summary.sessions.active : 'Belum tersedia', sub: 'Aktif dalam 5 menit terakhir' },
        ]} />
      </div>

      <div className='mt-3.5 grid min-w-0 grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]'>
        <CardPanel title='Event audit per hari' meta={`${activity.length} hari · rata-rata ${activityMean} per hari · ${hasServerSeries ? '/api/dashboard/summary' : 'hitungan dari timestamp auditEvents'}`}>
          {activity.some((day) => day.count > 0) ? <LineChart rows={activity} /> : <p className='p-4 text-sm text-ink-2'>Belum ada event audit dalam rentang ini.</p>}
        </CardPanel>
        <CardPanel title='Penolakan dan login gagal' meta='7 hari × blok 4 jam'>
          {summary ? <Heatmap rows={heatmapRows} /> : <Unavailable title='Heatmap belum tersedia' description='Data ringkasan tidak dapat dimuat. Penolakan dan login gagal per blok jam tidak ditampilkan.' />}
        </CardPanel>
      </div>

      <div className='mt-3.5 grid min-w-0 grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]'>
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

        <div className='grid min-w-0 gap-3.5'>
          <CardPanel title='CSF tanpa bukti terkini' meta={`${view.csfRows.length} / ${csfSubcategories.length}`} actions={<Link className='min-h-11 inline-flex items-center text-xs underline underline-offset-4' to='/evidence'>Lihat bukti</Link>}>
            {view.csfRows.length ? view.csfRows.slice(0, 5).map(({ subcategory, state }) => <div key={subcategory.id} className='flex min-w-0 items-center justify-between gap-2 border-b border-line px-3 py-2.5 last:border-0'>
              <div className='min-w-0'><Link to='/evidence' hash={`subcategory-${subcategory.id}`} className='font-mono text-xs underline underline-offset-4'>{subcategory.id}</Link><p className='truncate text-xs text-ink-2' title={subcategory.outcome}>{subcategory.outcome}</p></div>
              <StatusDot tone={state === 'gap' ? 'fail' : 'warn'}>{state === 'gap' ? 'Gap' : 'Partial'}</StatusDot>
            </div>) : <p className='p-3 text-sm text-ink-2'>{csfSubcategories.length ? 'Semua subkategori memiliki bukti terkini.' : 'Belum ada data subkategori CSF.'}</p>}
          </CardPanel>
          <CardPanel title='Grant akan kedaluwarsa' meta='30 hari ke depan' actions={canSeeGrants ? <Link className='min-h-11 inline-flex items-center text-xs underline underline-offset-4' to='/documents'>Kelola</Link> : undefined}>
            {!canSeeGrants ? <p className='p-3 text-sm text-ink-2'>Tidak tersedia untuk izin akun ini.</p>
              : grants.isPending ? <p className='p-3 text-sm text-ink-2'>Memuat grant…</p>
              : grants.isError ? <p className='p-3 text-sm text-ink-2'>Grant gagal dimuat.</p>
              : expiring.length ? <div className='min-w-0'>
                <ul>{expiring.slice(0, 5).map((grant) => {
                  const soon = Date.parse(grant.expiresAt) - now <= 7 * DAY_MS
                  const remainingDays = Math.min(30, Math.max(0, (Date.parse(grant.expiresAt) - now) / DAY_MS))
                  const pct = `${remainingDays / 30 * 100}%`
                  return <li key={`${grant.documentId}-${grant.user}`} className='grid min-w-0 grid-cols-[112px_minmax(0,1fr)_56px] items-center gap-3 border-b border-line px-4 py-3 last:border-0'>
                    <div className='min-w-0'><p className='truncate font-mono text-xs'>{grant.user}</p><Link className='font-mono text-[9px] text-ink-3 underline underline-offset-2' to='/documents/$documentId' params={{ documentId: grant.documentId }}>{grant.documentId}</Link></div>
                    <div className='relative h-3 min-w-0'>
                      <span aria-hidden='true' className='absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-strong' />
                      <span aria-hidden='true' className={`absolute left-0 top-1/2 h-px -translate-y-1/2 ${soon ? 'bg-warn' : 'bg-ink-3'}`} style={{ width: pct }} />
                      <span aria-hidden='true' className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${soon ? 'bg-warn' : 'bg-ink-3'}`} style={{ left: pct }} />
                    </div>
                    <span className={`text-right font-mono text-[10px] tabular-nums ${soon ? 'text-warn' : 'text-ink-3'}`}>{expiryLabel(grant.expiresAt, now)}</span>
                  </li>
                })}</ul>
                <div className='grid grid-cols-[112px_minmax(0,1fr)_56px] gap-3 px-4 pt-2 font-mono text-[8px] text-ink-3'>
                  <span />
                  <span className='flex justify-between'><span>hari ini</span><span>+15</span><span>+30 hari</span></span>
                  <span />
                </div>
                <div className='flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 font-mono text-[9px] text-ink-2'>
                  <span className='inline-flex items-center gap-1.5'><i aria-hidden='true' className='size-2 bg-warn' />≤7 hari · perlu keputusan <i aria-hidden='true' className='ms-2 size-2 bg-ink-3' />&gt;7 hari</span>
                  {noExpiry > 0 && <span>+{noExpiry} grant tanpa kedaluwarsa</span>}
                </div>
              </div> : <div className='p-4'>
                <p className='text-sm text-ink-2'>Tidak ada grant yang kedaluwarsa dalam 30 hari.</p>
                {noExpiry > 0 && <p className='mt-2 font-mono text-[9px] text-ink-2'>+{noExpiry} grant tanpa kedaluwarsa</p>}
              </div>}
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

      <div className='mt-3.5 grid min-w-0 grid-cols-1 items-start gap-3.5 xl:grid-cols-2'>
        <CardPanel title='Antrean keputusan' meta={`${pending.length} permintaan · otorisasi ganda`} actions={canSeeRequests ? <Link className='min-h-11 inline-flex items-center text-xs underline underline-offset-4' to='/requests'>Buka permintaan</Link> : undefined}>
          {!canSeeRequests ? <p className='p-4 text-sm text-ink-2'>Antrean keputusan tidak tersedia untuk izin akun ini.</p>
            : requests.isPending ? <p className='p-4 text-sm text-ink-2'>Memuat permintaan akses…</p>
            : requests.isError ? <p className='p-4 text-sm text-ink-2'>Permintaan akses gagal dimuat.</p>
            : pending.length ? pending.slice(0, 5).map((request) => <div key={request.id} className='flex min-w-0 items-start justify-between gap-3 border-b border-line px-3 py-2.5 last:border-0'>
              <div className='min-w-0'><p className='font-mono text-xs'>{request.documentId} · {request.grantee}</p><p className='truncate text-xs text-ink-2' title={request.reason}>{request.reason}</p></div>
              <div className='flex shrink-0 flex-col items-end gap-1'><TlpMark tlp={request.tlp} compact /><span className='font-mono text-[10px] tabular-nums text-ink-2'>{request.approvals.length} dari 2 persetujuan</span></div>
            </div>) : <p className='p-4 text-sm text-ink-2'>Tidak ada permintaan akses menunggu.</p>}
        </CardPanel>
        <CardPanel title='Cakupan CSF per fungsi' meta='covered · partial · gap' actions={<Link className='min-h-11 inline-flex items-center text-xs underline underline-offset-4' to='/evidence'>Lihat bukti</Link>}>
          {csfSubcategories.length ? <ul className='space-y-3 p-4'>{view.csfByFunction.map((row) => <li key={row.fn} className='grid min-w-0 gap-1.5'>
            <div className='flex items-baseline justify-between gap-2 text-xs'><span className='font-mono'>{row.fn} · {row.name}</span><span className='font-mono text-[10px] tabular-nums text-ink-2'>{row.covered} · {row.partial} · {row.gap}</span></div>
            <div className='flex h-2 w-full bg-surface-2' role='img' aria-label={`${row.name}: ${row.covered} terkini, ${row.partial} sebagian, ${row.gap} gap dari ${row.total}`}>
              <span className='bar-fill block h-full' style={{ width: `${row.total ? row.covered / row.total * 100 : 0}%`, background: 'var(--pass)' }} />
              <span className='bar-fill block h-full' style={{ width: `${row.total ? row.partial / row.total * 100 : 0}%`, background: 'var(--warn)' }} />
              <span className='bar-fill block h-full' style={{ width: `${row.total ? row.gap / row.total * 100 : 0}%`, background: 'var(--fail)' }} />
            </div>
          </li>)}</ul> : <p className='p-4 text-sm text-ink-2'>Belum ada data subkategori CSF.</p>}
        </CardPanel>
      </div>

      <div className='mt-3.5 grid min-w-0 grid-cols-1 items-start gap-3.5 xl:grid-cols-2'>
        <CardPanel title='Dokumen per TLP' meta={`${documents.length} dokumen`}>
          <Bars rows={tlpData.map((row) => ({ key: row.key, label: row.label, value: row.value, color: 'var(--chart-1)' }))} empty='Belum ada dokumen.' />
        </CardPanel>
        <CardPanel title='Jadwal tinjauan' meta={`hari dari sekarang · ${reviewData.reduce((sum, row) => sum + row.value, 0)} dari ${documents.length} dengan tanggal valid`}>
          <Bars rows={reviewData.map((row) => ({ key: row.key, label: row.label, value: row.value, color: row.key === 'overdue' ? 'var(--fail)' : row.key === 'd0_30' ? 'var(--warn)' : 'var(--chart-1)' }))} empty='Belum ada dokumen.' />
        </CardPanel>
      </div>

      {!summary && dashboardQuery.isError && <p role='status' className='mt-3.5 border border-line p-3 text-sm text-ink-2'>Ringkasan audit gagal dimuat. Sesi aktif dan heatmap tidak tersedia.</p>}
      {!canSeeRequests && <div className='mt-3.5'><Chip tone='line'>Antrean keputusan memerlukan izin akses</Chip></div>}
    </Main>
  </>
}

function AttentionCard({ number, label, detail, to, tone }: { number: number; label: string; detail: string; to: '/documents' | '/evidence' | '/assets'; tone: 'ink' | 'warn' | 'fail' }) {
  return <Link to={to} className={`group min-w-0 border border-line border-t-2 bg-surface p-3.5 text-ink no-underline transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-strong ${TONE_BORDER[tone]}`}>
    <strong className={`block font-heading text-[30px] leading-none tabular-nums ${TONE_TEXT[tone]}`}>{number}</strong>
    <span className='mt-2 block text-sm font-semibold'>{label}</span><span className='mt-1 block text-xs leading-5 text-ink-2'>{detail}</span>
  </Link>
}

function LineChart({ rows }: { rows: { date: string; count: number }[] }) {
  const width = 700
  const height = 180
  const padLeft = 28
  const padRight = 8
  const padTop = 12
  const padBottom = 22
  const max = Math.max(1, ...rows.map((row) => row.count))
  const x = (index: number) => padLeft + (rows.length > 1 ? index * (width - padLeft - padRight) / (rows.length - 1) : 0)
  const y = (value: number) => padTop + (1 - value / max) * (height - padTop - padBottom)
  const points = rows.map((row, index) => `${x(index)},${y(row.count)}`).join(' ')
  const area = `${x(0)},${height - padBottom} ${points} ${x(rows.length - 1)},${height - padBottom}`
  const last = rows[rows.length - 1]
  return <div className='p-3'>
    <svg viewBox={`0 0 ${width} ${height}`} role='img' aria-label={`Event audit per hari, ${rows.length} hari. Titik terakhir ${last ? `${dateLabel(last.date)}: ${last.count}` : 'tidak ada'}.`} className='block h-auto max-h-[220px] w-full'>
      {[0, 0.5, 1].map((fraction) => { const yy = y(max * fraction); return <g key={fraction}><line x1={padLeft} x2={width - padRight} y1={yy} y2={yy} stroke='var(--line)' strokeWidth='1' /><text x='0' y={yy + 3} fill='var(--ink-3)' fontSize='9' className='font-mono'>{Math.round(max * fraction)}</text></g> })}
      <polygon points={area} fill='var(--chart-1)' opacity='0.12' />
      <polyline points={points} fill='none' stroke='var(--chart-1)' strokeWidth='1.6' strokeLinejoin='round' />
      {rows.map((row, index) => <g key={row.date}><title>{`${row.date}: ${row.count} event audit`}</title><circle cx={x(index)} cy={y(row.count)} r='2.5' fill='var(--chart-1)' /></g>)}
      {rows.map((row, index) => index % 2 === 0 || index === rows.length - 1 ? <text key={`l${row.date}`} x={x(index)} y={height - 6} textAnchor='middle' fill='var(--ink-3)' fontSize='9' className='font-mono'>{dateLabel(row.date)}</text> : null)}
      {last && <text x={x(rows.length - 1)} y={y(last.count) - 7} textAnchor='end' fill='var(--ink)' fontSize='10' className='font-mono'>{last.count}</text>}
    </svg>
    <p className='mt-2 text-xs text-ink-2'>Jumlah event audit per tanggal, termasuk tanggal tanpa event (0). Bukan jumlah pembukaan dokumen.</p>
  </div>
}

function Heatmap({ rows }: { rows: DashboardHeatmapRow[] }) {
  const grid = new Map<string, number>()
  for (const row of rows) {
    const key = `${row.date}:${blockOf(row.hour)}`
    grid.set(key, (grid.get(key) ?? 0) + row.count)
  }
  const cellCount = (date: string, block: number) => grid.get(`${date}:${block}`) ?? 0
  let peak = { count: 0, date: '', block: 0 }
  for (const date of WEEK_DATES) {
    for (let block = 0; block < BLOCKS.length; block++) {
      const count = cellCount(date, block)
      if (count > peak.count) peak = { count, date, block }
    }
  }
  const total = WEEK_DATES.reduce((sum, date) => sum + BLOCKS.reduce((inner, _, block) => inner + cellCount(date, block), 0), 0)
  const peakNote = peak.count
    ? `Puncak ${peak.count} kejadian: ${dateLabel(peak.date)}, blok ${BLOCKS[peak.block]}`
    : 'Tidak ada penolakan atau login gagal dalam 7 hari terakhir'
  return <div className='min-w-0 p-3'>
    <div role='img' aria-label={`Heatmap penolakan dan login gagal, ${total} kejadian dalam 7 hari`} className='grid min-w-0 grid-cols-[52px_repeat(6,minmax(0,1fr))] gap-1'>
      <span />
      {BLOCKS.map((block) => <span key={block} className='text-center font-mono text-[8px] text-ink-3'>{block}</span>)}
      {WEEK_DATES.map((date) => <div key={date} className='contents'>
        <span className='self-center font-mono text-[9px] text-ink-2'>{dateLabel(date)}</span>
        {BLOCKS.map((block, index) => {
          const count = cellCount(date, index)
          const level = levelOf(count)
          return <span key={`${date}-${block}`} title={`${dateLabel(date)} ${block}: ${count}`} className='aspect-[3/2] min-w-0 border border-line' style={{ background: level ? 'var(--chart-1)' : 'var(--surface-2)', opacity: level ? LEVEL_OPACITY[level] : 1 }} />
        })}
      </div>)}
    </div>
    <div className='mt-3 flex flex-wrap items-center gap-3 font-mono text-[9px] text-ink-2'>
      {[0, 1, 2, 3].map((level) => <span key={level} className='inline-flex items-center gap-1.5'><i aria-hidden='true' className='inline-block size-3 border border-line' style={{ background: level ? 'var(--chart-1)' : 'var(--surface-2)', opacity: level ? LEVEL_OPACITY[level] : 1 }} />{level === 3 ? '3+' : level}</span>)}
    </div>
    <p className='mt-2 text-xs text-ink-2'>{peakNote}</p>
  </div>
}

type BarRow = { key: string; label: string; value: number; color: string }
function Bars({ rows, empty }: { rows: BarRow[]; empty: string }) {
  const max = Math.max(0, ...rows.map((row) => row.value))
  if (max === 0) return <p className='p-4 text-sm text-ink-2'>{empty}</p>
  return <ul className='space-y-2.5 p-4'>{rows.map((row) => <li key={row.key} className='grid min-w-0 grid-cols-[96px_minmax(0,1fr)_32px] items-center gap-3'>
    <span className='truncate font-mono text-[10px] text-ink-2'>{row.label}</span>
    <span className='block h-2 bg-surface-2'><span className='bar-fill block h-full' style={{ width: `${row.value / max * 100}%`, background: row.color }} /></span>
    <span className='text-right font-mono text-xs tabular-nums'>{row.value}</span>
  </li>)}</ul>
}

function Unavailable({ title, description }: { title: string; description: string }) {
  return <div className='min-h-36 p-3'><p className='text-sm font-medium text-ink'>{title}</p><p className='mt-1 max-w-prose text-xs leading-5 text-ink-2'>{description}</p></div>
}

function ObjectLink({ event }: { event: AuditEvent }) {
  if (event.objectType === 'asset') return <Link className='underline underline-offset-2' to='/assets/$assetId' params={{ assetId: event.objectId }}>{event.objectId}</Link>
  if (event.objectType === 'document') return <Link className='underline underline-offset-2' to='/documents/$documentId' params={{ documentId: event.objectId }}>{event.objectId}</Link>
  return <Link className='underline underline-offset-2' to='/audit-log'>{event.objectId}</Link>
}
