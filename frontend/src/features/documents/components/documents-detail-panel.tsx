import { Link } from '@tanstack/react-router'
import { getMe } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { DetailPanel } from '@/components/detail-panel'
import { DocStatusBadge } from '@/components/status-badge'
import { TlpBadge } from '@/components/tlp-badge'
import { TLP_NOTES, reviewLabel } from '../helpers'
import { accessFor, type DocRow } from './documents-columns'

export function DocumentsDetailPanel({ doc }: { doc: DocRow }) {
  const me = getMe()
  const access = accessFor(doc)

  return (
    <DetailPanel width={380} itemKey={doc.id}>
      <div className='flex flex-col gap-5'>
        <div className='flex flex-col gap-2'>
          <span className='font-mono text-sm text-muted-foreground'>
            {doc.id}
          </span>
          <h2 className='text-lg font-semibold'>{doc.title}</h2>
          <div>
            <TlpBadge tlp={doc.tlp} />
          </div>
          <p className='text-sm text-muted-foreground'>{TLP_NOTES[doc.tlp]}</p>
        </div>

        <dl className='grid gap-3 border-y py-4 text-sm'>
          <div>
            <dt className='text-muted-foreground'>Jenis</dt>
            <dd>{doc.type}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Pemilik</dt>
            <dd>{doc.owner}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Penyetuju</dt>
            <dd>{doc.approver}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Status</dt>
            <dd>
              <DocStatusBadge status={doc.status} />
            </dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Versi saat ini</dt>
            <dd className='font-mono'>{doc.versions[0]?.version ?? '-'}</dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>Tinjauan berikutnya</dt>
            <dd className='font-mono'>
              {doc.nextReview}{' '}
              <span className='font-sans text-muted-foreground'>
                ({reviewLabel(doc.nextReview)})
              </span>
            </dd>
          </div>
        </dl>

        <section
          aria-labelledby='access-decision'
          className='flex flex-col gap-2'
        >
          <h3 id='access-decision' className='font-medium'>
            Keputusan akses
          </h3>
          {access === null ? (
            <p className='text-sm text-muted-foreground'>
              Masuk untuk melihat keputusan akses.
            </p>
          ) : (
            <>
              <p
                className={
                  access.permit ? 'text-sm text-pass' : 'text-sm text-fail'
                }
              >
                {access.permit ? 'Diizinkan' : 'Ditolak'}
              </p>
              <ul className='list-disc space-y-1 ps-5 text-sm text-muted-foreground'>
                {access.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </>
          )}
          <p className='text-xs text-muted-foreground'>
            Keputusan akses dibuat oleh server. Tampilan ini hanya menjelaskan
            hasil untuk akun Anda.
          </p>
        </section>

        <div className='flex flex-col gap-2'>
          <Button asChild>
            <Link
              to='/viewer'
              search={{ doc: doc.id }}
              aria-label={`Buka ${doc.title} di penampil aman`}
            >
              Buka penampil aman
            </Link>
          </Button>
          <Button asChild variant='outline'>
            <Link to='/documents/$documentId' params={{ documentId: doc.id }}>
              Detail dokumen
            </Link>
          </Button>
          {me?.can.access?.request && (
            <Button asChild variant='ghost'>
              <Link to='/requests' search={{ doc: doc.id }}>
                Ajukan akses
              </Link>
            </Button>
          )}
        </div>
      </div>
    </DetailPanel>
  )
}
