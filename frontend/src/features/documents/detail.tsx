import { type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { CriticalityBadge, DocStatusBadge, ReviewStatusBadge } from '@/components/status-badge'
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
import { getMe } from '@/lib/session'
import { TLP_NOTES, daysUntil, reviewLabel } from './helpers'
import { AccessGrants } from './components/access-grants'
import { DeriveBriefing } from './components/derive-briefing'
import { DocumentUnavailable } from '@/features/errors/document-unavailable'

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
          Semua dokumen
        </Link>

        {doc ? <DocumentBody doc={doc} /> : <DocumentUnavailable />}
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
  const me = getMe()
  const fileUrl = current?.file?.url

  // Status probe: FilePreview hides HTTP status, so check it here (same approach as features/viewer). ponytail: one extra GET; cancelled body.
  const probe = useQuery({
    queryKey: ['document-file-status', fileUrl],
    enabled: Boolean(fileUrl),
    retry: false,
    queryFn: async () => {
      if (!fileUrl) return 0
      const res = await fetch(fileUrl, { credentials: 'same-origin' })
      await res.body?.cancel()
      return res.status
    },
  })

  const unavailable = probe.data === 403 || probe.data === 404
  if (unavailable) return <DocumentUnavailable />

  return (
    <>
      <header className='flex min-w-0 flex-col gap-3'>
        <h1 className='flex min-w-0 flex-wrap items-center gap-3 text-2xl font-bold tracking-tight break-words'>
          {doc.title}
          {doc.granted && <Badge variant='outline'>Diberikan</Badge>}
        </h1>
        <p className='break-words text-muted-foreground'>
          Ringkasan tinjauan, riwayat versi, aset terkait, bukti CSF 2.0, dan aktivitas dokumen ini. Isi dokumen hanya dapat dibuka di penampil aman. Data contoh.
        </p>
        <div className='flex flex-wrap items-center gap-2 text-sm'>
          <span className='font-mono break-all'>{doc.id}</span>
          <span>
            Versi <span className='font-mono tabular-nums'>{current?.version ?? 'tidak ada'}</span>
          </span>
        </div>
      </header>

      <Link
        to='/viewer'
        search={{ doc: doc.id }}
        className='inline-flex min-h-11 w-fit items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      >
        Buka di penampil aman
      </Link>

      <section className='flex min-w-0 flex-col gap-3'>
        <h2 className='text-lg font-semibold'>Ringkasan tinjauan</h2>
        <dl className='grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2'>
          <Field label='Status'>
            <DocStatusBadge status={doc.status} />
          </Field>
          <Field label='TLP'>
            <span className='flex flex-col gap-1'>
              <TlpBadge tlp={doc.tlp} />
              <span className='text-sm font-normal'>{TLP_NOTES[doc.tlp]}</span>
            </span>
          </Field>
          <Field label='Jenis'>{doc.type}</Field>
          <Field label='Pemilik'>{doc.owner}</Field>
          <Field label='Penyetuju'>{doc.approver}</Field>
          <Field label='Tinjauan berikutnya'>
            <span className='flex flex-wrap items-center gap-2'>
              <span className='font-mono tabular-nums'>{doc.nextReview}</span>
              <ReviewStatusBadge days={daysUntil(doc.nextReview)} date={reviewLabel(doc.nextReview)} />
            </span>
          </Field>
          <Field label='Disetujui oleh (versi saat ini)'>
            {current?.approvedBy ?? 'Belum disetujui'}
          </Field>
        </dl>
      </section>

      <section className='flex min-w-0 flex-col gap-3'>
        <h2 className='text-lg font-semibold'>Riwayat versi</h2>
        {doc.versions.length ? (
          <>
            <ol className='flex min-w-0 flex-col'>
              {doc.versions.map((version, index) => (
                <li
                  key={version.version}
                  className='relative ml-1.5 flex min-w-0 flex-col border-l pb-4 pl-5 last:border-l-transparent last:pb-0'
                >
                  <span
                    aria-hidden='true'
                    className='absolute -left-1.5 top-1.5 size-3 rounded-full border bg-background'
                  />
                  <div className='flex min-w-0 flex-col gap-1 p-3'>
                    <span className='flex flex-wrap items-center gap-2'>
                      <span className='font-mono break-all'>{version.version}</span>
                      {index === 0 && <Badge variant='outline'>Saat ini</Badge>}
                      <time dateTime={version.date} className='font-mono tabular-nums text-muted-foreground'>
                        {version.date}
                      </time>
                    </span>
                    <span className='text-sm text-muted-foreground break-words'>{version.author}</span>
                    <span className='break-words'>{version.summary}</span>
                    <span className='text-sm break-words'>
                      {version.approvedBy ? `Disetujui oleh ${version.approvedBy}` : 'Belum disetujui'}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className='text-muted-foreground'>Belum ada versi untuk dokumen ini.</p>
        )}
      </section>

      <section className='flex min-w-0 flex-col gap-6'>
        <h2 className='text-lg font-semibold'>Relasi</h2>

        <div className='flex min-w-0 flex-col gap-3'>
          <h3 className='font-semibold'>Aset terkait</h3>
          {linkedAssets.length ? (
            <div className='overflow-x-auto rounded-md border'>
              <Table className='min-w-3xl'>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Nama</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead>Lokasi</TableHead>
                    <TableHead>Kekritisan</TableHead>
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
            <p className='text-muted-foreground'>Tidak ada aset yang terkait dengan dokumen ini.</p>
          )}
        </div>

        <div className='flex min-w-0 flex-col gap-3'>
          <h3 className='font-semibold'>Bukti CSF 2.0</h3>
          {!docIsCurrent && (
            <p className='text-sm break-words'>
              Dihitung sebagai bukti parsial sampai disetujui dan dalam tanggal tinjauan.
            </p>
          )}
          {subcategories.length ? (
            <div className='overflow-x-auto rounded-md border'>
              <Table className='min-w-2xl'>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subkategori</TableHead>
                    <TableHead>Fungsi</TableHead>
                    <TableHead>Hasil</TableHead>
                    <TableHead>
                      <span className='sr-only'>Register bukti</span>
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
                        <Link
                          to='/evidence'
                          hash={`subcategory-${sub.id}`}
                          className='underline underline-offset-4'
                        >
                          Lihat bukti
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className='text-muted-foreground'>Tidak ada subkategori CSF 2.0 yang merujuk dokumen ini.</p>
          )}
        </div>
      </section>

      <section className='flex min-w-0 flex-col gap-3'>
        <h2 className='text-lg font-semibold'>Aktivitas</h2>
        {events.length ? (
          <ol className='flex min-w-0 flex-col gap-3 text-sm'>
            {events.map((event) => (
              <ActivityItem key={event.id} event={event} />
            ))}
          </ol>
        ) : (
          <p className='text-muted-foreground'>Belum ada aktivitas tercatat untuk dokumen ini.</p>
        )}
      </section>

      <DeriveBriefing documentId={doc.id} parentTlp={doc.tlp} />
      {me?.can.access?.grant && <AccessGrants documentId={doc.id} />}
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className='flex min-w-0 flex-col gap-0.5'>
      <dt className='text-sm text-muted-foreground'>{label}</dt>
      <dd className='font-medium break-words'>{children}</dd>
    </div>
  )
}

function ActivityItem({ event }: { event: AuditEvent }) {
  return (
    <li className='flex min-w-0 flex-col gap-1 border-b pb-3 last:border-0'>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground'>
        <time dateTime={event.at} className='font-mono tabular-nums'>
          {event.at}
        </time>
        <span className='break-words'>{event.actor}</span>
        <span className='font-mono break-all'>{event.action}</span>
      </div>
      <p className='break-words'>{event.summary}</p>
      {event.changes?.map((change) => (
        <p key={change.field} className='font-mono text-xs break-all'>
          {change.field}: {change.from} → {change.to}
        </p>
      ))}
    </li>
  )
}
