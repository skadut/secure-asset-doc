import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { type UploadRecord, uploadFile } from './uploads-api'
import {
  checkUploadFile,
  formatBytes,
  mimeLabel,
  resolveUploadMime,
} from './uploads-helpers'

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
}

function mimeOf(file: File): string {
  return (
    resolveUploadMime(file) ??
    MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ??
    ''
  )
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.txt'

export function UploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<UploadRecord | null>(null)
  const [dragging, setDragging] = useState(false)

  const reset = () => {
    setFile(null)
    setError(null)
    setResult(null)
    setDragging(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next && pending) return
    if (!next) reset()
    onOpenChange(next)
  }

  const pick = (next: File) => {
    const invalid = checkUploadFile(next, resolveUploadMime(next))
    setResult(null)
    if (invalid) {
      setFile(null)
      setError(invalid)
      return
    }
    setFile(next)
    setError(null)
  }

  const submit = async () => {
    if (!file || pending) return
    setPending(true)
    setError(null)
    const outcome = await uploadFile(file)
    setPending(false)
    if (!outcome.ok) {
      setError(outcome.message)
      return
    }
    setResult(outcome.file)
    setFile(null)
    toast.success(`Terenkripsi dan tersimpan: ${outcome.file.name}`)
    void queryClient.invalidateQueries({ queryKey: ['uploads'] })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto rounded-none border-line bg-surface p-0 text-ink sm:max-w-xl'>
        <DialogHeader className='border-b border-line bg-surface-2 px-4 py-3 text-start'>
          <p className='font-mono text-[8.5px] tracking-[1px] text-ink-3 uppercase'>
            Unggah · /sealfile
          </p>
          <DialogTitle className='font-sans text-[14px] font-semibold text-ink'>
            Unggah dokumen terenkripsi
          </DialogTitle>
          <DialogDescription
            id='upload-dialog-desc'
            className='text-[12px] leading-4 text-ink-3'
          >
            Berkas dienkripsi di crypto-api (/sealfile) sebelum disimpan.
            Database hanya menyimpan ciphertext.
          </DialogDescription>
        </DialogHeader>

        <div className='flex min-w-0 flex-col gap-3 px-4 py-4'>
          {result ? (
            <div className='flex min-w-0 flex-col gap-2 border border-line bg-surface-2 p-3'>
              <p className='font-mono text-[9px] tracking-[1px] text-ink-3 uppercase'>
                Tersimpan · terenkripsi
              </p>
              <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]'>
                <dt className='text-ink-3'>Nama</dt>
                <dd className='truncate text-ink'>{result.name}</dd>
                <dt className='text-ink-3'>ID</dt>
                <dd className='truncate font-mono text-[11.5px] text-ink'>
                  {result.id}
                </dd>
                <dt className='text-ink-3'>Jenis</dt>
                <dd className='text-ink'>
                  {mimeLabel(result.mime)} · {formatBytes(result.size)}
                </dd>
                <dt className='text-ink-3'>Waktu</dt>
                <dd className='text-ink'>
                  {new Date(result.uploadedAt).toLocaleString('id-ID')}
                </dd>
              </dl>
              <p className='text-[11.5px] leading-4 text-ink-3'>
                Berkas ini terpisah dari registri dokumen dan hanya bisa dibuka
                melalui /unsealfile.
              </p>
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                id='upload-file'
                type='file'
                accept={ACCEPT}
                className='sr-only'
                onChange={(event) => {
                  const next = event.target.files?.[0]
                  event.target.value = ''
                  if (next) pick(next)
                }}
              />
              <button
                type='button'
                aria-label='Pilih atau letakkan berkas di sini'
                aria-describedby='upload-accept-hint'
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragging(false)
                  const next = event.dataTransfer.files[0]
                  if (next) pick(next)
                }}
                className={cn(
                  'flex min-h-[132px] w-full flex-col items-center justify-center gap-1.5 border border-dashed px-4 py-6 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]',
                  dragging
                    ? 'border-ink bg-surface-active'
                    : 'border-line-2 bg-surface-2 hover:bg-surface-active'
                )}
              >
                <Upload aria-hidden='true' className='size-5 text-ink-3' />
                <span className='text-[13px] font-semibold text-ink'>
                  {file ? file.name : 'Pilih atau letakkan berkas di sini'}
                </span>
                <span
                  id='upload-accept-hint'
                  className='font-mono text-[9.5px] tracking-[.06em] text-ink-3 uppercase'
                >
                  PDF · PNG · JPG · TXT · maks. 10 MB
                </span>
              </button>

              {file && (
                <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]'>
                  <dt className='text-ink-3'>Nama</dt>
                  <dd className='truncate text-ink'>{file.name}</dd>
                  <dt className='text-ink-3'>Jenis</dt>
                  <dd className='text-ink'>
                    {mimeLabel(mimeOf(file))} · {formatBytes(file.size)}
                  </dd>
                </dl>
              )}

              <p
                aria-live='polite'
                className={cn(
                  'min-h-5 text-[12px] leading-4',
                  error ? 'text-destructive' : 'text-ink-3'
                )}
              >
                {error ??
                  (pending
                    ? 'Mengenkripsi dan mengunggah…'
                    : 'Server memeriksa jenis, isi, dan ukuran berkas sebelum disimpan.')}
              </p>
            </>
          )}
        </div>

        <DialogFooter className='border-t border-line px-4 py-3'>
          {result ? (
            <Button
              type='button'
              onClick={() => handleOpenChange(false)}
              className='min-h-11 rounded-none bg-ink px-4 text-[14px] font-semibold text-bg hover:bg-ink'
            >
              Tutup
            </Button>
          ) : (
            <>
              <Button
                type='button'
                variant='outline'
                disabled={pending}
                onClick={() => handleOpenChange(false)}
                className='min-h-11 rounded-none border-line bg-surface px-4 text-[14px] text-ink'
              >
                Batal
              </Button>
              <Button
                type='button'
                disabled={!file || pending}
                onClick={() => void submit()}
                className='min-h-11 gap-2 rounded-none bg-ink px-4 text-[14px] font-semibold text-bg hover:bg-ink'
              >
                {pending && (
                  <LoaderCircle
                    aria-hidden='true'
                    className='size-4 animate-spin motion-reduce:animate-none'
                  />
                )}
                {pending ? 'Mengenkripsi…' : 'Enkripsi & unggah'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
