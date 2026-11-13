import { LockKeyhole } from 'lucide-react'
import { ErrorState } from '@/components/error-state'

export function AccountLocked() {
  return (
    <ErrorState
      tone='fail'
      code='423'
      headerLabel='LOGIN · TERKUNCI'
      headerValue='423'
      icon={<LockKeyhole />}
      title='Akun dikunci'
      desc='Terlalu banyak percobaan gagal. Akun terkunci selama 15 menit setelah percobaan terakhir. Percobaan telah dicatat.'
      footer='PETUGAS KEAMANAN · [EKSTENSI TELEPON]'
    />
  )
}
