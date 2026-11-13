import { Link } from '@tanstack/react-router'
import { ErrorState } from '@/components/error-state'

export function UnauthorisedError() {
  return (
    <ErrorState
      code='401 · BELUM MASUK'
      title='Sesi tidak valid'
      desc='Silakan masuk kembali untuk melanjutkan.'
      action={<Link to='/sign-in' className='inline-flex items-center underline underline-offset-4'>Masuk</Link>}
    />
  )
}
