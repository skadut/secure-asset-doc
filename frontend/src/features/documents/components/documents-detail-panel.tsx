import { Link } from '@tanstack/react-router'
import { getMe } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { DetailPanel } from '@/components/detail-panel'
import { TlpMark } from '@/components/tlp-mark'
import { Chip } from '@/components/chip'
import { DocStatusBadge } from '@/components/status-badge'
import { TLP_NOTES, reviewLabel } from '../helpers'
import { accessFor, type DocRow } from './documents-columns'

export function DocumentsDetailPanel({ doc }: { doc: DocRow }) {
  const me = getMe()
  const access = accessFor(doc)
  const latest = doc.versions[0]

  return (
    <DetailPanel
      width={340}
      itemKey={doc.id}
      className='rounded-none border-line bg-surface p-0'
    >
      <div className='flex min-w-0 flex-col gap-3 p-1'>
        <header className='flex min-w-0 flex-col gap-2 border-b border-line pb-3'>
          <div className='flex min-w-0 items-start justify-between gap-2'>
            <span className='font-mono text-[10px] text-ink-3'>{doc.id}</span>
            <TlpMark tlp={doc.tlp} />
          </div>
          <h2 className='break-words text-[15px] font-semibold leading-[1.3] text-ink'>
            {doc.title}
          </h2>
          <p className='text-[10px] leading-relaxed text-ink-2'>
            {TLP_NOTES[doc.tlp]}
          </p>
        </header>

        <dl aria-label='Metadata dokumen' className='grid gap-0'>
          <Field label='JENIS'>{doc.type}</Field>
          <Field label='PEMILIK'>{doc.owner}</Field>
          <Field label='PENYETUJU'>{doc.approver}</Field>
          <Field label='STATUS'>
            <DocStatusBadge status={doc.status} />
          </Field>
          <Field label='VERSI SAAT INI'>
            <span className='font-mono'>{latest?.version ?? '-'}</span>
          </Field>
          <Field label='TINJAUAN BERIKUTNYA'>
            <span className='flex flex-wrap items-center gap-1.5 font-mono'>
              {doc.nextReview}
              <span className='font-sans text-[9px] text-ink-3'>
                {reviewLabel(doc.nextReview)}
              </span>
            </span>
          </Field>
        </dl>

        <section aria-labelledby='access-decision' className='flex flex-col gap-2 border-t border-line pt-3'>
          <div className='flex items-center justify-between gap-2'>
            <h3 id='access-decision' className='font-mono text-[9px] font-medium uppercase tracking-[.08em] text-ink'>
              Akses akun
            </h3>
            <Chip tone={access === null ? 'line' : access.permit ? 'pass' : 'fail'}>
              {access === null ? 'BELUM MASUK' : access.permit ? 'DIIZINKAN' : 'DITOLAK'}
            </Chip>
          </div>
          {access !== null ? (
            <ul className='list-disc space-y-1 ps-4 text-[10px] leading-relaxed text-ink-2'>
              {access.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : (
            <p className='text-[10px] text-ink-2'>Masuk untuk melihat keputusan akses.</p>
          )}
          <p className='text-[9px] leading-relaxed text-ink-3'>
            Keputusan akses dibuat oleh server. Ringkasan ini bukan otorisasi.
          </p>
        </section>

        <div className='grid gap-1.5 border-t border-line pt-3'>
          <Button asChild className='min-h-10 rounded-none text-[11px]'>
            <Link
              to='/viewer'
              search={{ doc: doc.id }}
              aria-label={`Buka ${doc.title} di penampil aman`}
            >
              Buka penampil aman
            </Link>
          </Button>
          <Button asChild variant='outline' className='min-h-10 rounded-none border-line-strong text-[11px]'>
            <Link to='/documents/$documentId' params={{ documentId: doc.id }}>
              Detail dokumen
            </Link>
          </Button>
          {me?.can.access?.request && (
            <Button asChild variant='ghost' className='min-h-10 rounded-none text-[11px]'>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex min-w-0 items-start justify-between gap-3 border-b border-line-subtle py-2'>
      <dt className='shrink-0 font-mono text-[8px] uppercase tracking-[.06em] text-ink-3'>
        {label}
      </dt>
      <dd className='min-w-0 text-right text-[10px] leading-[1.4] text-ink-2'>
        {children}
      </dd>
    </div>
  )
}
