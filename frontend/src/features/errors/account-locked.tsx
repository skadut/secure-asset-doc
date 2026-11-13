import { Link } from '@tanstack/react-router'
import { ErrorState } from '@/components/error-state'

export function AccountLocked() {
  return (
    <ErrorState
      code='423 · AKUN DIKUNCI'
      title='Akun dikunci'
      desc='Terlalu banyak percobaan masuk. Hubungi petugas keamanan sistem.'
      action={<Link to='/' className='inline-flex items-center underline underline-offset-4'>Kembali ke Beranda</Link>}
    />
  )
}
