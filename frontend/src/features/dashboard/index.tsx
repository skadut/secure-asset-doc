import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
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
import { ArrowRight, ArrowUpFromLine } from 'lucide-react'
import { listAccessRequests } from '@/lib/access-api'
import { coverage } from '@/lib/grc'
import { getMe } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { CardPanel } from '@/components/card-panel'
import { Chip } from '@/components/chip'
import { ConfigDrawer } from '@/components/config-drawer'
import { EmptyState } from '@/components/empty-state'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { PageHead } from '@/components/page-head'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { StatStrip } from '@/components/stat-strip'
import { DocStatusBadge } from '@/components/status-badge'
import { StatusDot } from '@/components/status-dot'
import { ThemeSwitch } from '@/components/theme-switch'
import { TlpMark } from '@/components/tlp-mark'
import { reviewScheduleRows, tlpRows } from './viz-data'

const DAY_MS = 86_400_000
const dayNumber = (date: string) =>
  Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS)
const daysFromToday = (date: string) => dayNumber(date) - dayNumber(TODAY)
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
const isoDay = (offset: number) =>
  new Date((dayNumber(TODAY) + offset) * DAY_MS).toISOString().slice(0, 10)
const WEEK_DATES = Array.from({ length: 7 }, (_, index) => isoDay(index - 6))
const BLOCKS = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24']
const blockOf = (hour: number) => Math.floor(hour / 4)
type DashboardHeatmapRow = {
  date: string
  hour: number
  cause: string
  count: number
}
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
  return (
    typeof candidate.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(candidate.date) &&
    Number.isInteger(candidate.hour) &&
    candidate.hour !== undefined &&
    candidate.hour >= 0 &&
    candidate.hour < 24 &&
    typeof candidate.cause === 'string' &&
    typeof candidate.count === 'number' &&
    candidate.count >= 0
  )
}
const formatDecisionSeconds = (seconds: number) =>
  seconds < 60
    ? `${Math.round(seconds)} detik`
    : seconds < 3600
      ? `${(seconds / 60).toFixed(1)} menit`
      : `${(seconds / 3600).toFixed(1)} jam`
type ExpiringGrant = { user: string; documentId: string; expiresAt: string }
const isExpiringGrant = (row: unknown): row is ExpiringGrant => {
  if (typeof row !== 'object' || row === null) return false
  const candidate = row as Partial<ExpiringGrant>
  return (
    typeof candidate.user === 'string' &&
    typeof candidate.documentId === 'string' &&
    typeof candidate.expiresAt === 'string' &&
    Number.isFinite(Date.parse(candidate.expiresAt))
  )
}
const expiryLabel = (expiresAt: string, now: number) =>
  `${Math.max(1, Math.ceil((Date.parse(expiresAt) - now) / 3_600_000))} h`
const TONE_BORDER = {
  ink: 'border-t-line-strong',
  warn: 'border-t-warn',
  fail: 'border-t-fail',
} as const
const TONE_TEXT = {
  ink: 'text-ink',
  warn: 'text-warn',
  fail: 'text-fail',
} as const
const tlpColor = (key: string) =>
  (
    ({
      CLEAR: 'var(--tlp-clear)',
      GREEN: 'var(--tlp-green)',
      AMBER: 'var(--tlp-amber)',
      'AMBER+STRICT': 'var(--tlp-amber-strict)',
      RED: 'var(--tlp-red)',
      'RED+STRICT': 'var(--tlp-red-strict)',
    }) as Record<string, string>
  )[key] ?? 'var(--ink-3)'
const actionLabel = (action: string) =>
  (
    ({
      login_success: 'Masuk berhasil',
      'login.success': 'Masuk berhasil',
      approve: 'Menyetujui permintaan akses',
      deny: 'Menolak permintaan akses',
      'access.denied': 'Menolak permintaan akses',
      upload: 'Mengunggah dokumen',
      create: 'Membuat dokumen',
      update: 'Memperbarui dokumen',
    }) as Record<string, string>
  )[action] ?? action
const ActionLink = ({
  label,
  to,
}: {
  label: string
  to: '/audit-log' | '/documents' | '/evidence' | '/assets'
}) => (
  <Link
    to={to}
    className='inline-flex min-h-8 items-center gap-2 border border-line-strong bg-surface px-2.5 font-mono text-[11.5px] font-semibold tracking-wide text-ink uppercase hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-strong'
  >
    {label}
    <ArrowRight aria-hidden='true' size={13} />
  </Link>
)

