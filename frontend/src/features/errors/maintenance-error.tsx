import { ErrorState } from '@/components/error-state'

export function MaintenanceError() {
  return (
    <ErrorState
      code='503 · PEMELIHARAAN'
      title='Layanan sedang dipelihara'
      desc='Coba beberapa menit lagi.'
      action={<button type='button' onClick={() => window.location.reload()} className='underline underline-offset-4'>Muat ulang</button>}
    />
  )
}
