import { Link } from '@tanstack/react-router'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'

export function NotFoundError() {
  return (
    <ErrorState
      code='404 · HALAMAN'
      title='Halaman tidak ditemukan'
      desc='Halaman yang Anda cari mungkin sudah dihapus atau alamatnya salah.'
      action={
        <>
          <Button asChild size='sm' className='rounded-none bg-primary text-primary-foreground hover:bg-primary/90'>
            <Link to='/'>Kembali ke dashboard</Link>
          </Button>
          <Button asChild variant='outline' size='sm' className='rounded-none'>
            <Link to='/documents'>Kembali ke Registri</Link>
          </Button>
        </>
      }
    />
  )
}
