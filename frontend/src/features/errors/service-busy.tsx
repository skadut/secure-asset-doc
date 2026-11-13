import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/error-state'

export function ServiceBusy() {
  return (
    <ErrorState
      code='503'
      headerLabel='SISTEM · 5xx'
      headerValue='503'
      icon={<RotateCw aria-hidden='true' />}
      title='Layanan sedang sibuk'
      desc='Modul enkripsi tidak merespons. Data yang Anda lihat tetap yang terakhir berhasil dimuat.'
      action={
        <Button
          size='sm'
          className='h-[30px] rounded-none bg-primary px-3 text-[10.5px] font-semibold text-primary-foreground hover:bg-primary/90'
          onClick={() => window.location.reload()}
        >
          Coba lagi
        </Button>
      }
    />
  )
}
