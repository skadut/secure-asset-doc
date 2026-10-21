// ponytail: local filter state; move to URL search params for shareable filters
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { CoverageBadge, DocStatusBadge } from '@/components/status-badge'
import { TlpBadge } from '@/components/tlp-badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
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
  'h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

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

const byCategory = (list: Row[]) => {
  const groups = new Map<string, Row[]>()
  list.forEach((r) => groups.set(r.category, [...(groups.get(r.category) ?? []), r]))
  return [...groups.values()]
}

const countText = (items: Item[]) => {
  const docs = items.filter((i) => i.doc).length
  const assets = items.length - docs
  return [
    docs ? (docs === 1 ? '1 document' : `${docs} documents`) : '',
    assets ? (assets === 1 ? '1 asset' : `${assets} assets`) : '',
  ]
    .filter(Boolean)
    .join(', ')
}

function EvidenceItem({ item }: { item: Item }) {
  return (
    <li className='flex flex-wrap items-center gap-x-3 gap-y-1'>
      {item.doc ? (
        <>
          <Link
            to='/documents/$documentId'
            params={{ documentId: item.doc.id }}
            className='font-mono text-sm underline underline-offset-4'
          >
            {item.doc.id}
          </Link>
          <span className='font-medium'>{item.doc.title}</span>
          <TlpBadge tlp={item.doc.tlp} />
          <DocStatusBadge status={item.doc.status} />
          <span className='font-mono text-sm tabular-nums text-muted-foreground'>
            v{item.doc.versions[0].version}
          </span>
        </>
      ) : (
        <>
          <Link
            to='/assets/$assetId'
            params={{ assetId: item.asset!.id }}
            className='font-mono text-sm underline underline-offset-4'
          >
            {item.asset!.id}
          </Link>
          <span className='font-medium'>{item.asset!.name}</span>
        </>
      )}
      <span className='basis-full text-muted-foreground'>{item.note}</span>
    </li>
  )
}

function SubcategoryRow({ row }: { row: Row }) {
  const [open, setOpen] = useState(false)
  const hasEvidence = row.items.length > 0

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='border-b last:border-b-0'>
      <div className='flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between'>
        <div className='flex min-w-0 flex-col gap-1'>
          <span className='font-mono text-sm tabular-nums'>{row.id}</span>
          <p className='text-sm'>{row.outcome}</p>
        </div>
        <div className='flex shrink-0 flex-wrap items-center gap-2'>
          <CoverageBadge coverage={row.coverage} />
          {hasEvidence ? (
            <CollapsibleTrigger asChild>
              <Button variant='outline' size='sm'>
                {countText(row.items)}
              </Button>
            </CollapsibleTrigger>
          ) : (
            <span className='text-sm text-muted-foreground'>No evidence linked.</span>
          )}
        </div>
      </div>
      {hasEvidence && (
        <CollapsibleContent>
          <ul className='flex flex-col gap-3 border-t px-4 py-3 text-sm'>
            {row.items.map((item, i) => (
              <EvidenceItem key={i} item={item} />
            ))}
          </ul>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

export function Evidence() {
  const [fn, setFn] = useState<FnFilter>('all')
  const [cov, setCov] = useState<CovFilter>('all')

  const visible = rows.filter(
    (r) => (fn === 'all' || r.fn === fn) && (cov === 'all' || r.coverage === cov)
  )
  const total = counts(rows)

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-6'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>CSF 2.0 evidence</h1>
          <p className='text-muted-foreground'>
            Evidence linked to a 21-subcategory subset of NIST CSF 2.0. Coverage
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
                      className='h-auto p-0'
                      aria-pressed={fn === s.fn}
                      onClick={() => setFn(s.fn)}
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
              onChange={(e) => setFn(e.target.value as FnFilter)}
            >
              <option value='all'>All functions</option>
              {FUNCTIONS.map((f) => (
                <option key={f} value={f}>
                  {f} {CSF_FUNCTIONS[f]}
                </option>
              ))}
            </select>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='ev-cov'>Coverage</Label>
            <select
              id='ev-cov'
              className={selectClass}
              value={cov}
              onChange={(e) => setCov(e.target.value as CovFilter)}
            >
              <option value='all'>All coverage</option>
              <option value='covered'>Covered</option>
              <option value='partial'>Partial</option>
              <option value='gap'>Gap</option>
            </select>
          </div>
        </div>

        {visible.length === 0 ? (
          <p className='text-muted-foreground'>No results match these filters.</p>
        ) : (
          FUNCTIONS.filter((f) => visible.some((r) => r.fn === f)).map((f) => (
            <section key={f} className='flex flex-col gap-4'>
              <h2 className='text-xl font-semibold'>
                <span className='font-mono'>{f}</span> {CSF_FUNCTIONS[f]}
              </h2>
              {byCategory(visible.filter((r) => r.fn === f)).map((list) => (
                <div key={list[0].category} className='flex flex-col gap-2'>
                  <h3 className='font-medium'>
                    <span className='font-mono'>{list[0].category}</span>{' '}
                    {list[0].categoryName}
                  </h3>
                  <div className='rounded-md border'>
                    {list.map((row) => (
                      <SubcategoryRow key={row.id} row={row} />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))
        )}
      </Main>
    </>
  )
}
