import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/error-state'

export function NotFoundError() {
  return (
    <ErrorState
      page
      code='404'
      headerLabel='HALAMAN · 404'
      headerValue='404'
      title='Halaman tidak ditemukan'
      desc='Tautan mungkin sudah berpindah. Kembali ke dashboard untuk melanjutkan.'
      action={
        <Button
          asChild
          size='sm'
          className='relative h-8 rounded-none bg-ink px-3 text-[12px] font-semibold text-white after:absolute after:inset-x-0 after:-inset-y-1.5 hover:bg-ink/90 dark:text-bg'
        >
          <Link to='/'>Kembali ke dashboard</Link>
        </Button>
      }
    />
  )
}
