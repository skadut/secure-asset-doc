import { Link } from '@tanstack/react-router'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'

export function ForbiddenError() {
  return (
    <ErrorState
      tone='dark'
      code='403 · AKSES DITOLAK'
      title='Akses ditolak'
      desc='Peran Anda tidak memiliki izin untuk halaman ini.'
      action={
        <Button asChild variant='outline' size='sm' className='rounded-none border-rail-line bg-transparent text-rail-ink hover:bg-rail-active hover:text-rail-ink'>
          <Link to='/documents'>Kembali ke Registri</Link>
        </Button>
      }
    />
  )
}
