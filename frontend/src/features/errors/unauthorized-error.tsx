import { Link } from '@tanstack/react-router'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'

export function UnauthorisedError() {
  return (
    <ErrorState
      code='401 · SESI BERAKHIR'
      title='Sesi berakhir'
      desc='Silakan masuk kembali untuk melanjutkan.'
      action={
        <Button asChild size='sm' className='rounded-none bg-primary text-primary-foreground hover:bg-primary/90'>
          <Link to='/sign-in'>Masuk</Link>
        </Button>
      }
    />
  )
}
