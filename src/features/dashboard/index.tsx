import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { CoverageBadge, DocStatusBadge } from '@/components/status-badge'
import { ThemeSwitch } from '@/components/theme-switch'
import { TlpBadge } from '@/components/tlp-badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  assets,
  auditEvents,
  csfSubcategories,
  documents,
  TODAY,
  type AuditEvent,
} from '@/data/grc'
import { coverage } from '@/lib/grc'

const LIMIT = 6
const DAY_MS = 86_400_000

// Whole days from TODAY to an ISO date. Negative means in the past.
const daysFromToday = (iso: string) =>
  Math.round(
    (new Date(`${iso}T00:00:00Z`).getTime() -
      new Date(`${TODAY}T00:00:00Z`).getTime()) /
      DAY_MS
  )

const dueLabel = (days: number) => {
  if (days < 0) return 'Overdue'
  if (days === 0) return 'Due today'
  return `Due in ${days} day${days === 1 ? '' : 's'}`
}

const docsToReview = documents
  .map((doc) => ({ doc, days: daysFromToday(doc.nextReview) }))
  .filter((row) => row.days <= 30)
  .sort((a, b) => a.days - b.days)

const csfGaps = csfSubcategories
  .map((subcategory) => ({ subcategory, cov: coverage(subcategory.id) }))
  .filter((row) => row.cov !== 'covered')
  .sort((a, b) => Number(b.cov === 'gap') - Number(a.cov === 'gap'))

const staleHighAssets = assets
  .filter((asset) => asset.criticality === 'high')
  .filter((asset) => daysFromToday(asset.lastReviewed) < -365)
  .sort((a, b) => a.lastReviewed.localeCompare(b.lastReviewed))

const recentActivity: AuditEvent[] = [...auditEvents]
  .sort((a, b) => b.at.localeCompare(a.at))
  .slice(0, 8)

const summary = [
  `${docsToReview.length} documents need review`,
  `${csfGaps.length} CSF 2.0 subcategories lack current evidence`,
  `${staleHighAssets.length} high-criticality assets not reviewed in 365 days`,
].join(' · ')

export function Dashboard() {
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
        <div className='mb-3 space-y-1'>
          <h1 className='text-2xl font-bold tracking-tight'>Overview</h1>
          <p className='text-sm text-muted-foreground'>
            What needs attention across assets, documents and CSF 2.0
            evidence. Sample data.
          </p>
        </div>
        <p className='mb-6 text-sm tabular-nums'>
          {summary}{' '}
          <span className='text-muted-foreground'>(as of {TODAY})</span>
        </p>

        <div className='grid gap-6 lg:grid-cols-2'>
          <Section
            title='Documents overdue or due within 30 days'
            action={<Link to='/documents'>View all</Link>}
          >
            {docsToReview.length === 0 ? (
              <Empty>Nothing overdue or due soon.</Empty>
            ) : (
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>TLP</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Next review</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {docsToReview.slice(0, LIMIT).map(({ doc, days }) => (
                      <TableRow key={doc.id}>
                        <TableCell className='font-mono text-xs tabular-nums'>
                          <Link
                            to='/documents/$documentId'
                            params={{ documentId: doc.id }}
                            className='underline underline-offset-4'
                          >
                            {doc.id}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className='max-w-48 truncate' title={doc.title}>
                            {doc.title}
                          </div>
                        </TableCell>
                        <TableCell>
                          <TlpBadge tlp={doc.tlp} />
                        </TableCell>
                        <TableCell>
                          <DocStatusBadge status={doc.status} />
                        </TableCell>
                        <TableCell className='text-xs tabular-nums'>
                          <span className='font-mono'>{doc.nextReview}</span>
                          <span className='ms-2 text-muted-foreground'>
                            {dueLabel(days)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          <Section
            title='CSF 2.0 subcategories without current evidence'
            action={<Link to='/evidence'>View all</Link>}
          >
            {csfGaps.length === 0 ? (
              <Empty>Every subcategory has current evidence.</Empty>
            ) : (
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Coverage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {csfGaps.slice(0, LIMIT).map(({ subcategory, cov }) => (
                      <TableRow key={subcategory.id}>
                        <TableCell className='font-mono text-xs'>
                          {subcategory.id}
                        </TableCell>
                        <TableCell>
                          <div
                            className='max-w-xs truncate'
                            title={subcategory.outcome}
                          >
                            {subcategory.outcome}
                          </div>
                        </TableCell>
                        <TableCell>
                          <CoverageBadge coverage={cov} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          <Section
            title='High-criticality assets with review older than 365 days'
            action={<Link to='/assets'>View all</Link>}
          >
            {staleHighAssets.length === 0 ? (
              <Empty>Nothing overdue.</Empty>
            ) : (
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Last reviewed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staleHighAssets.slice(0, LIMIT).map((asset) => (
                      <TableRow key={asset.id}>
                        <TableCell className='font-mono text-xs'>
                          <Link
                            to='/assets/$assetId'
                            params={{ assetId: asset.id }}
                            className='underline underline-offset-4'
                          >
                            {asset.id}
                          </Link>
                        </TableCell>
                        <TableCell>{asset.name}</TableCell>
                        <TableCell>{asset.site}</TableCell>
                        <TableCell className='font-mono text-xs tabular-nums'>
                          {asset.lastReviewed}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Section>

          <Section
            title='Recent activity'
            action={<Link to='/audit-log'>View all</Link>}
          >
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time (UTC)</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead>Object</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentActivity.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className='font-mono text-xs tabular-nums'>
                        {event.at.slice(0, 16).replace('T', ' ')}
                      </TableCell>
                      <TableCell className='font-mono text-xs'>
                        {event.actor}
                      </TableCell>
                      <TableCell>
                        <div className='max-w-xs truncate' title={event.summary}>
                          {event.summary}
                        </div>
                      </TableCell>
                      <TableCell>
                        <ObjectLink event={event} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Section>
        </div>
      </Main>
    </>
  )
}

function ObjectLink({ event }: { event: AuditEvent }) {
  const className = 'font-mono text-xs underline underline-offset-4'
  if (event.objectType === 'asset') {
    return (
      <Link
        to='/assets/$assetId'
        params={{ assetId: event.objectId }}
        className={className}
      >
        {event.objectId}
      </Link>
    )
  }
  if (event.objectType === 'document') {
    return (
      <Link
        to='/documents/$documentId'
        params={{ documentId: event.objectId }}
        className={className}
      >
        {event.objectId}
      </Link>
    )
  }
  return (
    <Link to='/evidence' className={className}>
      {event.objectId}
    </Link>
  )
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action: ReactNode
  children: ReactNode
}) {
  return (
    <section className='min-w-0 space-y-2'>
      <div className='flex items-baseline justify-between gap-2'>
        <h2 className='text-sm font-semibold'>{title}</h2>
        <span className='text-sm'>{action}</span>
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
      {children}
    </p>
  )
}
