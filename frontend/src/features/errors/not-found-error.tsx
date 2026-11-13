import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/error-state'

export function NotFoundError() {
  return (
    <ErrorState
      code='404'
      headerLabel='HALAMAN · 404'
      headerValue='404'
      title='Halaman tidak ditemukan'
      desc='Tautan mungkin sudah berpindah. Kembali ke dashboard untuk melanjutkan.'
      action={
        <Button
          asChild
          size='sm'
          className='h-8 rounded-none bg-primary px-3 text-[10.5px] font-semibold text-primary-foreground hover:bg-primary/90'
        >
          <Link to='/'>Kembali ke dashboard</Link>
        </Button>
      }
    />
  )
}
