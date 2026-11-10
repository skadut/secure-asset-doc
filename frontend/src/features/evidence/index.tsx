// ponytail: local filter state; move to URL search params for shareable filters
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { CoverageBadge, DocStatusBadge } from '@/components/status-badge'
import { TlpBadge } from '@/components/tlp-badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { CoverageSegment } from './components/coverage-segment'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CSF_FUNCTIONS, csfSubcategories, type CsfFunction } from '@/data/grc'
import { coverage, evidenceForSubcategory, getAsset, getDocument } from '@/lib/grc'

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
const selectClass =
  'min-h-11 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
const touchClass =
  'inline-flex min-h-11 items-center rounded-sm px-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

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
  ...counts(rows.filter((r) => r.fn === fn)),
}))

function ItemLink({ item }: { item: Item }) {
  return item.doc ? (
    <Link
      to='/documents/$documentId'
      params={{ documentId: item.doc.id }}
      className={`${touchClass} font-mono text-sm underline underline-offset-4`}
    >
      {item.doc.id}
    </Link>
  ) : (
    <Link
      to='/assets/$assetId'
      params={{ assetId: item.asset!.id }}
      className={`${touchClass} font-mono text-sm underline underline-offset-4`}
    >
      {item.asset!.id}
    </Link>
  )
}

function EvidenceDetail({ item }: { item: Item }) {
  return (
    <li className='flex flex-wrap items-center gap-x-3 gap-y-1'>
      {item.doc ? (
        <>
          <span className='font-medium'>{item.doc.title}</span>
          <TlpBadge tlp={item.doc.tlp} />
          <DocStatusBadge status={item.doc.status} />
          <span className='font-mono tabular-nums text-muted-foreground'>
            {item.doc.versions[0] ? `v${item.doc.versions[0].version}` : 'No version recorded'}
          </span>
        </>
      ) : (
        <span className='font-medium'>{item.asset!.name}</span>
      )}
      <span className='basis-full text-muted-foreground'>{item.note}</span>
    </li>
  )
}

