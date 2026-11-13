// ponytail: local filter state; move to URL search params when filters need sharing
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from '@tanstack/react-router'
import { auditEvents, type AuditEvent } from '@/data/grc'
import { getMe } from '@/lib/session'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { CardPanel } from '@/components/card-panel'
import { Chip } from '@/components/chip'
import { EmptyState } from '@/components/empty-state'
import { PageHead } from '@/components/page-head'
import { StatStrip } from '@/components/stat-strip'
import { PurgeDialog } from './purge-dialog'

const PAGE_SIZE = 20
const fieldClass =
  'h-8 w-full border border-line bg-surface px-2 font-mono text-[10px] text-ink focus-visible:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

const TONE: Partial<Record<AuditEvent['action'], 'pass' | 'warn' | 'fail' | 'erase'>> = {
  approve: 'pass',
  'access.denied': 'fail',
  delete: 'fail',
  purge: 'erase',
}

function ObjectLink({ event }: { event: AuditEvent }) {
  const className = 'font-mono text-[10px] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
  if (event.objectType === 'asset') {
    return (
      <Link to='/assets/$assetId' params={{ assetId: event.objectId }} className={className}>
        {event.objectId}
      </Link>
    )
  }
  if (event.objectType === 'document') {
    return (
      <Link to='/documents/$documentId' params={{ documentId: event.objectId }} className={className}>
        {event.objectId}
      </Link>
    )
  }
  if (event.objectType !== 'evidence')
    return <span className='font-mono text-[10px] text-ink-2'>{event.objectId}</span>
  return (
    <Link to='/evidence' hash={`subcategory-${event.objectId}`} className={className}>
      {event.objectId}
    </Link>
  )
}

const timeOf = (at: string) => (at.includes('T') ? at.slice(11, 19) : at)
const dateOf = (at: string) => (at.includes('T') ? at.slice(0, 10) : at)

