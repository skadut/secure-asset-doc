import { Link } from '@tanstack/react-router'
import { LockKeyholeOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/error-state'

export function UnauthorisedError() {
  return (
    <ErrorState
      code='401'
      headerLabel='SESI BERAKHIR'
      headerValue='401'
      icon={<LockKeyholeOpen />}
      title='Sesi berakhir'
      desc='Sesi terkunci setelah 5 menit tanpa aktivitas. Masuk kembali untuk melanjutkan.'
      action={
        <Button
          asChild
          size='sm'
          className='h-8 rounded-none bg-primary px-3 text-[10.5px] font-semibold text-primary-foreground hover:bg-primary/90'
        >
          <Link to='/sign-in'>Masuk kembali</Link>
        </Button>
      }
    />
  )
}
