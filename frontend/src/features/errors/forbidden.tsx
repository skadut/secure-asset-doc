import { Link } from '@tanstack/react-router'
import { ErrorState } from '@/components/error-state'

export function ForbiddenError() {
  return (
    <ErrorState
      code='403 · AKSES DITOLAK'
      title='Akses ditolak'
      desc='Peran Anda tidak memiliki izin untuk halaman ini.'
      action={<Link to='/documents' className='inline-flex items-center underline underline-offset-4'>Kembali ke Registri</Link>}
    />
  )
}