export function AuditLog() {
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('all')
  const [objectType, setObjectType] = useState('all')
  const [actor, setActor] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // ponytail: auditEvents is mutated in place on purge; version forces recompute. Upgrade to a store if a second source appears.
  const [version, setVersion] = useState(0)
  const { actions, objectTypes, actors } = useMemo(
    () => ({
      actions: [...new Set(auditEvents.map((event) => event.action))].sort(),
      objectTypes: [...new Set(auditEvents.map((event) => event.objectType))].sort(),
      actors: [...new Set(auditEvents.map((event) => event.actor))].sort(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  )
  const canPurge = getMe()?.can?.audit?.purge === true
  const [purgeOpen, setPurgeOpen] = useState(false)

  // ponytail: mirrors main.tsx hydrate; move to an exported loader if a second caller appears.
  async function reloadAudit() {
    try {
      const r = await fetch('/api/grc', { credentials: 'same-origin' })
      if (!r.ok) throw new Error()
      const d = await r.json()
      if (!Array.isArray(d?.auditEvents)) throw new Error()
      auditEvents.length = 0
      auditEvents.push(...d.auditEvents)
      setVersion((v) => v + 1)
    } catch {
      window.location.reload()
    }
  }

  const filteredEvents = useMemo(
    () =>
      auditEvents
        .filter(
          (event) =>
            event.summary.toLowerCase().includes(search.toLowerCase()) &&
            (action === 'all' || event.action === action) &&
            (objectType === 'all' || event.objectType === objectType) &&
            (actor === 'all' || event.actor === actor) &&
            (!fromDate || dateOf(event.at) >= fromDate) &&
            (!toDate || dateOf(event.at) <= toDate)
        )
        .sort((a, b) => (a.at < b.at ? 1 : -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, action, objectType, actor, fromDate, toDate, version]
  )

  const pageCount = Math.ceil(filteredEvents.length / PAGE_SIZE)
  const safePage = Math.min(page, Math.max(0, pageCount - 1))
  const visible = filteredEvents.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  const [now] = useState(() => Date.now())
  const counts = useMemo(() => {
    const cutoff = now - 7 * 24 * 60 * 60 * 1000
    const lastSevenDays = auditEvents.filter((event) => {
      const at = Date.parse(event.at)
      return Number.isFinite(at) && at >= cutoff
    })
    return {
      total: lastSevenDays.length,
      denied: lastSevenDays.filter((event) => event.action === 'access.denied').length,
      purges: lastSevenDays.filter((event) => event.action === 'purge').length,
      actors: new Set(lastSevenDays.map((event) => event.actor)).size,
      objects: new Set(lastSevenDays.map((event) => `${event.objectType}:${event.objectId}`)).size,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, version])

  const resetPage = <T,>(setter: Dispatch<SetStateAction<T>>) => (value: T) => {
    setter(value)
    setPage(0)
  }

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4'>
        <PageHead
          title='Audit log'
          eyebrow='JEJAK AUDIT · TIDAK DAPAT DIUBAH'
          note={getMe()?.securityOfficer ? 'PERWIRA KEAMANAN' : undefined}
          actions={
            canPurge ? (
              <button
                type='button'
                className='inline-flex min-h-9 items-center gap-1.5 border border-fail bg-surface px-2.5 font-mono text-[10px] text-fail hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
                onClick={() => setPurgeOpen(true)}
              >
                Purge entri lama
              </button>
            ) : undefined
          }
        />

        <StatStrip
          items={[
            { label: 'KEJADIAN · 7 HARI', value: counts.total },
            { label: 'PENOLAKAN', value: counts.denied, tone: counts.denied ? 'fail' : 'ink' },
            { label: 'PURGE', value: counts.purges },
            { label: 'AKTOR UNIK', value: counts.actors },
            { label: 'OBJEK DISENTUH', value: counts.objects },
          ]}
        />

        {canPurge && (
          <PurgeDialog open={purgeOpen} onOpenChange={setPurgeOpen} onPurged={() => void reloadAudit()} />
        )}

        <CardPanel
          title='Kejadian'
          meta={`${filteredEvents.length} cocok · 20 / halaman`}
          actions={<span className='font-mono text-[9px] text-ink-3'>waktu menurun</span>}
        >
          <div className='grid gap-2 border-b border-line p-2.5 sm:grid-cols-2 lg:grid-cols-3'>
            <label className='flex min-w-0 flex-col gap-1'>
              <span className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Cari ringkasan</span>
              <input
                type='search'
                value={search}
                onChange={(e) => resetPage(setSearch)(e.target.value)}
                placeholder='Cari ringkasan kejadian'
                className={fieldClass}
              />
            </label>
            <label className='flex min-w-0 flex-col gap-1'>
              <span className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Aksi</span>
              <select value={action} onChange={(e) => resetPage(setAction)(e.target.value)} className={fieldClass}>
                <option value='all'>Aksi: semua</option>
                {actions.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className='flex min-w-0 flex-col gap-1'>
              <span className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Objek</span>
              <select value={objectType} onChange={(e) => resetPage(setObjectType)(e.target.value)} className={fieldClass}>
                <option value='all'>Objek: semua</option>
                {objectTypes.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className='flex min-w-0 flex-col gap-1'>
              <span className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Aktor</span>
              <select value={actor} onChange={(e) => resetPage(setActor)(e.target.value)} className={fieldClass}>
                <option value='all'>Aktor: semua</option>
                {actors.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className='flex min-w-0 flex-col gap-1'>
              <span className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Dari tanggal</span>
              <input type='date' value={fromDate} max={toDate || undefined} onChange={(e) => resetPage(setFromDate)(e.target.value)} className={fieldClass} />
            </label>
            <label className='flex min-w-0 flex-col gap-1'>
              <span className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Sampai tanggal</span>
              <input type='date' value={toDate} min={fromDate || undefined} onChange={(e) => resetPage(setToDate)(e.target.value)} className={fieldClass} />
            </label>
          </div>

          <div className='scroll-x min-w-0 overflow-x-auto'>
            <table className='w-full min-w-[880px] border-collapse text-left'>
              <thead>
                <tr className='border-b border-line bg-surface-2 font-mono text-[7.5px] uppercase tracking-[.08em] text-ink-3'>
                  <th className='w-24 px-3 py-2 font-normal'>Waktu</th>
                  <th className='w-32 px-3 py-2 font-normal'>Aktor</th>
                  <th className='w-32 px-3 py-2 font-normal'>Aksi</th>
                  <th className='w-32 px-3 py-2 font-normal'>Objek</th>
                  <th className='px-3 py-2 font-normal'>Ringkasan</th>
                  <th className='w-28 px-3 py-2 text-right font-normal'>Perubahan</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((event) => {
                  const changes = event.changes ?? []
                  const isExpanded = !!expanded[event.id]
                  const panelId = `changes-${event.id}`
                  return [
                    <tr key={event.id} className='border-b border-line align-top'>
                      <td className='px-3 py-2'>
                        <time dateTime={event.at} className='font-mono text-[9.5px] tabular-nums text-ink-2'>
                          {timeOf(event.at)}
                        </time>
                        <span className='mt-0.5 block font-mono text-[8px] text-ink-3'>{dateOf(event.at)}</span>
                      </td>
                      <td className='px-3 py-2 font-mono text-[9.5px] text-ink-2'>{event.actor}</td>
                      <td className='px-3 py-2'>
                        <Chip tone={TONE[event.action]}>{event.action}</Chip>
                      </td>
                      <td className='px-3 py-2'>
                        <ObjectLink event={event} />
                        <span className='mt-0.5 block font-mono text-[8px] text-ink-3'>{event.objectType}</span>
                      </td>
                      <td className='px-3 py-2 text-[11px] leading-[1.45] text-ink-2'>{event.summary}</td>
                      <td className='px-3 py-2 text-right'>
                        {changes.length ? (
                          <button
                            type='button'
                            aria-expanded={isExpanded}
                            aria-controls={panelId}
                            onClick={() =>
                              setExpanded((current) => ({ ...current, [event.id]: !current[event.id] }))
                            }
                            className='min-h-9 border border-line px-2 font-mono text-[9px] text-ink-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
                          >
                            {changes.length} field {isExpanded ? '▴' : '▾'}
                          </button>
                        ) : (
                          <span className='font-mono text-[10px] text-ink-3'>—</span>
                        )}
                      </td>
                    </tr>,
                    changes.length && isExpanded ? (
                      <tr key={`${event.id}-changes`} id={panelId} className='border-b border-line bg-surface-2'>
                        <td colSpan={6} className='px-3 py-2'>
                          <ul className='flex flex-col gap-1'>
                            {changes.map((change, index) => (
                              <li key={`${change.field}-${index}`} className='flex flex-wrap items-baseline gap-2 font-mono text-[9px]'>
                                <span className='w-28 shrink-0 text-ink-3'>{change.field}</span>
                                <span className='text-ink-3 line-through'>{change.from}</span>
                                <span aria-hidden='true' className='text-ink-3'>→</span>
                                <span className='text-ink'>{change.to}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null,
                  ]
                })}
              </tbody>
            </table>
            {!visible.length && (
              <div className='p-4'>
                <EmptyState
                  title='Tidak ada kejadian cocok'
                  desc='Ubah kata kunci, aksi, objek, aktor, atau rentang tanggal.'
                />
              </div>
            )}
          </div>

          <footer className='flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-3 py-2'>
            <span className='font-mono text-[9px] text-ink-3'>
              Menampilkan {visible.length} dari {filteredEvents.length} kejadian
            </span>
            <nav aria-label='Halaman audit' className='flex items-center gap-1'>
              <button
                type='button'
                className='min-h-9 min-w-9 border border-line px-2 font-mono text-[10px] text-ink-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ‹
              </button>
              <span className='px-1 font-mono text-[9px] tabular-nums text-ink-2'>
                {pageCount ? safePage + 1 : 0} / {pageCount}
              </span>
              <button
                type='button'
                className='min-h-9 min-w-9 border border-line px-2 font-mono text-[10px] text-ink-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                ›
              </button>
            </nav>
          </footer>
        </CardPanel>
      </Main>
    </>
  )
}
