import { RotateCw } from 'lucide-react'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'

export function MaintenanceError() {
  return (
    <ErrorState
      code='503 · PEMELIHARAAN'
      title='Layanan sedang dipelihara'
      desc='Coba beberapa menit lagi.'
      action={
        <Button size='sm' className='rounded-none bg-primary text-primary-foreground hover:bg-primary/90' onClick={() => window.location.reload()}>
          <RotateCw aria-hidden='true' />
          Coba lagi
        </Button>
      }
    />
  )
}
