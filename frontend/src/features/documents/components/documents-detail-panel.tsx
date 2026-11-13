import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DetailPanel } from '@/components/detail-panel'
import { SealedTitle } from '@/components/sealed-title'
import { maskTitle } from '@/components/sealed-title-helpers'
import {
  DOC_STATUS_LABEL,
  TLP_BAR,
  accessFor,
  isGrantOnly,
  reviewLabel,
  sessionLimitSeconds,
} from '../helpers'
import { type DocRow } from './documents-columns'

const pad = (n: number) => String(n).padStart(2, '0')

// Only the mime type is exposed by the API; no byte size, so none is shown.
const FILE_TYPE: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
}

export function DocumentsDetailPanel({
  doc,
  onClose,
}: {
  doc: DocRow
  onClose: () => void
}) {
  const access = accessFor(doc)
  const limit = sessionLimitSeconds(doc.tlp)
  const current = doc.versions[0]
  const fileType = current?.file ? FILE_TYPE[current.file.mime] : undefined

  return (
    <DetailPanel
      width={340}
      itemKey={doc.id}
      className='rounded-none border-[.67px] border-line bg-surface p-0'
    >
      <div className='flex min-w-0 flex-col'>
        <div className='flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-3.5 py-2.5'>
          <h2 className='font-mono text-[10px] font-normal tracking-[.08em] text-ink-3 uppercase'>
            Dokumen terpilih
          </h2>
          <button
            type='button'
            aria-label='Tutup panel dokumen'
            onClick={onClose}
            className='inline-flex size-4 items-center justify-center text-ink hover:text-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]'
          >
            <X aria-hidden='true' className='size-3' />
          </button>
        </div>

        <div
          className={`flex min-w-0 items-center justify-between gap-2 px-3.5 py-2 font-mono text-[12px] font-semibold tracking-[.05em] uppercase ${TLP_BAR[doc.tlp]}`}
        >
          <span>TLP:{doc.tlp}</span>
          {isGrantOnly(doc.tlp) && (
            <span className='text-[8.5px] font-normal tracking-[.04em] opacity-90'>
              Hanya lewat grant
            </span>
          )}
        </div>

        <div className='flex min-w-0 flex-col gap-3.5 p-3.5'>
          <header className='flex min-w-0 flex-col gap-2.5'>
            <SealedTitle
              as='h3'
              title={doc.title}
              className='font-heading text-[22px] leading-[25px] font-semibold break-words text-ink'
            />
            <p className='font-mono text-[11.5px] text-ink-3'>
              {doc.id} · versi {current?.version ?? '-'}
              {fileType ? ` · ${fileType}` : ''}
            </p>
          </header>

          <dl aria-label='Metadata dokumen' className='border-t border-line'>
            <Field label='JENIS'>{doc.type}</Field>
            <Field label='PEMILIK'>{doc.owner}</Field>
            <Field label='PENYETUJU'>{doc.approver}</Field>
            <Field label='STATUS'>{DOC_STATUS_LABEL[doc.status]}</Field>
            <Field label='TINJAUAN'>
              {doc.nextReview} · {reviewLabel(doc.nextReview)}
            </Field>
          </dl>

          <section
            aria-labelledby='access-decision'
            className='flex flex-col gap-1 border-[.67px] border-line bg-surface-2 p-3'
          >
            <div className='flex items-center justify-between gap-2'>
              <h3
                id='access-decision'
                className='font-mono text-[8.5px] font-normal tracking-[.06em] text-ink-3 uppercase'
              >
                Akses Anda
              </h3>
              {access !== null && (
                <span className='inline-flex items-center gap-1.5 font-mono text-[10.5px] text-ink-2'>
                  <i
                    aria-hidden='true'
                    className={`size-[5px] shrink-0 rounded-full ${access.permit ? 'bg-pass' : 'bg-fail'}`}
                  />
                  {access.permit
                    ? isGrantOnly(doc.tlp)
                      ? 'Grant aktif'
                      : 'Level aktif'
                    : 'Ditolak'}
                </span>
              )}
            </div>
            {access !== null ? (
              <ul className='space-y-0.5 text-[12px] leading-[1.45] text-ink-2'>
                {access.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className='text-[12px] text-ink-2'>
                Masuk untuk melihat keputusan akses.
              </p>
            )}
            <p className='text-[10.5px] leading-relaxed text-ink-3'>
              Keputusan akses dibuat oleh server. Ringkasan ini bukan otorisasi.
            </p>
          </section>

          <section aria-label='Riwayat versi' className='flex flex-col gap-1.5'>
            <h3 className='font-mono text-[8.5px] font-normal tracking-[.06em] text-ink-3 uppercase'>
              Versi
            </h3>
            <ol className='flex flex-col'>
              {doc.versions.map((version, index) => (
                <li
                  key={version.version}
                  className='flex items-center justify-between gap-2 py-0.5 font-mono'
                >
                  <span className='flex items-center gap-1.5'>
                    <span
                      className={`text-[10.5px] ${index === 0 ? 'text-ink' : 'text-ink-2'}`}
                    >
                      {version.version}
                    </span>
                    <span className='text-[10px] text-ink-3'>
                      {version.date}
                    </span>
                    {index === 0 && (
                      <span className='border-[.67px] border-pass px-1.5 py-0.5 text-[8.5px] tracking-[.04em] text-pass uppercase'>
                        Saat ini
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <Button
            asChild
            className='h-10 justify-between rounded-none border-[.67px] border-ink bg-ink px-[14.67px] text-[14.5px] font-semibold text-bg hover:bg-ink'
          >
            <Link
              to='/viewer'
              search={{ doc: doc.id }}
              aria-label={`Buka ${maskTitle(doc.title)} di penampil aman`}
            >
              <span>Buka penampil aman</span>
              {limit !== null && (
                <span className='font-mono text-[10px] font-semibold tracking-[.04em] tabular-nums'>
                  {pad(Math.floor(limit / 60))}:{pad(limit % 60)}
                </span>
              )}
            </Link>
          </Button>
        </div>
      </div>
    </DetailPanel>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='flex min-w-0 items-center gap-2.5 border-b border-line py-1.5'>
      <dt className='shrink-0 font-mono text-[9px] font-normal tracking-[.04em] text-ink-3 uppercase'>
        {label}
      </dt>
      <dd className='min-w-0 text-left text-[13px] leading-[1.45] text-ink'>
        {children}
      </dd>
    </div>
  )
}
