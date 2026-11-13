import { CloudAlert, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/error-state'

export function ServiceBusy() {
  return (
    <ErrorState
      page
      code='503'
      headerLabel='SISTEM · 5xx'
      headerValue='503'
      icon={<CloudAlert />}
      title='Layanan sedang sibuk'
      desc='Modul enkripsi tidak merespons. Data yang Anda lihat tetap yang terakhir berhasil dimuat.'
      action={
        <Button
          size='sm'
          className='relative h-[30px] gap-1.5 rounded-none bg-ink px-3 text-[12px] font-semibold text-white after:absolute after:inset-x-0 after:-inset-y-[7px] hover:bg-ink/90 has-[>svg]:px-3 dark:text-bg [&_svg]:size-[11px]'
          onClick={() => window.location.reload()}
        >
          <RotateCw aria-hidden='true' />
          Coba lagi
        </Button>
      }
    />
  )
}
