import { Link } from '@tanstack/react-router'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'

export function DocumentUnavailable() {
  return (
    <div className='flex min-h-[60svh] w-full items-center justify-center px-4 py-8'>
      <ErrorState
        code='DOKUMEN · TIDAK TERSEDIA'
        title='Dokumen tidak tersedia'
        desc='Dokumen ini tidak ada atau Anda tidak memiliki akses.'
        action={
          <Button asChild variant='outline' size='sm' className='rounded-none'>
            <Link to='/documents'>Kembali ke registri</Link>
          </Button>
        }
      />
    </div>
  )
}
