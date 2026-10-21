import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { CriticalityBadge, DocStatusBadge } from '@/components/status-badge'
import { TlpBadge } from '@/components/tlp-badge'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  type AuditEvent,
  type Document,
  CSF_FUNCTIONS,
} from '@/data/grc'
import {
  assetsForDocument,
  auditFor,
  getDocument,
  isDocCurrent,
  subcategoriesForDocument,
} from '@/lib/grc'
import { TLP_NOTES, reviewLabel } from './helpers'

export function DocumentDetail({ documentId }: { documentId: string }) {
  const doc = getDocument(documentId)

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-6'>
        <Link to='/documents' className='w-fit text-sm underline underline-offset-4'>
          All documents
        </Link>

        {doc ? (
          <DocumentBody doc={doc} />
        ) : (
          <div className='flex flex-col gap-2'>
            <h1 className='text-2xl font-bold tracking-tight'>Document not found</h1>
            <p className='text-muted-foreground'>
              No document has ID <span className='font-mono'>{documentId}</span>. Sample data.
            </p>
          </div>
        )}
      </Main>
    </>
  )
}

function DocumentBody({ doc }: { doc: Document }) {
  const current = doc.versions[0]
  const linkedAssets = assetsForDocument(doc.id)
  const subcategories = subcategoriesForDocument(doc.id)
  const events = auditFor('document', doc.id)
  const docIsCurrent = isDocCurrent(doc)

  return (
    <>
      <header className='flex flex-col gap-3'>
        <h1 className='text-2xl font-bold tracking-tight'>{doc.title}</h1>
        <p className='text-muted-foreground'>
          Version history, linked assets, CSF 2.0 evidence and activity for this document. Sample data.
        </p>
        <div className='flex flex-wrap items-center gap-2 text-sm'>
          <span className='font-mono'>{doc.id}</span>
          <TlpBadge tlp={doc.tlp} />
          <DocStatusBadge status={doc.status} />
          <span>
            Version <span className='font-mono tabular-nums'>{current.version}</span>
          </span>
        </div>
        <p className='text-sm'>{TLP_NOTES[doc.tlp]}</p>
      </header>

      <section className='flex flex-col gap-3'>
        <h2 className='text-lg font-semibold'>Document details</h2>
        <dl className='grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2'>
          <Field label='Type'>{doc.type}</Field>
          <Field label='Owner'>{doc.owner}</Field>
          <Field label='Approver'>{doc.approver}</Field>
          <Field label='Next review'>
            <span className='font-mono tabular-nums'>{doc.nextReview}</span>{' '}
            <span>({reviewLabel(doc.nextReview)})</span>
          </Field>
          <Field label='Approved by (current version)'>
            {current.approvedBy ?? 'Not approved'}
          </Field>
        </dl>
      </section>

      <section className='flex flex-col gap-3'>
        <h2 className='text-lg font-semibold'>Version history</h2>
        <div className='overflow-hidden rounded-md border'>
          <Table className='min-w-3xl'>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Change summary</TableHead>
                <TableHead>Approval</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {doc.versions.map((version, index) => (
                <TableRow key={version.version}>
                  <TableCell className='font-mono'>
                    {version.version}
                    {index === 0 && (
                      <Badge variant='outline' className='ms-2'>
                        Current
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className='font-mono tabular-nums'>{version.date}</TableCell>
                  <TableCell>{version.author}</TableCell>
                  <TableCell className='whitespace-normal'>{version.summary}</TableCell>
                  <TableCell>
                    {version.approvedBy ? `Approved by ${version.approvedBy}` : 'Not approved'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className='flex flex-col gap-3'>
        <h2 className='text-lg font-semibold'>Linked assets</h2>
        {linkedAssets.length ? (
          <div className='overflow-hidden rounded-md border'>
            <Table className='min-w-3xl'>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Criticality</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linkedAssets.map((asset) => (
                  <TableRow key={asset.id}>
                    <TableCell>
                      <Link
                        to='/assets/$assetId'
                        params={{ assetId: asset.id }}
                        className='font-mono underline underline-offset-4'
                      >
                        {asset.id}
                      </Link>
                    </TableCell>
                    <TableCell>{asset.name}</TableCell>
                    <TableCell>{asset.type}</TableCell>
                    <TableCell>{asset.site}</TableCell>
                    <TableCell>
                      <CriticalityBadge criticality={asset.criticality} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className='text-muted-foreground'>No assets are linked to this document.</p>
        )}
      </section>

      <section className='flex flex-col gap-3'>
        <h2 className='text-lg font-semibold'>CSF 2.0 evidence</h2>
        {!docIsCurrent && (
          <p className='text-sm'>
            Counts as partial evidence until approved and within review date.
          </p>
        )}
        {subcategories.length ? (
          <div className='overflow-hidden rounded-md border'>
            <Table className='min-w-2xl'>
              <TableHeader>
                <TableRow>
                  <TableHead>Subcategory</TableHead>
                  <TableHead>Function</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>
                    <span className='sr-only'>Evidence register</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subcategories.map((sub) => (
                  <TableRow key={sub.id}>
                    <TableCell className='font-mono'>{sub.id}</TableCell>
                    <TableCell>{CSF_FUNCTIONS[sub.fn]}</TableCell>
                    <TableCell className='whitespace-normal'>{sub.outcome}</TableCell>
                    <TableCell>
                      <Link to='/evidence' className='underline underline-offset-4'>
                        View evidence
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className='text-muted-foreground'>No CSF 2.0 subcategories cite this document.</p>
        )}
      </section>

      <section className='flex flex-col gap-3'>
        <h2 className='text-lg font-semibold'>Activity</h2>
        {events.length ? (
          <ol className='flex flex-col gap-3 text-sm'>
            {events.map((event) => (
              <ActivityItem key={event.id} event={event} />
            ))}
          </ol>
        ) : (
          <p className='text-muted-foreground'>No activity recorded for this document.</p>
        )}
      </section>
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='flex flex-col gap-0.5'>
      <dt className='text-sm text-muted-foreground'>{label}</dt>
      <dd className='font-medium'>{children}</dd>
    </div>
  )
}

function ActivityItem({ event }: { event: AuditEvent }) {
  return (
    <li className='flex flex-col gap-1 border-b pb-3 last:border-0'>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground'>
        <time dateTime={event.at} className='font-mono tabular-nums'>
          {event.at}
        </time>
        <span>{event.actor}</span>
        <span className='font-mono'>{event.action}</span>
      </div>
      <p>{event.summary}</p>
      {event.changes?.map((change) => (
        <p key={change.field} className='font-mono text-xs'>
          {change.field}: {change.from} → {change.to}
        </p>
      ))}
    </li>
  )
}
