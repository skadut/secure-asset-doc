import { Link } from '@tanstack/react-router'
import { TimerOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/error-state'

export function UnauthorisedError() {
  return (
    <ErrorState
      page
      code='401'
      headerLabel='SESI BERAKHIR'
      headerValue='401'
      icon={<TimerOff />}
      title='Sesi berakhir'
      desc='Sesi terkunci setelah 5 menit tanpa aktivitas. Masuk kembali untuk melanjutkan.'
      action={
        <Button
          asChild
          size='sm'
          className='relative h-8 rounded-none bg-ink px-3 text-[12px] font-semibold text-white after:absolute after:inset-x-0 after:-inset-y-1.5 hover:bg-ink/90 dark:text-bg'
        >
          <Link to='/sign-in'>Masuk kembali</Link>
        </Button>
      }
    />
  )
}
