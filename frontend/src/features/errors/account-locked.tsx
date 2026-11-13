import { Link } from '@tanstack/react-router'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'

export function AccountLocked() {
  return (
    <ErrorState
      tone='fail'
      code='423 · AKUN DIKUNCI'
      title='Akun dikunci'
      desc='Terlalu banyak percobaan masuk. Hubungi petugas keamanan sistem.'
      action={
        <Button asChild size='sm' className='rounded-none bg-primary text-primary-foreground hover:bg-primary/90'>
          <Link to='/'>Kembali ke Beranda</Link>
        </Button>
      }
    />
  )
}
