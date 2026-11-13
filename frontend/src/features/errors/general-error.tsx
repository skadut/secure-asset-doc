import { Link } from '@tanstack/react-router'
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
          <Link to='/' className='inline-flex items-center underline underline-offset-4'>
            Kembali ke Beranda
          </Link>
        )
      }
    />
  )
}
