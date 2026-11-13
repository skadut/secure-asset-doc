import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/error-state'

type GeneralErrorProps = React.HTMLAttributes<HTMLDivElement> & {
  minimal?: boolean
}

export function GeneralError({ minimal = false }: GeneralErrorProps) {
  return (
    <ErrorState
      code='500 · KESALAHAN SERVER'
      title='Terjadi kesalahan'
      desc='Permintaan tidak dapat diproses. Coba lagi.'
      action={
        !minimal && (
          <Button
            asChild
            size='sm'
            className='rounded-none bg-primary text-primary-foreground hover:bg-primary/90'
          >
            <Link to='/'>Kembali ke Beranda</Link>
          </Button>
        )
      }
    />
  )
}
