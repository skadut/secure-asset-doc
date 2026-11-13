import { ErrorState } from '@/components/error-state'

export function ServiceBusy() {
  return (
    <ErrorState
      code='503 · LAYANAN SIBUK'
      title='Layanan sedang sibuk'
      desc='Permintaan belum dapat dilayani. Coba lagi beberapa saat.'
      action={<button type='button' onClick={() => window.location.reload()} className='underline underline-offset-4'>Muat ulang</button>}
    />
  )
}