function EvidenceRow({ row, hash }: { row: Row; hash: string }) {
  const notes = useRef<HTMLDetailsElement>(null)
  const hasEvidence = row.items.length > 0
  const rowId = `subcategory-${row.id}`

  useEffect(() => {
    if (hash !== rowId) return
    if (notes.current) notes.current.open = true
    document.getElementById(rowId)?.scrollIntoView({ block: 'center' })
  }, [hash, rowId])

  return (
    <li id={rowId} className='flex flex-col gap-2 px-4 py-3'>
      <div className='flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4'>
        <p className='min-w-0 text-sm'>
          <span className='font-mono tabular-nums'>{row.id}</span> {row.outcome}
        </p>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm'>
          <CoverageBadge coverage={row.coverage} />
          {hasEvidence ? (
            <>
              <span className='tabular-nums text-muted-foreground'>{row.items.length} linked</span>
              {row.items.map((item, i) => (
                <ItemLink key={i} item={item} />
              ))}
            </>
          ) : (
            <span className='text-muted-foreground'>No evidence recorded</span>
          )}
        </div>
      </div>
      {hasEvidence && (
        <details ref={notes} className='text-sm'>
          <summary className={`${touchClass} cursor-pointer underline underline-offset-4`}>
            Evidence notes
          </summary>
          <ul className='mt-2 flex flex-col gap-3 border-t pt-3'>
            {row.items.map((item, i) => (
              <EvidenceDetail key={i} item={item} />
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

const PAGE_SIZE = 4
const pageButtonClass =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-input px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50'

export function Evidence() {
  const [fn, setFn] = useState<FnFilter>('all')
  const [cov, setCov] = useState<CovFilter>('all')
  const [page, setPage] = useState(1)
  const hash = useLocation({ select: (l) => l.hash })
  const [appliedHash, setAppliedHash] = useState('')

  if (hash !== appliedHash) {
    setAppliedHash(hash)
    const target = rows.find((r) => `subcategory-${r.id}` === hash)
    if (target) {
      const nextFn = fn !== 'all' && fn !== target.fn ? 'all' : fn
      const nextCov = cov !== 'all' && cov !== target.coverage ? 'all' : cov
      const list = rows.filter(
        (r) =>
          (nextFn === 'all' || r.fn === nextFn) && (nextCov === 'all' || r.coverage === nextCov)
      )
      setFn(nextFn)
      setCov(nextCov)
      setPage(Math.floor(list.indexOf(target) / PAGE_SIZE) + 1)
    }
  }

  const visible = rows.filter(
    (r) => (fn === 'all' || r.fn === fn) && (cov === 'all' || r.coverage === cov)
  )
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const current = Math.min(page, totalPages)
  const start = (current - 1) * PAGE_SIZE
  const pageRows = visible.slice(start, start + PAGE_SIZE)
  const total = counts(rows)

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
          <h1 className='text-2xl font-bold tracking-tight'>CSF 2.0 evidence</h1>
          <p className='text-muted-foreground'>
            Evidence linked to a {rows.length}-subcategory subset of NIST CSF 2.0. Coverage
            reflects linked evidence only, not an assessment. Sample data.
          </p>
        </div>

        <p className='text-sm'>
          Covered = at least one approved document within its review date.
          Partial = evidence linked but no current approved document.
          Gap = no evidence linked.
        </p>

        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Function</TableHead>
                <TableHead className='text-right'>Covered</TableHead>
                <TableHead className='text-right'>Partial</TableHead>
                <TableHead className='text-right'>Gap</TableHead>
                <TableHead className='text-right'>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.map((s) => (
                <TableRow key={s.fn}>
                  <TableCell>
                    <Button
                      variant='link'
                      className='min-h-11 px-3'
                      aria-pressed={fn === s.fn}
                      onClick={() => {
                        setFn(fn === s.fn ? 'all' : s.fn)
                        setCov('all')
                        setPage(1)
                      }}
                    >
                      <span className='font-mono'>{s.fn}</span> {CSF_FUNCTIONS[s.fn]}
                    </Button>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>{s.covered}</TableCell>
                  <TableCell className='text-right tabular-nums'>{s.partial}</TableCell>
                  <TableCell className='text-right tabular-nums'>{s.gap}</TableCell>
                  <TableCell className='text-right tabular-nums'>{s.total}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className='font-medium'>All functions</TableCell>
                <TableCell className='text-right tabular-nums'>{total.covered}</TableCell>
                <TableCell className='text-right tabular-nums'>{total.partial}</TableCell>
                <TableCell className='text-right tabular-nums'>{total.gap}</TableCell>
                <TableCell className='text-right tabular-nums'>{total.total}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div className='flex flex-wrap gap-4'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='ev-fn'>Function</Label>
            <select
              id='ev-fn'
              className={selectClass}
              value={fn}
              onChange={(e) => {
                setFn(e.target.value as FnFilter)
                setPage(1)
              }}
            >
              <option value='all'>All functions</option>
              {FUNCTIONS.map((f) => (
                <option key={f} value={f}>
                  {f} {CSF_FUNCTIONS[f]}
                </option>
              ))}
            </select>
          </div>
          <CoverageSegment
            value={cov}
            onChange={(v) => {
              setCov(v)
              setPage(1)
            }}
            counts={{
              all: total.total,
              covered: total.covered,
              partial: total.partial,
              gap: total.gap,
            }}
          />
        </div>

        {visible.length === 0 ? (
          <p className='text-muted-foreground'>No results match these filters.</p>
        ) : (
          <>
            {FUNCTIONS.filter((f) => pageRows.some((r) => r.fn === f)).map((f) => {
              const c = counts(rows.filter((r) => r.fn === f))
              return (
                <section key={f} className='flex flex-col gap-2'>
                  <div>
                    <h2 className='text-xl font-semibold'>
                      <span className='font-mono'>{f}</span> {CSF_FUNCTIONS[f]}
                    </h2>
                    <p className='text-sm'>
                      {c.covered} covered · {c.partial} partial · {c.gap} gap
                    </p>
                  </div>
                  <ul className='divide-y rounded-md border'>
                    {pageRows
                      .filter((r) => r.fn === f)
                      .map((row) => (
                        <EvidenceRow key={row.id} row={row} hash={hash} />
                      ))}
                  </ul>
                </section>
              )
            })}
            <nav
              aria-label='Evidence pages'
              className='flex flex-wrap items-center justify-between gap-3'
            >
              <p className='text-sm tabular-nums'>
                {`Showing ${start + 1}–${Math.min(start + PAGE_SIZE, visible.length)} of ${visible.length}`}
              </p>
              <div className='flex items-center gap-2'>
                <button
                  type='button'
                  className={pageButtonClass}
                  disabled={current <= 1}
                  onClick={() => setPage(current - 1)}
                >
                  Previous
                </button>
                <button
                  type='button'
                  className={pageButtonClass}
                  disabled={current >= totalPages}
                  onClick={() => setPage(current + 1)}
                >
                  Next
                </button>
              </div>
            </nav>
          </>
        )}
      </Main>
    </>
  )
}
