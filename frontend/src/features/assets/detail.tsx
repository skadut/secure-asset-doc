import { Link } from '@tanstack/react-router'
import { ArrowLeftIcon } from '@radix-ui/react-icons'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { AssetStatusBadge, CriticalityBadge, DocStatusBadge, ReviewStatusBadge } from '@/components/status-badge'
import { TlpBadge } from '@/components/tlp-badge'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CSF_FUNCTIONS, type Asset } from '@/data/grc'
import {
  auditFor,
  documentsForAsset,
  getAsset,
  subcategoriesForAsset,
} from '@/lib/grc'
import { isReviewOverdue } from './columns'

const dateTime = (iso: string) =>
  new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className='flex flex-col gap-1'>
      <dt className='text-sm text-muted-foreground'>{label}</dt>
      <dd className={mono ? 'font-mono tabular-nums' : undefined}>{children}</dd>
    </div>
  )
}

function Details({ asset }: { asset: Asset }) {
  return (
    <section aria-labelledby='asset-details' className='flex flex-col gap-3'>
      <h2 id='asset-details' className='text-lg font-semibold tracking-tight'>Asset details</h2>
      <dl className='grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3'>
        <Field label='Type'>{asset.type}</Field>
        <Field label='Site'>{asset.site}</Field>
        <Field label='Sector'>{asset.sector}</Field>
        <Field label='Purdue level' mono>{asset.purdueLevel}</Field>
        <Field label='IEC 62443 zone'>{asset.zone}</Field>
        <Field label='Vendor'>{asset.vendor}</Field>
        <Field label='Model' mono>{asset.model}</Field>
        <Field label='Firmware' mono>{asset.firmware}</Field>
        <Field label='IP address' mono>{asset.ipAddress}</Field>
        <Field label='Owner'>{asset.owner}</Field>
        <Field label='Last reviewed'>
          <span className='flex flex-wrap items-center gap-x-2'>
            <span className='font-mono tabular-nums'>{asset.lastReviewed}</span>
            {isReviewOverdue(asset.lastReviewed) && <ReviewStatusBadge days={-1} />}
          </span>
        </Field>
      </dl>
    </section>
  )
}

function LinkedDocuments({ assetId }: { assetId: string }) {
  const docs = documentsForAsset(assetId)
  return (
    <section aria-labelledby='linked-documents' className='flex flex-col gap-3'>
      <h2 id='linked-documents' className='text-lg font-semibold tracking-tight'>Linked documents</h2>
      {docs.length === 0 ? (
        <p className='text-muted-foreground'>No linked documents.</p>
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table className='min-w-3xl'>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>TLP</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Current version</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell>
                    <Link
                      to='/documents/$documentId'
                      params={{ documentId: doc.id }}
                      className='font-mono underline underline-offset-4'
                    >
                      {doc.id}
                    </Link>
                  </TableCell>
                  <TableCell className='whitespace-normal'>{doc.title}</TableCell>
                  <TableCell>{doc.type}</TableCell>
                  <TableCell><TlpBadge tlp={doc.tlp} /></TableCell>
                  <TableCell><DocStatusBadge status={doc.status} /></TableCell>
                  <TableCell className='font-mono tabular-nums'>{doc.versions[0]?.version ?? 'No version recorded'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

function CsfEvidence({ assetId }: { assetId: string }) {
  const subcategories = subcategoriesForAsset(assetId)
  return (
    <section aria-labelledby='csf-evidence' className='flex flex-col gap-3'>
      <h2 id='csf-evidence' className='text-lg font-semibold tracking-tight'>CSF 2.0 evidence</h2>
      {subcategories.length === 0 ? (
        <p className='text-muted-foreground'>No CSF 2.0 subcategories linked to this asset.</p>
      ) : (
        <ul className='flex flex-col divide-y rounded-md border'>
          {subcategories.map((sub) => (
            <li key={sub.id} className='flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:gap-4'>
              <div className='flex shrink-0 flex-col gap-1 sm:w-40'>
                <span className='font-mono font-medium'>{sub.id}</span>
                <Badge variant='outline' className='w-fit'>{CSF_FUNCTIONS[sub.fn]}</Badge>
              </div>
              <p className='min-w-0 flex-1 text-sm'>{sub.outcome}</p>
              <Link
                to='/evidence'
                hash={`subcategory-${sub.id}`}
                className='shrink-0 text-sm underline underline-offset-4'
              >
                View in evidence
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ChangeHistory({ assetId }: { assetId: string }) {
  const events = auditFor('asset', assetId)
  return (
    <section aria-labelledby='change-history' className='flex flex-col gap-3'>
      <h2 id='change-history' className='text-lg font-semibold tracking-tight'>Change history</h2>
      {events.length === 0 ? (
        <p className='text-muted-foreground'>No recorded changes.</p>
      ) : (
        <ol className='flex flex-col gap-4'>
          {events.map((event) => (
            <li key={event.id} className='flex flex-col gap-1 border-l pl-4'>
              <div className='flex flex-wrap items-center gap-x-3 text-sm'>
                <time dateTime={event.at} className='font-mono tabular-nums'>{dateTime(event.at)}</time>
                <span className='text-muted-foreground'>{event.actor}</span>
                <Badge variant='outline'>{event.action}</Badge>
              </div>
              <p>{event.summary}</p>
              {event.changes && (
                <ul className='font-mono text-sm'>
                  {event.changes.map((change) => (
                    <li key={change.field}>
                      {change.field}: {change.from} → {change.to}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function AssetDetail({ assetId }: { assetId: string }) {
  const asset = getAsset(assetId)

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-6'>
        <Link to='/assets' className='inline-flex w-fit items-center gap-1 text-sm underline underline-offset-4'>
          <ArrowLeftIcon className='size-4' aria-hidden />
          All assets
        </Link>

        {asset ? (
          <>
            <div className='flex flex-col gap-2'>
              <h1 className='text-2xl font-bold tracking-tight'>{asset.name}</h1>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-mono'>{asset.id}</span>
                <Separator orientation='vertical' className='h-4' />
                <CriticalityBadge criticality={asset.criticality} />
                <AssetStatusBadge status={asset.status} />
              </div>
              <p className='text-muted-foreground'>
                Asset record with linked documents, CSF 2.0 evidence and change history. Sample data.
              </p>
            </div>

            <Details asset={asset} />
            <Separator />
            <LinkedDocuments assetId={asset.id} />
            <Separator />
            <CsfEvidence assetId={asset.id} />
            <Separator />
            <ChangeHistory assetId={asset.id} />
          </>
        ) : (
          <>
            <h1 className='text-2xl font-bold tracking-tight'>Asset not found</h1>
            <p className='text-muted-foreground'>
              No asset with ID <span className='font-mono'>{assetId}</span>. Sample data.
            </p>
            <p>
              <Link to='/assets' className='underline underline-offset-4'>Back to assets</Link>
            </p>
          </>
        )}
      </Main>
    </>
  )
}
