import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/error-state'

export function ForbiddenError() {
  return (
    <ErrorState
      page
      tone='dark'
      code='403'
      headerLabel='HALAMAN · 403 (MODE GELAP)'
      headerValue='403'
      title='Fitur ini di luar peran Anda'
      desc='Gate server menolak permintaan ini. Hubungi perwira keamanan bila akses dibutuhkan.'
      action={
        <Button
          asChild
          variant='outline'
          size='sm'
          className='relative h-8 rounded-none border-rail-line bg-transparent px-3 text-[12px] font-normal text-rail-ink shadow-none after:absolute after:inset-x-0 after:-inset-y-1.5 hover:bg-rail-active hover:text-rail-ink'
        >
          <Link to='/'>Kembali</Link>
        </Button>
      }
    />
  )
}
