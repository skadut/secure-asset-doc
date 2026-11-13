import { Link } from '@tanstack/react-router'
import { getMe } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { DetailPanel } from '@/components/detail-panel'
import { Chip } from '@/components/chip'
import { DocStatusBadge } from '@/components/status-badge'
import {
  TLP_BAR,
  TLP_NOTES,
  accessFor,
  isGrantOnly,
  reviewLabel,
  sessionLimitSeconds,
} from '../helpers'
import { type DocRow } from './documents-columns'

const pad = (n: number) => String(n).padStart(2, '0')

export function DocumentsDetailPanel({ doc }: { doc: DocRow }) {
  const me = getMe()
  const access = accessFor(doc)
  const limit = sessionLimitSeconds(doc.tlp)

  return (
    <DetailPanel
      width={340}
      itemKey={doc.id}
      className='rounded-none border-line bg-surface p-0'
    >
      <div className='flex min-w-0 flex-col'>
        <p className='border-b border-line px-3 py-2 font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>
          Dokumen terpilih
        </p>

        <div className={`flex min-w-0 items-center justify-between gap-2 px-3 py-1.5 font-mono text-[9px] font-medium uppercase tracking-[.06em] ${TLP_BAR[doc.tlp]}`}>
          <span>TLP:{doc.tlp}</span>
          {isGrantOnly(doc.tlp) && <span className='text-[8px] opacity-80'>Hanya lewat grant</span>}
        </div>

        <div className='flex min-w-0 flex-col gap-3 p-3'>
          <header className='flex min-w-0 flex-col gap-1.5'>
            <h2 className='break-words text-[17px] font-semibold leading-[1.2] text-ink'>
              {doc.title}
            </h2>
            <p className='font-mono text-[9px] text-ink-3'>
              {doc.id} · versi {doc.versions[0]?.version ?? '-'}
            </p>
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
            <Field label='TINJAUAN'>
              <span className='flex flex-wrap items-center gap-1.5 font-mono'>
                {doc.nextReview}
                <span className='font-sans text-[9px] text-ink-3'>
                  {reviewLabel(doc.nextReview)}
                </span>
              </span>
            </Field>
          </dl>

          <section aria-labelledby='access-decision' className='flex flex-col gap-2 border border-line bg-surface-2 p-2.5'>
            <div className='flex items-center justify-between gap-2'>
              <h3 id='access-decision' className='font-mono text-[8px] font-normal uppercase tracking-[.08em] text-ink-3'>
                Akses Anda
              </h3>
              <Chip tone={access === null ? 'line' : access.permit ? 'pass' : 'fail'}>
                {access === null ? 'Belum masuk' : access.permit ? (isGrantOnly(doc.tlp) ? 'Grant' : 'Level') : 'Ditolak'}
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

          <section aria-label='Riwayat versi' className='flex flex-col border-t border-line pt-2'>
            <h3 className='pb-1 font-mono text-[8px] font-normal uppercase tracking-[.08em] text-ink-3'>Versi</h3>
            <ol className='flex flex-col'>
              {doc.versions.map((version, index) => (
                <li
                  key={version.version}
                  className='flex items-center justify-between gap-2 border-b border-line-subtle py-1.5 font-mono text-[10px] text-ink'
                >
                  <span className='flex items-center gap-1.5'>
                    {version.version}
                    {index === 0 && (
                      <span className='border border-line-strong px-1 text-[7px] font-normal uppercase text-ink-2'>
                        Saat ini
                      </span>
                    )}
                  </span>
                  <span className='text-[9px] text-ink-3'>{version.date}</span>
                </li>
              ))}
            </ol>
          </section>

          <div className='grid gap-1.5 border-t border-line pt-3'>
            <Button asChild className='h-auto min-h-10 justify-between rounded-none px-3 text-[11px]'>
              <Link
                to='/viewer'
                search={{ doc: doc.id }}
                aria-label={`Buka ${doc.title} di penampil aman`}
              >
                <span>Buka penampil aman</span>
                {limit !== null && (
                  <span className='font-mono text-[10px] tabular-nums opacity-80'>
                    {pad(Math.floor(limit / 60))}:{pad(limit % 60)}
                  </span>
                )}
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
