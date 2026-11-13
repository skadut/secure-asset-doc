import { Link } from '@tanstack/react-router'
import { FileX } from 'lucide-react'
import { ErrorState } from '@/components/error-state'

// Same card for 404 and 403: never shows the document ID, title or TLP.
export function DocumentUnavailable() {
  return (
    <div className='flex min-h-[60svh] w-full items-center justify-center px-4 py-8'>
      <ErrorState
        code='404'
        headerLabel='INLINE · DOKUMEN'
        headerValue='404 / 403'
        icon={<FileX />}
        title='Dokumen tidak tersedia'
        desc='Dokumen ini tidak ada atau Anda tidak memiliki akses.'
        action={
          <Link
            to='/documents'
            className='relative inline-flex items-center font-mono text-[10.5px] text-ink-2 underline-offset-4 after:absolute after:-inset-x-2 after:-inset-y-4 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]'
          >
            Kembali ke registri
          </Link>
        }
        footer='TIDAK MENAMPILKAN ID, JUDUL, ATAU TLP'
      />
    </div>
  )
}
