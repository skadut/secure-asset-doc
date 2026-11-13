import { Link } from '@tanstack/react-router'
import { FileQuestion } from 'lucide-react'
import { ErrorState } from '@/components/error-state'

export function DocumentUnavailable() {
  return (
    <div className='flex min-h-[60svh] w-full items-center justify-center px-4 py-8'>
      <ErrorState
        code='404'
        headerLabel='INLINE · DOKUMEN'
        headerValue='404 / 403'
        icon={<FileQuestion />}
        title='Dokumen tidak tersedia'
        desc='Dokumen ini tidak ada atau Anda tidak memiliki akses.'
        action={
          <Link
            to='/documents'
            className='font-mono text-[9px] text-ink-2 underline underline-offset-4 hover:text-ink'
          >
            Kembali ke registri
          </Link>
        }
        footer='TIDAK MENAMPILKAN ID, JUDUL, ATAU TLP'
      />
    </div>
  )
}
