import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/empty-state'
import { SkeletonRows } from '@/components/skeleton-rows'
import {
  fetchUploads,
  openUploadContent,
  type UploadRecord,
} from './uploads-api'
import { formatBytes, mimeLabel } from './uploads-helpers'

export function UploadsPanel() {
  const [preview, setPreview] = useState<UploadRecord | null>(null)
  const uploads = useQuery({
    queryKey: ['uploads'],
    queryFn: fetchUploads,
    staleTime: 30_000,
    retry: false,
  })

  return (
    <section
      aria-label='Berkas terunggah terenkripsi'
      className='flex min-w-0 flex-col gap-2'
    >
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h2 className='font-mono text-[10px] tracking-[.08em] text-ink-3 uppercase'>
          Berkas terunggah · terenkripsi
        </h2>
        <p className='font-mono text-[9.5px] tracking-[.06em] text-ink-3 uppercase'>
          /unsealfile oleh server · bukan versi dokumen
        </p>
      </div>
      <p className='max-w-[70ch] text-[12px] leading-4 text-ink-3'>
        Berkas ini disimpan terpisah dari registri dokumen, hanya sebagai
        ciphertext. Membuka berkas meminta server mendekripsi lewat crypto-api
        (/unsealfile).
      </p>

      {uploads.isPending && (
        <div className='border border-line bg-surface'>
          <SkeletonRows
            headerLabel='MEMUAT · BERKAS'
            headerValue='50 TERBARU'
          />
        </div>
      )}

      {uploads.isError && (
        <div
          role='alert'
          className='flex flex-wrap items-center justify-between gap-3 border border-line bg-surface px-3 py-3 text-[12.5px] text-ink-2'
        >
          <span>
            {uploads.error instanceof Error
              ? uploads.error.message
              : 'Berkas terunggah gagal dimuat.'}
          </span>
          <Button
            type='button'
            variant='outline'
            onClick={() => void uploads.refetch()}
            className='min-h-11 rounded-none border-line bg-surface px-3 text-[12px] text-ink'
          >
            Coba lagi
          </Button>
        </div>
      )}

      {uploads.isSuccess && uploads.data.length === 0 && (
        <EmptyState
          title='Belum ada berkas terunggah'
          desc='Unggah berkas lewat tombol Unggah dokumen. Berkas dienkripsi sebelum disimpan.'
          icon={<Upload />}
        />
      )}

      {uploads.isSuccess && uploads.data.length > 0 && (
        <ul className='border border-line bg-surface'>
          <li className='grid grid-cols-[minmax(0,1fr)_84px_84px] gap-3 border-b border-line bg-surface-2 px-3 py-1.5 font-mono text-[8.5px] tracking-[.09em] text-ink-3 uppercase min-[900px]:grid-cols-[minmax(0,1fr)_72px_84px_150px_132px]'>
            <span>Nama</span>
            <span className='hidden min-[900px]:block'>Jenis</span>
            <span className='hidden min-[900px]:block'>Ukuran</span>
            <span>Diunggah oleh</span>
            <span className='text-right'>Waktu</span>
          </li>
          {uploads.data.map((record) => (
            <li
              key={record.id}
              className='grid min-h-[52px] grid-cols-[minmax(0,1fr)_84px_84px] items-center gap-3 border-b border-line px-3 py-1.5 last:border-b-0 hover:bg-surface-active min-[900px]:grid-cols-[minmax(0,1fr)_72px_84px_150px_132px]'
            >
              <div className='min-w-0'>
                <p
                  className='truncate text-[12.5px] text-ink'
                  title={record.name}
                >
                  {record.name}
                </p>
                <p className='font-mono text-[9px] text-ink-3 min-[900px]:hidden'>
                  {mimeLabel(record.mime)} · {formatBytes(record.size)} ·{' '}
                  {new Date(record.uploadedAt).toLocaleString('id-ID')}
                </p>
              </div>
              <span className='hidden text-[12px] text-ink-2 min-[900px]:block'>
                {mimeLabel(record.mime)}
              </span>
              <span className='hidden font-mono text-[11px] text-ink-2 min-[900px]:block'>
                {formatBytes(record.size)}
              </span>
              <span className='truncate text-[12px] text-ink-2'>
                {record.uploadedBy ?? '—'}
              </span>
              <div className='flex justify-end'>
                <button
                  type='button'
                  onClick={() => setPreview(record)}
                  className='inline-flex min-h-11 items-center justify-center border border-line bg-surface px-3 text-[12px] text-ink hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]'
                >
                  Buka (dekripsi)
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <PreviewDialog
          key={preview.id}
          record={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  )
}

function PreviewDialog({
  record,
  onClose,
}: {
  record: UploadRecord
  onClose: () => void
}) {
  const [view, setView] = useState<{ url?: string; text?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pending = view === null && error === null

  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    openUploadContent(record.id)
      .then(async ({ blob }) => {
        if (record.mime === 'text/plain') {
          const text = await blob.text()
          if (!cancelled) setView({ text })
          return
        }
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setView({ url })
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error ? cause.message : 'Berkas gagal dibuka.'
          )
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [record])

  const text = record.mime === 'text/plain'

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className='max-h-[90dvh] overflow-y-auto rounded-none border-line bg-surface p-0 text-ink sm:max-w-3xl'>
        <DialogHeader className='border-b border-line bg-surface-2 px-4 py-3 text-start'>
          <p className='font-mono text-[8.5px] tracking-[1px] text-ink-3 uppercase'>
            Buka · /unsealfile
          </p>
          <DialogTitle className='truncate font-sans text-[14px] font-semibold text-ink'>
            {record.name}
          </DialogTitle>
          <DialogDescription className='text-[12px] leading-4 text-ink-3'>
            Dekripsi dilakukan di server melalui crypto-api. Isi berkas tidak
            disimpan di browser.
          </DialogDescription>
        </DialogHeader>

        <div className='flex min-w-0 flex-col gap-3 px-4 py-4'>
          <p aria-live='polite' className='min-h-5 text-[12px] text-ink-3'>
            {pending
              ? 'Mendekripsi via server…'
              : error
                ? ''
                : 'Berkas didekripsi.'}
          </p>
          {error && (
            <p role='alert' className='text-[12.5px] text-destructive'>
              {error}
            </p>
          )}
          {view?.url &&
            (record.mime === 'application/pdf' ? (
              <iframe
                src={view.url}
                title={`Pratinjau ${record.name}`}
                className='h-[70vh] w-full border border-line bg-surface-2'
              />
            ) : (
              <img
                src={view.url}
                alt={`Pratinjau ${record.name}`}
                className='mx-auto max-h-[70vh] max-w-full border border-line'
              />
            ))}
          {text && view?.text !== undefined && (
            <pre className='max-h-[70vh] overflow-auto border border-line bg-surface-2 p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap text-ink'>
              {view.text}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
