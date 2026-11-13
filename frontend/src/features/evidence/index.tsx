// ponytail: filters remain local; move to URL search params if shareable views are needed
import { useEffect, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { CSF_FUNCTIONS, csfSubcategories, type CsfFunction } from '@/data/grc'
import { coverage, evidenceForSubcategory, getAsset, getDocument } from '@/lib/grc'
import { EmptyState } from '@/components/empty-state'
import { PageHead } from '@/components/page-head'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { DocStatusBadge } from '@/components/status-badge'
import { TlpBadge } from '@/components/tlp-badge'
import { CoverageSegment } from './components/coverage-segment'

type CoverageState = ReturnType<typeof coverage>
type FnFilter = CsfFunction | 'all'
type CovFilter = CoverageState | 'all'
type Item = {
  note: string
  doc?: NonNullable<ReturnType<typeof getDocument>>
  asset?: NonNullable<ReturnType<typeof getAsset>>
}
type Row = (typeof rows)[number]

const FUNCTIONS = Object.keys(CSF_FUNCTIONS) as CsfFunction[]
const rows = csfSubcategories.map((sub) => {
  const items = evidenceForSubcategory(sub.id).flatMap<Item>((link) => {
    const doc = link.documentId ? getDocument(link.documentId) : undefined
    const asset = link.assetId ? getAsset(link.assetId) : undefined
    if (doc) return [{ note: link.note, doc }]
    if (asset) return [{ note: link.note, asset }]
    return []
  })
  return { ...sub, coverage: coverage(sub.id), items }
})
const counts = (list: Row[]) => ({
  covered: list.filter((r) => r.coverage === 'covered').length,
  partial: list.filter((r) => r.coverage === 'partial').length,
  gap: list.filter((r) => r.coverage === 'gap').length,
  total: list.length,
})
const summary = FUNCTIONS.map((fn) => ({
  fn,
  ...counts(rows.filter((row) => row.fn === fn)),
}))
const PAGE_SIZE = 8

const coverageTag: Record<CoverageState, { label: string; text: string; dot: string }> = {
  covered: { label: 'Covered', text: 'border-pass text-pass', dot: 'bg-pass' },
  partial: { label: 'Partial', text: 'border-warn text-warn', dot: 'bg-warn' },
  gap: { label: 'Gap', text: 'border-fail text-fail', dot: 'bg-fail' },
}

const legend: { dot: string; label: string; key: 'covered' | 'partial' | 'gap' }[] = [
  { dot: 'bg-pass', label: 'cov', key: 'covered' },
  { dot: 'bg-warn', label: 'par', key: 'partial' },
  { dot: 'bg-fail', label: 'gap', key: 'gap' },
]

const linkClass = 'inline-flex min-h-11 items-center font-mono text-[8px] text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

function CoverageTag({ coverage }: { coverage: CoverageState }) {
  const { label, text, dot } = coverageTag[coverage]
  return <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[7.5px] tracking-[.05em] ${text}`}>
    <i aria-hidden='true' className={`size-1 ${dot}`} />
    {label}
  </span>
}

function EvidenceLinks({ items }: { items: Item[] }) {
  if (!items.length) return <span className='font-mono text-[9px] text-ink-3'>—</span>
  return <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
    {items.map((item, i) => item.doc ? (
      <Link key={`${item.doc.id}-${i}`} to='/documents/$documentId' params={{ documentId: item.doc.id }} className={linkClass}>
        {item.doc.id}
      </Link>
    ) : item.asset ? (
      <Link key={`${item.asset.id}-${i}`} to='/assets/$assetId' params={{ assetId: item.asset.id }} className={linkClass}>
        {item.asset.id}
      </Link>
    ) : null)}
  </div>
}

function EvidenceRow({ row, hash }: { row: Row; hash: string }) {
  const rowId = `subcategory-${row.id}`
  const detailId = `${rowId}-detail`
  const [open, setOpen] = useState(false)
  const [seenHash, setSeenHash] = useState(hash)
  const expandable = row.items.length > 0
  if (hash !== seenHash) {
    setSeenHash(hash)
    if (hash === rowId) setOpen(true)
  }
  useEffect(() => {
    if (hash !== rowId) return
    document.getElementById(rowId)?.scrollIntoView({ block: 'center' })
  }, [hash, rowId])
  return <>
    <tr id={rowId} className='border-t border-line align-middle'>
      <th scope='row' className='px-3 py-3 text-left font-mono text-[9.5px] font-medium text-ink'>{row.id}</th>
      <td className='min-w-0 px-3 py-3 text-[10.5px] leading-[1.45] text-ink-2'>{row.outcome}</td>
      <td className='px-3 py-3'><CoverageTag coverage={row.coverage} /></td>
      <td className='px-3 py-2'>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <span className='font-mono text-[9.5px] tabular-nums text-ink'>{row.items.length}</span>
          <EvidenceLinks items={row.items} />
        </div>
      </td>
      <td className='px-1 py-1 text-right'>
        {expandable && <button type='button' aria-expanded={open} aria-controls={open ? detailId : undefined} aria-label={`Detail bukti ${row.id}`} onClick={() => setOpen(!open)} className='inline-flex size-11 items-center justify-center text-ink-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'>
          <svg aria-hidden='true' viewBox='0 0 24 24' className={`size-4 transition-transform motion-safe:duration-200 ${open ? 'rotate-90' : ''}`} fill='none' stroke='currentColor' strokeWidth='1.6'><path d='m9 6 6 6-6 6' /></svg>
        </button>}
      </td>
    </tr>
    {open && expandable && <tr id={detailId} className='bg-surface-2'>
      <td colSpan={5} className='px-3 py-3'>
        <ul className='grid gap-2 md:grid-cols-2'>{row.items.map((item, i) => <li key={i} className='min-w-0 border border-line bg-surface px-3 py-2'>
          <div className='flex flex-wrap items-center gap-2 text-[10px] text-ink'>
            <span>{item.doc?.title ?? item.asset?.name}</span>
            {item.doc && <><TlpBadge tlp={item.doc.tlp} /><DocStatusBadge status={item.doc.status} /></>}
          </div>
          <p className='mt-1 text-[10px] leading-[1.45] text-ink-2'>{item.note}</p>
        </li>)}</ul>
      </td>
    </tr>}
  </>
}

const filterButton = 'inline-flex min-h-11 items-center justify-center px-2.5 font-mono text-[8.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
const pageButton = 'inline-flex min-h-11 items-center justify-center border border-line px-3 font-mono text-[9px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50'

export function Evidence() {
  const [fn, setFn] = useState<FnFilter>('all')
  const [cov, setCov] = useState<CovFilter>('all')
  const [page, setPage] = useState(1)
  const hash = useLocation({ select: (location) => location.hash })
  const [appliedHash, setAppliedHash] = useState('')

  if (hash !== appliedHash) {
    setAppliedHash(hash)
    const target = rows.find((row) => `subcategory-${row.id}` === hash)
    if (target) {
      const nextFn = fn !== 'all' && fn !== target.fn ? 'all' : fn
      const nextCov = cov !== 'all' && cov !== target.coverage ? 'all' : cov
      const filtered = rows.filter((row) => (nextFn === 'all' || row.fn === nextFn) && (nextCov === 'all' || row.coverage === nextCov))
      setFn(nextFn)
      setCov(nextCov)
      setPage(Math.floor(filtered.indexOf(target) / PAGE_SIZE) + 1)
    }
  }

  const visible = rows.filter((row) => (fn === 'all' || row.fn === fn) && (cov === 'all' || row.coverage === cov))
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const current = Math.min(page, totalPages)
  const start = (current - 1) * PAGE_SIZE
  const pageRows = visible.slice(start, start + PAGE_SIZE)
  const total = counts(rows)

  return <>
    <Header fixed><Search className='me-auto' /><ThemeSwitch /><ConfigDrawer /><ProfileDropdown /></Header>
    <Main className='focus-strong flex flex-1 flex-col gap-5'>
      <PageHead title='CSF 2.0 evidence' eyebrow={`CSF 2.0 · ${rows.length} subkategori · ${FUNCTIONS.length} fungsi`} note={<span className='uppercase tracking-[.08em]'>Coverage dari bukti tertaut, bukan penilaian</span>} />

      <section aria-label='Cakupan per fungsi' className='grid grid-cols-2 gap-2.5 md:grid-cols-3 2xl:grid-cols-6'>
        {summary.map((item) => {
          const active = fn === item.fn
          return <button key={item.fn} type='button' aria-pressed={active} onClick={() => { setFn(active ? 'all' : item.fn); setPage(1) }} className={`flex min-w-0 flex-col gap-2 border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${active ? 'border-ink bg-surface-2' : 'border-line bg-surface hover:bg-surface-2'}`}>
            <span className='flex items-start justify-between gap-2'>
              <span className='min-w-0'>
                <strong className='block font-heading text-[20px] font-semibold leading-none text-ink'>{item.fn}</strong>
                <span className='mt-1 block font-mono text-[7.5px] tracking-[.06em] text-ink-3'>{CSF_FUNCTIONS[item.fn]}</span>
              </span>
              <span className='font-mono text-[9px] text-ink-2'>{item.total}</span>
            </span>
            <span role='img' aria-label={`${item.covered} covered, ${item.partial} partial, ${item.gap} gap`} className='flex h-1.5 w-full'>
              {item.total > 0 ? <>
                <i className='bg-pass motion-safe:transition-[flex-grow] motion-safe:duration-500' style={{ flex: item.covered }} />
                <i className='bg-warn motion-safe:transition-[flex-grow] motion-safe:duration-500' style={{ flex: item.partial }} />
                <i className='bg-fail motion-safe:transition-[flex-grow] motion-safe:duration-500' style={{ flex: item.gap }} />
              </> : <i className='w-full bg-line-2' />}
            </span>
            <span className='flex flex-wrap gap-x-2.5 gap-y-1'>
              {legend.map(({ dot, label, key }) => <span key={key} className='flex items-center gap-1 font-mono text-[7.5px] text-ink-3'>
                <i aria-hidden='true' className={`size-[5px] ${dot}`} />
                {label} {item[key]}
              </span>)}
            </span>
          </button>
        })}
      </section>

      <div className='flex flex-wrap items-center gap-2.5'>
        <div className='flex flex-wrap gap-1' role='group' aria-label='Filter fungsi CSF'>
          <button type='button' aria-pressed={fn === 'all'} onClick={() => { setFn('all'); setPage(1) }} className={`${filterButton} ${fn === 'all' ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-surface-2'}`}>Semua {total.total}</button>
          {FUNCTIONS.map((code) => { const n = summary.find((s) => s.fn === code)?.total ?? 0; return <button key={code} type='button' aria-pressed={fn === code} onClick={() => { setFn(fn === code ? 'all' : code); setPage(1) }} className={`${filterButton} ${fn === code ? 'bg-ink text-surface' : 'text-ink-2 hover:bg-surface-2'}`}>{code} {n}</button> })}
        </div>
        <span aria-hidden='true' className='hidden h-[22px] w-px bg-line sm:block' />
        <CoverageSegment value={cov} onChange={(value) => { setCov(value); setPage(1) }} />
      </div>

      <section aria-label='Subkategori CSF' className='min-w-0 border border-line bg-surface'>
        {visible.length === 0 ? <EmptyState title='Belum ada subkategori CSF' desc='Server belum mengirim data CSF untuk ditampilkan.' /> : <>
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[720px] border-collapse text-left'>
              <caption className='sr-only'>Subkategori CSF, outcome, coverage, dan bukti tertaut</caption>
              <thead className='bg-surface-2 font-mono text-[7.5px] uppercase tracking-[.12em] text-ink-3'><tr>
                <th scope='col' className='w-[120px] px-3 py-2 font-normal'>Subkategori</th>
                <th scope='col' className='px-3 py-2 font-normal'>Outcome</th>
                <th scope='col' className='w-[130px] px-3 py-2 font-normal'>Coverage</th>
                <th scope='col' className='w-[150px] px-3 py-2 font-normal'>Bukti tertaut</th>
                <th scope='col' className='w-10 px-1 py-2 font-normal'><span className='sr-only'>Detail</span></th>
              </tr></thead>
              <tbody>{pageRows.map((row) => <EvidenceRow key={row.id} row={row} hash={hash} />)}</tbody>
            </table>
          </div>
          <footer className='flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 font-mono text-[8.5px] text-ink-3'>
            <span>{start + 1}–{Math.min(start + PAGE_SIZE, visible.length)} dari {visible.length} subkategori · halaman {current} dari {totalPages}</span>
            <nav aria-label='Halaman evidence' className='flex gap-1'>
              <button type='button' disabled={current <= 1} onClick={() => setPage(current - 1)} className={pageButton}>Sebelumnya</button>
              <span className='inline-flex min-h-11 items-center px-2'>{current}/{totalPages}</span>
              <button type='button' disabled={current >= totalPages} onClick={() => setPage(current + 1)} className={pageButton}>Berikutnya</button>
            </nav>
          </footer>
        </>}
      </section>
    </Main>
  </>
}
