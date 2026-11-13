import { RotateCw } from 'lucide-react'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'

export function ServiceBusy() {
  return (
    <ErrorState
      code='503 · LAYANAN SIBUK'
      title='Layanan sedang sibuk'
      desc='Permintaan belum dapat dilayani. Coba lagi beberapa saat.'
      action={
        <Button size='sm' className='rounded-none bg-primary text-primary-foreground hover:bg-primary/90' onClick={() => window.location.reload()}>
          <RotateCw aria-hidden='true' />
          Coba lagi
        </Button>
      }
    />
  )
}