export function Dashboard() {
  const me = getMe()
  const canSeeRequests = Boolean(
    me?.can.access?.request || me?.can.access?.approve
  )
  const [now] = useState(() => Date.now())
  const requests = useQuery({
    queryKey: ['access-requests'],
    queryFn: listAccessRequests,
    retry: false,
    enabled: canSeeRequests,
  })
  const dashboardQuery = useQuery<DashboardSummary | null>({
    queryKey: ['dashboard-summary'],
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/dashboard/summary?days=14', {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: unknown = await res.json()
      if (typeof data !== 'object' || data === null) return null
      const candidate = data as DashboardSummary
      const seriesValid =
        Array.isArray(candidate.series) &&
        candidate.series.every(
          (row) =>
            typeof row?.date === 'string' &&
            typeof row?.audit === 'number' &&
            Number.isFinite(row.audit)
        )
      const heatmapValid =
        Array.isArray(candidate.access?.heatmap) &&
        candidate.access.heatmap.every(isHeatmapRow)
      const sessionsValid = typeof candidate.sessions?.active === 'number'
      const accessValid =
        candidate.access === undefined || typeof candidate.access === 'object'
      if (!seriesValid && !heatmapValid && !sessionsValid && !accessValid)
        return null
      return candidate
    },
  })
  const summary = dashboardQuery.data
  const pending =
    requests.data?.filter((request) => request.status === 'pending') ?? []
  const heatmapRows = summary?.access?.heatmap?.filter(isHeatmapRow) ?? []
  const serverSeries =
    summary?.series?.filter(
      (row) =>
        typeof row?.date === 'string' &&
        typeof row?.audit === 'number' &&
        Number.isFinite(row.audit)
    ) ?? []
  const hasServerSeries = serverSeries.length > 0
  const avgDecisionSeconds = summary?.access?.avgDecisionSeconds
  const avgDecisionValue =
    typeof avgDecisionSeconds === 'number' &&
    Number.isFinite(avgDecisionSeconds)
      ? formatDecisionSeconds(avgDecisionSeconds)
      : 'Belum tersedia'
  const statRequestsValue = !canSeeRequests
    ? '—'
    : requests.isPending
      ? '…'
      : requests.isError
        ? '—'
        : pending.length
  const eyebrow = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  })
    .format(new Date())
    .replace(',', ' ·')
    .replace(' pukul ', ' · ')
    .toLocaleUpperCase('id-ID')
  const canSeeGrants = Boolean(
    me && (me.accessLevel === 5 || me.securityOfficer)
  )
  const grants = useQuery<{ grants: ExpiringGrant[]; noExpiry: number }>({
    queryKey: ['grants-expiring'],
    enabled: canSeeGrants,
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/grants/expiring?days=30', {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: unknown = await res.json()
      const candidate = (
        typeof data === 'object' && data !== null ? data : {}
      ) as { grants?: unknown; noExpiry?: unknown }
      return {
        grants: Array.isArray(candidate.grants)
          ? candidate.grants.filter(isExpiringGrant)
          : [],
        noExpiry:
          typeof candidate.noExpiry === 'number' &&
          Number.isInteger(candidate.noExpiry) &&
          candidate.noExpiry >= 0
            ? candidate.noExpiry
            : 0,
      }
    },
  })
  const expiring = [...(grants.data?.grants ?? [])].sort((a, b) =>
    a.expiresAt.localeCompare(b.expiresAt)
  )
  const noExpiry = grants.data?.noExpiry ?? 0
  const view = useMemo(() => {
    const reviewQueue = documents
      .map((doc) => ({ doc, days: daysFromToday(doc.nextReview) }))
      .filter(({ days }) => days <= 30)
      .sort((a, b) => a.days - b.days)
    const csfRows = csfSubcategories
      .map((subcategory) => ({
        subcategory,
        state: coverage(subcategory.id, evidenceLinks, documents, TODAY),
      }))
      .filter(({ state }) => state !== 'covered')
      .sort((a, b) => Number(b.state === 'gap') - Number(a.state === 'gap'))
    const csfByFunction = (Object.keys(CSF_FUNCTIONS) as CsfFunction[]).map(
      (fn) => {
        const states = csfSubcategories
          .filter((sub) => sub.fn === fn)
          .map((sub) => coverage(sub.id, evidenceLinks, documents, TODAY))
        return {
          fn,
          name: CSF_FUNCTIONS[fn],
          total: states.length,
          covered: states.filter((s) => s === 'covered').length,
          partial: states.filter((s) => s === 'partial').length,
          gap: states.filter((s) => s === 'gap').length,
        }
      }
    )
    const staleAssets = assets
      .filter(
        (asset) =>
          asset.criticality === 'high' &&
          daysFromToday(asset.lastReviewed) < -365
      )
      .sort((a, b) => a.lastReviewed.localeCompare(b.lastReviewed))
    const cutoff = now - 7 * DAY_MS
    const deniedWeek = auditEvents.filter(
      (event) =>
        event.action === 'access.denied' &&
        Date.parse(event.at) >= cutoff &&
        Date.parse(event.at) <= now
    ).length
    const latest = [...auditEvents]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 5)
    const countsByDay = new Map<string, number>()
    for (const event of auditEvents) {
      const day = event.at.slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(day))
        countsByDay.set(day, (countsByDay.get(day) ?? 0) + 1)
    }
    const activity = Array.from({ length: 14 }, (_, index) => {
      const date = new Date((dayNumber(TODAY) + index - 13) * DAY_MS)
        .toISOString()
        .slice(0, 10)
      return { date, count: countsByDay.get(date) ?? 0 }
    })
    return {
      reviewQueue,
      csfRows,
      csfByFunction,
      staleAssets,
      deniedWeek,
      latest,
      activity,
    }
  }, [now])
  const activity = hasServerSeries
    ? serverSeries.map((row) => ({ date: row.date, count: row.audit }))
    : view.activity
  const activityMean = activity.length
    ? Math.round(
        (activity.reduce((sum, day) => sum + day.count, 0) / activity.length) *
          10
      ) / 10
    : 0
  const deniedSeries = summary
    ? WEEK_DATES.map((date) =>
        heatmapRows
          .filter((row) => row.date === date && row.cause.includes('denied'))
          .reduce((sum, row) => sum + row.count, 0)
      )
    : undefined
  const deniedWeek = deniedSeries
    ? deniedSeries.reduce((sum, value) => sum + value, 0)
    : view.deniedWeek
  const tlpData = tlpRows(documents)
  const reviewRows = reviewScheduleRows(documents, TODAY)
  const reviewCount = (key: string) =>
    reviewRows.find((row) => row.key === key)?.value ?? 0
  const reviewData = [
    { key: 'overdue', label: 'Terlambat', value: reviewCount('overdue') },
    { key: 'd0_30', label: '0–30', value: reviewCount('d0_30') },
    { key: 'd31_90', label: '31–90', value: reviewCount('d31_90') },
    {
      key: 'over90',
      label: '>90',
      value: reviewCount('d91_180') + reviewCount('over180'),
    },
  ]
  const totalCsf = Math.max(1, csfSubcategories.length)

  return (
    <>
      <Header>
        <Search />
        <div className='ms-auto flex items-center gap-2'>
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className='space-y-3.5'>
          <PageHead
            title='Apa yang perlu perhatian hari ini'
            eyebrow={eyebrow}
            note='DATA DARI /API/GRC'
            actions={
              <Button
                asChild
                className='min-h-9 rounded-none bg-ink px-4 text-bg hover:bg-ink/90'
              >
                {me?.can.upload?.c ? (
                  <Link to='/documents' search={{ upload: true }}>
                    Unggah dokumen{' '}
                    <ArrowUpFromLine aria-hidden='true' size={14} />
                  </Link>
                ) : (
                  <Link to='/documents'>
                    Buka registri{' '}
                    <ArrowUpFromLine aria-hidden='true' size={14} />
                  </Link>
                )}
              </Button>
            }
          />
          <section
            aria-label='Hal yang perlu perhatian'
            className='grid min-w-0 grid-cols-1 gap-3.5 md:grid-cols-3'
          >
            <AttentionCard
              index='01'
              number={view.reviewQueue.length}
              label='Dokumen perlu tinjauan'
              detail={`${view.reviewQueue.filter(({ days }) => days < 0).length} terlambat · ${view.reviewQueue.filter(({ days }) => days >= 0).length} jatuh tempo ≤30 hari`}
              to='/documents'
              tone='warn'
            />
            <AttentionCard
              index='02'
              number={view.csfRows.length}
              label='Subkategori CSF tanpa bukti terkini'
              detail={`${csfSubcategories.length} subkategori · ${view.csfRows.filter(({ state }) => state === 'gap').length} gap · ${view.csfRows.filter(({ state }) => state === 'partial').length} partial`}
              to='/evidence'
              tone='fail'
            />
            <AttentionCard
              index='03'
              number={view.staleAssets.length}
              label='Aset kritikal belum ditinjau'
              detail='Kritikalitas tinggi · >365 hari'
              to='/assets'
              tone='ink'
            />
          </section>
          <StatStrip
            items={[
              {
                label: 'Otorisasi ganda menunggu',
                value: statRequestsValue,
                sub: !canSeeRequests
                  ? 'Tidak tersedia untuk izin akun ini'
                  : requests.isError
                    ? 'Gagal memuat permintaan'
                    : 'Permintaan akses tertunda',
              },
              {
                label: 'Rata-rata waktu putusan',
                value: avgDecisionValue,
                sub: 'Dari pengajuan sampai keputusan',
              },
              {
                label: 'Penolakan akses · 7 hari',
                value: deniedWeek,
                sub: 'Event access.denied · 7 hari',
                spark: deniedSeries,
              },
              {
                label: 'Sesi aktif sekarang',
                value:
                  typeof summary?.sessions?.active === 'number'
                    ? summary.sessions.active
                    : 'Belum tersedia',
                sub: 'Aktif dalam 5 menit terakhir',
              },
            ]}
          />
        </div>

        <div className='mt-3.5 grid min-w-0 grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]'>
          <CardPanel
            stacked
            title='Event audit per hari'
            meta={`${activity.length} hari · ${hasServerSeries ? '/api/dashboard/summary' : 'timestamp audit lokal'}`}
            actions={
              <span className='ml-auto font-mono text-[10.5px] text-ink-3 uppercase'>
                RATA-RATA {activityMean}
              </span>
            }
          >
            {activity.some((day) => day.count > 0) ? (
              <LineChart rows={activity} />
            ) : (
              <p className='p-4 text-sm text-ink-2'>
                Belum ada event audit dalam rentang ini.
              </p>
            )}
          </CardPanel>
          <CardPanel
            stacked
            title='Penolakan & login gagal'
            meta='7 hari · blok 4 jam'
            actions={<ActionLink label='Audit' to='/audit-log' />}
          >
            {summary ? (
              <Heatmap rows={heatmapRows} />
            ) : (
              <Unavailable
                title='Heatmap belum tersedia'
                description='Data ringkasan tidak dapat dimuat.'
              />
            )}
          </CardPanel>
        </div>

        <div className='mt-3.5 grid min-w-0 grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]'>
          <CardPanel
            stacked
            title='Antrean tinjauan dokumen'
            meta={`${Math.min(5, view.reviewQueue.length)} dokumen · terlambat atau jatuh tempo ≤30 hari`}
            actions={<ActionLink label='Buka registri' to='/documents' />}
          >
            {view.reviewQueue.length ? (
              <div className='overflow-x-auto'>
                <table className='w-full min-w-[620px] border-collapse text-left'>
                  <thead>
                    <tr className='border-b border-line-strong font-mono text-[9px] tracking-wide text-ink-3 uppercase'>
                      <th className='px-2 py-2 font-normal'>Dokumen</th>
                      <th className='px-2 py-2 font-normal'>TLP</th>
                      <th className='px-2 py-2 font-normal'>Status</th>
                      <th className='px-2 py-2 font-normal'>Tinjauan</th>
                      <th className='px-2 py-2 text-right font-normal'>Hari</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.reviewQueue.slice(0, 5).map(({ doc, days }) => (
                      <tr
                        key={doc.id}
                        className='border-b border-line last:border-0'
                      >
                        <td className='max-w-[240px] px-2 py-[21px]'>
                          <Link
                            className='font-mono text-[11.5px] font-semibold text-ink no-underline'
                            to='/documents/$documentId'
                            params={{ documentId: doc.id }}
                          >
                            {doc.id}
                          </Link>
                          <span
                            className='mt-1 line-clamp-2 block text-[11.5px] leading-5 text-ink-3'
                            title={doc.title}
                          >
                            {doc.title}
                          </span>
                        </td>
                        <td className='px-2 py-[21px]'>
                          <TlpMark tlp={doc.tlp} />
                        </td>
                        <td className='px-2 py-[21px]'>
                          <DocStatusBadge status={doc.status} />
                        </td>
                        <td className='px-2 py-2.5 font-mono text-[11.5px] tabular-nums'>
                          {doc.nextReview}
                        </td>
                        <td
                          className={`px-2 py-2.5 text-right font-mono text-[11.5px] tabular-nums ${days < 0 ? 'text-fail' : 'text-pass'}`}
                        >
                          {days < 0
                            ? `lewat ${Math.abs(days)} hari`
                            : `${days} hari lagi`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title='Tidak ada dokumen yang perlu ditinjau'
                desc='Semua tanggal tinjauan yang tersedia lebih dari 30 hari lagi.'
              />
            )}
          </CardPanel>
          <div className='grid min-w-0 gap-3.5'>
            <CardPanel
              stacked
              title='CSF tanpa bukti terkini'
              meta={`${view.csfRows.length} / ${csfSubcategories.length}`}
              actions={<ActionLink label='Bukti' to='/evidence' />}
            >
              {view.csfRows.length ? (
                view.csfRows.slice(0, 5).map(({ subcategory, state }) => (
                  <div
                    key={subcategory.id}
                    className='flex min-w-0 items-center justify-between gap-2 border-b border-line px-3 py-2.5 last:border-0'
                  >
                    <div className='min-w-0'>
                      <Link
                        to='/evidence'
                        hash={`subcategory-${subcategory.id}`}
                        className='font-mono text-[11.5px] font-semibold text-ink no-underline'
                      >
                        {subcategory.id}
                      </Link>
                      <p
                        className='truncate text-[11.5px] text-ink-3'
                        title={subcategory.outcome}
                      >
                        {subcategory.outcome}
                      </p>
                    </div>
                    <StatusDot tone={state === 'gap' ? 'fail' : 'warn'}>
                      {state === 'gap' ? 'Gap' : 'Partial'}
                    </StatusDot>
                  </div>
                ))
              ) : (
                <p className='p-3 text-xs text-ink-2'>
                  {csfSubcategories.length
                    ? 'Semua subkategori memiliki bukti terkini.'
                    : 'Belum ada data subkategori CSF.'}
                </p>
              )}
            </CardPanel>
            <CardPanel
              stacked
              title='Aktivitas terbaru'
              meta='AUDIT LOG'
              actions={
                <span className='font-mono text-[10.5px] text-pass uppercase'>
                  LIVE
                </span>
              }
            >
              {view.latest.length ? (
                view.latest.map((event) => (
                  <div
                    key={event.id}
                    className='flex min-w-0 items-baseline gap-2 border-b border-line px-3 py-1.5 last:border-0'
                  >
                    <p className='min-w-0 flex-1 truncate text-[11.5px] leading-4'>
                      {actionLabel(event.action)}
                      {event.summary ? ` · ${event.summary}` : ''}
                    </p>
                    <span className='shrink-0 truncate font-mono text-[10.5px] text-ink-3'>
                      <time className='tabular-nums'>
                        {new Intl.DateTimeFormat('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: 'UTC',
                        }).format(new Date(event.at))}
                      </time>{' '}
                      · {event.actor} · <ObjectLink event={event} />
                    </span>
                  </div>
                ))
              ) : (
                <p className='p-3 text-xs text-ink-2'>
                  Belum ada aktivitas audit.
                </p>
              )}
              <div className='px-3 py-2'>
                <ActionLink label='Audit' to='/audit-log' />
              </div>
            </CardPanel>
          </div>
        </div>

        <div className='mt-3.5 grid min-w-0 grid-cols-1 items-start gap-3.5 xl:grid-cols-2'>
          <CardPanel
            stacked
            title='Grant akan kedaluwarsa'
            meta='30 hari ke depan'
            actions={
              canSeeGrants ? (
                <ActionLink label='Kelola' to='/documents' />
              ) : undefined
            }
          >
            {!canSeeGrants ? (
              <p className='p-3 text-xs text-ink-2'>
                Tidak tersedia untuk izin akun ini.
              </p>
            ) : grants.isPending ? (
              <p className='p-3 text-xs text-ink-2'>Memuat grant…</p>
            ) : grants.isError ? (
              <p className='p-3 text-xs text-fail'>Grant gagal dimuat.</p>
            ) : expiring.length ? (
              <div className='min-w-0'>
                <ul>
                  {expiring.slice(0, 5).map((grant) => {
                    const hours = Math.max(
                      0,
                      (Date.parse(grant.expiresAt) - now) / 3_600_000
                    )
                    const pct = `${Math.min(100, (hours / 720) * 100)}%`
                    const soon = hours <= 168
                    return (
                      <li
                        key={`${grant.documentId}-${grant.user}`}
                        className='grid min-w-0 grid-cols-[92px_minmax(0,1fr)_30px] items-center gap-2 border-b border-line px-3 py-2.5 last:border-0'
                      >
                        <div className='min-w-0'>
                          <p className='truncate font-mono text-[11.5px]'>
                            {grant.user}
                          </p>
                          <Link
                            className='font-mono text-[9px] text-ink-3 no-underline'
                            to='/documents/$documentId'
                            params={{ documentId: grant.documentId }}
                          >
                            {grant.documentId}
                          </Link>
                        </div>
                        <div className='relative h-3 min-w-0'>
                          <span
                            aria-hidden='true'
                            className='absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line'
                          />
                          <span
                            aria-hidden='true'
                            className={`absolute top-1/2 left-0 h-px -translate-y-1/2 ${soon ? 'bg-warn' : 'bg-ink-3'}`}
                            style={{ width: pct }}
                          />
                          <span
                            aria-hidden='true'
                            className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${soon ? 'bg-warn' : 'bg-ink-2'}`}
                            style={{ left: pct }}
                          />
                        </div>
                        <span
                          className={`text-right font-mono text-[10.5px] tabular-nums ${soon ? 'text-warn' : 'text-ink-2'}`}
                        >
                          {expiryLabel(grant.expiresAt, now)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                <div className='grid grid-cols-[92px_minmax(0,1fr)_30px] gap-2 px-3 pt-2 font-mono text-[9px] text-ink-3'>
                  <span />
                  <span className='flex justify-between'>
                    <span>hari ini</span>
                    <span>+15</span>
                    <span>+30 hari</span>
                  </span>
                  <span />
                </div>
                <div className='flex flex-wrap justify-between gap-2 border-t border-line px-3 py-2 font-mono text-[9px] text-ink-3'>
                  <span>
                    <i className='me-1 inline-block size-2 bg-warn' />
                    ≤7 hari · perlu keputusan{' '}
                    <i className='ms-2 me-1 inline-block size-2 bg-ink-2' />
                    &gt;7 hari
                  </span>
                  <span>+{noExpiry} grant tanpa kedaluwarsa</span>
                </div>
              </div>
            ) : (
              <div className='p-3 text-xs text-ink-2'>
                Tidak ada grant yang kedaluwarsa dalam 30 hari.
                <p className='mt-2 font-mono text-[10.5px]'>
                  +{noExpiry} grant tanpa kedaluwarsa
                </p>
              </div>
            )}
          </CardPanel>
          <CardPanel
            stacked
            title='Cakupan CSF per fungsi'
            meta={`${csfSubcategories.length} subkategori · bukti tertaut`}
            actions={<ActionLink label='Bukti' to='/evidence' />}
          >
            {csfSubcategories.length ? (
              <div className='p-3'>
                <ul className='space-y-3'>
                  {view.csfByFunction.map((row) => (
                    <li
                      key={row.fn}
                      className='grid min-w-0 grid-cols-[92px_minmax(0,1fr)_32px] items-center gap-2'
                    >
                      <span
                        className='truncate font-mono text-[10.5px]'
                        title={row.name}
                      >
                        <b className='text-ink'>{row.fn}</b>{' '}
                        <span className='text-ink-3'>{row.name}</span>
                      </span>
                      <div
                        className='flex h-2 min-w-0 gap-px bg-surface-2'
                        role='img'
                        aria-label={`${row.name}: ${row.covered} tercakup, ${row.partial} partial, ${row.gap} gap dari ${row.total}`}
                      >
                        <span
                          className='block h-full bg-pass'
                          style={{
                            width: `${((row.covered / totalCsf) * 100 * csfSubcategories.length) / Math.max(1, row.total)}%`,
                          }}
                        />
                        <span
                          className='block h-full bg-warn'
                          style={{
                            width: `${(row.partial / Math.max(1, row.total)) * 100}%`,
                          }}
                        />
                        <span
                          className='block h-full bg-fail'
                          style={{
                            width: `${(row.gap / Math.max(1, row.total)) * 100}%`,
                          }}
                        />
                      </div>
                      <span className='text-right font-mono text-[10.5px] tabular-nums'>
                        {Math.round(
                          (row.covered / Math.max(1, row.total)) * 100
                        )}
                        %
                      </span>
                    </li>
                  ))}
                </ul>
                <div className='mt-3 flex gap-3 border-t border-line pt-2 font-mono text-[9px] text-ink-3'>
                  <span>
                    <i className='me-1 inline-block size-2 bg-pass' />
                    Tercakup
                  </span>
                  <span>
                    <i className='me-1 inline-block size-2 bg-warn' />
                    Partial
                  </span>
                  <span>
                    <i className='me-1 inline-block size-2 bg-fail' />
                    Gap
                  </span>
                </div>
              </div>
            ) : (
              <p className='p-3 text-xs text-ink-2'>
                Belum ada data subkategori CSF.
              </p>
            )}
          </CardPanel>
        </div>

        <div className='mt-3.5 grid min-w-0 grid-cols-1 items-start gap-3.5 xl:grid-cols-2'>
          <CardPanel
            stacked
            title='Dokumen per TLP'
            meta={`${tlpData.filter((row) => row.value > 0).length} visible`}
          >
            <Bars
              rows={tlpData.map((row) => ({
                key: row.key,
                label: row.key.replace('TLP:', ''),
                value: row.value,
                color: tlpColor(row.key.replace('TLP:', '')),
              }))}
              empty='Belum ada dokumen.'
            />
          </CardPanel>
          <CardPanel stacked title='Jadwal tinjauan' meta='hari dari sekarang'>
            <Bars
              rows={reviewData.map((row) => ({
                key: row.key,
                label: row.label,
                value: row.value,
                color:
                  row.key === 'overdue'
                    ? 'var(--fail)'
                    : row.key === 'd0_30'
                      ? 'var(--warn)'
                      : 'var(--ink-3)',
              }))}
              empty='Belum ada dokumen.'
            />
          </CardPanel>
        </div>
        {!summary && dashboardQuery.isError && (
          <p
            role='status'
            className='mt-3.5 border border-line p-3 text-sm text-ink-2'
          >
            Ringkasan audit gagal dimuat. Sesi aktif dan heatmap tidak tersedia.
          </p>
        )}
        {!canSeeRequests && (
          <div className='mt-3.5'>
            <Chip tone='line'>Antrean keputusan memerlukan izin akses</Chip>
          </div>
        )}
      </Main>
    </>
  )
}

function AttentionCard({
  number,
  label,
  detail,
  to,
  tone,
  index,
}: {
  number: number
  label: string
  detail: string
  to: '/documents' | '/evidence' | '/assets'
  tone: 'ink' | 'warn' | 'fail'
  index: string
}) {
  return (
    <Link
      to={to}
      className={`relative min-w-0 border border-t-2 border-line bg-surface p-3.5 text-ink no-underline transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-strong ${TONE_BORDER[tone]}`}
    >
      <span className='absolute top-3 right-3 font-mono text-[9px] text-ink-3'>
        {index}
      </span>
      <strong
        className={`block font-heading text-[30px] leading-none tabular-nums ${TONE_TEXT[tone]}`}
      >
        {number}
      </strong>
      <span className='mt-2 block text-sm font-semibold'>{label}</span>
      <span className='mt-1 block font-mono text-[9px] leading-4 text-ink-3'>
        {detail}
      </span>
    </Link>
  )
}

function LineChart({ rows }: { rows: { date: string; count: number }[] }) {
  const width = 700,
    height = 190,
    padLeft = 42,
    padRight = 18,
    padTop = 16,
    padBottom = 32
  const max = Math.max(1, ...rows.map((row) => row.count))
  const axisMax =
    max <= 10 ? Math.max(2, Math.ceil(max / 2) * 2) : Math.ceil(max / 10) * 10
  const yTicks = [0, axisMax / 2, axisMax]
  const x = (index: number) =>
    padLeft +
    (rows.length > 1
      ? (index * (width - padLeft - padRight)) / (rows.length - 1)
      : 0)
  const y = (value: number) =>
    padTop + (1 - value / axisMax) * (height - padTop - padBottom)
  const points = rows
    .map((row, index) => `${x(index)},${y(row.count)}`)
    .join(' ')
  const area = `${x(0)},${height - padBottom} ${points} ${x(rows.length - 1)},${height - padBottom}`
  const last = rows[rows.length - 1]
  const ticks =
    rows.length <= 7
      ? rows.map((_, i) => i)
      : Array.from({ length: 7 }, (_, i) =>
          Math.round((i * (rows.length - 1)) / 6)
        )
  return (
    <div className='p-3'>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role='img'
        aria-label={`Event audit per hari, ${rows.length} hari. Titik terakhir ${last ? `${dateLabel(last.date)}: ${last.count}` : 'tidak ada'}.`}
        className='block h-auto max-h-[300px] w-full'
      >
        {yTicks.map((tick) => {
          const yy = y(tick)
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={yy}
                y2={yy}
                stroke='var(--line)'
                strokeWidth='1'
              />
              <text
                x='0'
                y={yy + 4}
                fill='var(--ink-3)'
                fontSize='12'
                className='font-mono'
              >
                {tick}
              </text>
            </g>
          )
        })}
        <polygon points={area} fill='var(--ink-2)' opacity='.08' />
        <polyline
          points={points}
          fill='none'
          stroke='var(--ink)'
          strokeWidth='2.2'
          strokeLinejoin='round'
        />
        {rows.map((row, index) => (
          <g key={row.date}>
            <title>{`${row.date}: ${row.count} event audit`}</title>
            <circle
              cx={x(index)}
              cy={y(row.count)}
              r={index === rows.length - 1 ? 3.5 : 2}
              fill='var(--ink)'
            />
          </g>
        ))}
        {ticks.map((index) => (
          <text
            key={rows[index]?.date}
            x={x(index)}
            y={height - 5}
            textAnchor='middle'
            fill='var(--ink-3)'
            fontSize='11'
            className='font-mono'
          >
            {dateLabel(rows[index].date)}
          </text>
        ))}
        {last && (
          <g>
            <circle
              cx={x(rows.length - 1)}
              cy={y(last.count)}
              r='2'
              fill='var(--ink)'
            />
            <text
              x={x(rows.length - 1) - 8}
              y={Math.max(30, y(last.count) - 12)}
              textAnchor='end'
              fill='var(--ink)'
              fontSize='15'
              className='font-sans font-semibold'
            >
              {last.count} hari ini
            </text>
          </g>
        )}
      </svg>
      <p className='mt-1 text-[10.5px] text-ink-3'>
        Jumlah event audit per tanggal, termasuk tanggal tanpa event (0). Bukan
        jumlah pembukaan dokumen.
      </p>
    </div>
  )
}

function Heatmap({ rows }: { rows: DashboardHeatmapRow[] }) {
  const grid = new Map<string, number>()
  for (const row of rows) {
    const key = `${row.date}:${blockOf(row.hour)}`
    grid.set(key, (grid.get(key) ?? 0) + row.count)
  }
  const cellCount = (date: string, block: number) =>
    grid.get(`${date}:${block}`) ?? 0
  const peak = WEEK_DATES.flatMap((date) =>
    BLOCKS.map((_, block) => ({ date, block, count: cellCount(date, block) }))
  ).sort((a, b) => b.count - a.count)[0]
  const total = WEEK_DATES.reduce(
    (sum, date) =>
      sum +
      BLOCKS.reduce((inner, _, block) => inner + cellCount(date, block), 0),
    0
  )
  const peakNote = peak?.count
    ? `Puncak: ${new Intl.DateTimeFormat('id-ID', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${peak.date}T00:00:00Z`))} ${BLOCKS[peak.block]} · ${peak.count}`
    : 'Tidak ada penolakan atau login gagal dalam 7 hari terakhir'
  const dayNames = WEEK_DATES.map((date) =>
    new Intl.DateTimeFormat('id-ID', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`))
  )
  return (
    <div className='min-w-0 p-3'>
      <div
        role='img'
        aria-label={`Heatmap penolakan dan login gagal, ${total} kejadian dalam 7 hari`}
        className='grid min-w-0 grid-cols-[36px_repeat(7,minmax(0,1fr))] gap-1'
      >
        <span />
        {dayNames.map((day, i) => (
          <span
            key={`${day}-${i}`}
            className='text-center font-mono text-[8px] text-ink-3'
          >
            {day}
          </span>
        ))}
        {BLOCKS.map((block, index) => (
          <div key={block} className='contents'>
            <span className='self-center font-mono text-[8px] text-ink-3'>
              {block}
            </span>
            {WEEK_DATES.map((date) => {
              const count = cellCount(date, index)
              const alpha =
                count === 0 ? 0 : Math.min(0.95, 0.25 + count * 0.22)
              return (
                <span
                  key={`${date}-${block}`}
                  title={`${date} ${block}: ${count}`}
                  className='aspect-[1.2] min-w-0 border border-line'
                  style={{
                    background: count
                      ? `color-mix(in srgb, var(--fail) ${alpha * 100}%, var(--surface))`
                      : 'var(--surface-2)',
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className='mt-2 flex flex-wrap items-center gap-3 font-mono text-[9px] text-ink-3'>
        {[0, 1, 2, 3].map((level) => (
          <span key={level} className='inline-flex items-center gap-1'>
            <i
              aria-hidden='true'
              className='inline-block size-2 border border-line'
              style={{
                background: level
                  ? `color-mix(in srgb, var(--fail) ${level * 25}%, var(--surface))`
                  : 'var(--surface-2)',
              }}
            />
            {level === 3 ? '3+' : level}
          </span>
        ))}
        <span className='ms-auto'>{peakNote}</span>
      </div>
    </div>
  )
}

type BarRow = { key: string; label: string; value: number; color: string }
function Bars({ rows, empty }: { rows: BarRow[]; empty: string }) {
  const max = Math.max(0, ...rows.map((row) => row.value))
  if (max === 0) return <p className='p-4 text-sm text-ink-2'>{empty}</p>
  return (
    <ul className='space-y-2 p-3'>
      {rows
        .filter((row) => row.key === 'overdue' || row.value > 0)
        .map((row) => (
          <li
            key={row.key}
            className='grid min-w-0 grid-cols-[96px_minmax(0,1fr)_24px] items-center gap-2'
          >
            <span className='truncate font-mono text-[9px] text-ink-3 uppercase'>
              {row.label}
            </span>
            <span className='block h-1.5 bg-surface-2'>
              <span
                className='bar-fill block h-full'
                style={{
                  width: `${(row.value / max) * 100}%`,
                  background: row.color,
                }}
              />
            </span>
            <span className='text-right font-mono text-[10.5px] tabular-nums'>
              {row.value}
            </span>
          </li>
        ))}
    </ul>
  )
}
function Unavailable({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className='min-h-36 p-3'>
      <p className='text-sm font-medium text-ink'>{title}</p>
      <p className='mt-1 max-w-prose text-xs leading-5 text-ink-2'>
        {description}
      </p>
    </div>
  )
}
function ObjectLink({ event }: { event: AuditEvent }) {
  if (event.objectType === 'asset')
    return (
      <Link
        className='underline underline-offset-2'
        to='/assets/$assetId'
        params={{ assetId: event.objectId }}
      >
        {event.objectId}
      </Link>
    )
  if (event.objectType === 'document')
    return (
      <Link
        className='underline underline-offset-2'
        to='/documents/$documentId'
        params={{ documentId: event.objectId }}
      >
        {event.objectId}
      </Link>
    )
  return (
    <Link className='underline underline-offset-2' to='/audit-log'>
      {event.objectId}
    </Link>
  )
}
