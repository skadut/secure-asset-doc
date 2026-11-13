// ponytail: filters remain local; move to URL search params if shareable views are needed
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { CSF_FUNCTIONS, csfSubcategories, type CsfFunction } from '@/data/grc'
import { coverage, evidenceForSubcategory, getAsset, getDocument } from '@/lib/grc'
import { CardPanel } from '@/components/card-panel'
import { EmptyState } from '@/components/empty-state'
import { PageHead } from '@/components/page-head'
import { StatusDot } from '@/components/status-dot'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { CoverageBadge, DocStatusBadge } from '@/components/status-badge'
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

function EvidenceLinks({ items }: { items: Item[] }) {
  if (!items.length) return <span className='font-mono text-[9px] text-ink-3'>0 · none</span>
  return <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
    <span className='font-mono text-[9px] tabular-nums text-ink-2'>{items.length}</span>
    {items.map((item, i) => item.doc ? (
      <Link key={`${item.doc.id}-${i}`} to='/documents/$documentId' params={{ documentId: item.doc.id }} className='inline-flex min-h-11 items-center font-mono text-[9px] text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'>
        {item.doc.id}
      </Link>
    ) : item.asset ? (
      <Link key={`${item.asset.id}-${i}`} to='/assets/$assetId' params={{ assetId: item.asset.id }} className='inline-flex min-h-11 items-center font-mono text-[9px] text-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'>
        {item.asset.id}
      </Link>
    ) : null)}
  </div>
}

function EvidenceRow({ row, hash }: { row: Row; hash: string }) {
  const details = useRef<HTMLDetailsElement>(null)
  const rowId = `subcategory-${row.id}`
  useEffect(() => {
    if (hash !== rowId) return
    if (details.current) details.current.open = true
    document.getElementById(rowId)?.scrollIntoView({ block: 'center' })
  }, [hash, rowId])
  return <tr id={rowId} className='border-t border-line align-top'>
    <th scope='row' className='px-3 py-3 text-left font-mono text-[10px] font-medium text-ink'>{row.id}</th>
    <td className='min-w-0 px-3 py-3 text-[12px] leading-[1.45] text-ink-2'>{row.outcome}</td>
    <td className='px-3 py-3'><CoverageBadge coverage={row.coverage} /></td>
    <td className='px-3 py-2'><EvidenceLinks items={row.items} />
      {row.items.length > 0 && <details ref={details} className='mt-1 text-[10px] text-ink-3'>
        <summary className='inline-flex min-h-11 cursor-pointer items-center underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ink'>Detail bukti</summary>
        <ul className='space-y-2 pb-2'>{row.items.map((item, i) => <li key={i}>
          <div className='flex flex-wrap items-center gap-2 text-ink-2'>
            <span>{item.doc?.title ?? item.asset?.name}</span>
            {item.doc && <><TlpBadge tlp={item.doc.tlp} /><DocStatusBadge status={item.doc.status} /></>}
          </div>
          <p>{item.note}</p>
        </li>)}</ul>
      </details>}
    </td>
  </tr>
}

const filterButton = 'inline-flex min-h-11 items-center justify-center border px-3 font-mono text-[9px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

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
      <PageHead title='CSF 2.0 evidence' eyebrow={`${rows.length} subkategori · 6 fungsi`} note='Coverage dari bukti tertaut, bukan penilaian' />
      <section aria-label='Cakupan per fungsi' className='grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6'>
        {summary.map((item) => <button key={item.fn} type='button' aria-pressed={fn === item.fn} onClick={() => { setFn(fn === item.fn ? 'all' : item.fn); setPage(1) }} className={`min-w-0 border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${fn === item.fn ? 'border-ink bg-surface-2' : 'border-line bg-surface hover:bg-surface-2'}`}>
          <span className='flex items-start justify-between gap-2'><span><strong className='font-[var(--head)] text-[19px] leading-none text-ink'>{item.fn}</strong><span className='mt-1 block text-[10px] text-ink-2'>{CSF_FUNCTIONS[item.fn]}</span></span><span className='font-mono text-[9px] text-ink-3'>{item.total}</span></span>
          <span className='mt-3 flex h-1.5 w-full' aria-label={`${item.covered} covered, ${item.partial} partial, ${item.gap} gap`}>
            {item.total > 0 ? <><i className='bg-pass' style={{ flex: item.covered }} /><i className='bg-warn' style={{ flex: item.partial }} /><i className='bg-fail' style={{ flex: item.gap }} /></> : <i className='w-full bg-line-2' />}
          </span>
          <span className='mt-2 flex flex-wrap gap-x-2 gap-y-1'><StatusDot tone='pass'>{item.covered} covered</StatusDot><StatusDot tone='warn'>{item.partial} partial</StatusDot><StatusDot tone='fail'>{item.gap} gap</StatusDot></span>
        </button>)}
      </section>
      <div className='flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between'>
        <div className='flex flex-wrap gap-1' role='group' aria-label='Filter fungsi CSF'>
          <button type='button' aria-pressed={fn === 'all'} onClick={() => { setFn('all'); setPage(1) }} className={`${filterButton} ${fn === 'all' ? 'border-ink bg-ink text-surface' : 'border-line text-ink-2 hover:bg-surface-2'}`}>Semua {total.total}</button>
          {FUNCTIONS.map((code) => { const n = summary.find((s) => s.fn === code)?.total ?? 0; return <button key={code} type='button' aria-pressed={fn === code} onClick={() => { setFn(fn === code ? 'all' : code); setPage(1) }} className={`${filterButton} ${fn === code ? 'border-ink bg-ink text-surface' : 'border-line text-ink-2 hover:bg-surface-2'}`}>{code} {n}</button> })}
        </div>
        <CoverageSegment value={cov} onChange={(value) => { setCov(value); setPage(1) }} counts={{ all: total.total, covered: total.covered, partial: total.partial, gap: total.gap }} />
      </div>
      <CardPanel title='Subkategori CSF' meta={`${visible.length} hasil`} className='min-w-0'>
        {visible.length === 0 ? <EmptyState title='Belum ada subkategori CSF' desc='Server belum mengirim data CSF untuk ditampilkan.' /> : <>
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[680px] border-collapse text-left'>
              <caption className='sr-only'>Subkategori CSF, outcome, coverage, dan bukti tertaut</caption>
              <thead className='bg-surface-2 font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'><tr><th scope='col' className='w-[128px] px-3 py-2 font-medium'>Subkategori</th><th scope='col' className='px-3 py-2 font-medium'>Outcome</th><th scope='col' className='w-[118px] px-3 py-2 font-medium'>Coverage</th><th scope='col' className='w-[220px] px-3 py-2 font-medium'>Bukti tertaut</th></tr></thead>
              <tbody>{pageRows.map((row) => <EvidenceRow key={row.id} row={row} hash={hash} />)}</tbody>
            </table>
          </div>
          <footer className='flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 font-mono text-[9px] text-ink-3'>
            <span>{start + 1}–{Math.min(start + PAGE_SIZE, visible.length)} dari {visible.length} subkategori</span>
            <nav aria-label='Halaman evidence' className='flex gap-1'><button type='button' disabled={current <= 1} onClick={() => setPage(current - 1)} className={`${filterButton} disabled:opacity-50`}>Sebelumnya</button><span className='inline-flex min-h-11 items-center px-2'>{current}/{totalPages}</span><button type='button' disabled={current >= totalPages} onClick={() => setPage(current + 1)} className={`${filterButton} disabled:opacity-50`}>Berikutnya</button></nav>
          </footer>
        </>}
      </CardPanel>
    </Main>
  </>
}
