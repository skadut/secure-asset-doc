import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/error-state'

export function ForbiddenError() {
  return (
    <ErrorState
      tone='dark'
      code='403'
      headerLabel='HALAMAN · 403'
      headerValue='403'
      title='Fitur ini di luar peran Anda'
      desc='Gate server menolak permintaan ini. Hubungi perwira keamanan bila akses dibutuhkan.'
      action={
        <Button
          asChild
          variant='outline'
          size='sm'
          className='h-8 rounded-none border-rail-line bg-transparent px-3 text-[10.5px] text-rail-ink hover:bg-rail-active hover:text-rail-ink'
        >
          <Link to='/'>Kembali</Link>
        </Button>
      }
    />
  )
}
