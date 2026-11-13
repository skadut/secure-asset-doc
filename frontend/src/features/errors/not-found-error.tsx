import { Link } from '@tanstack/react-router'
import { ErrorState } from '@/components/error-state'

export function NotFoundError() {
  return (
    <ErrorState
      code='404 · TIDAK DITEMUKAN'
      title='Halaman tidak ditemukan'
      desc='Halaman yang Anda cari mungkin sudah dihapus atau alamatnya salah.'
      action={<Link to='/documents' className='inline-flex items-center underline underline-offset-4'>Kembali ke Registri</Link>}
    />
  )
}
