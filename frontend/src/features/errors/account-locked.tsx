import { Lock } from 'lucide-react'
import { ErrorState } from '@/components/error-state'

const pad = (n: number) => String(n).padStart(2, '0')

// lockedUntil: ISO time from the backend 423 body. Without it, no time is invented.
export function AccountLocked({
  lockedUntil,
}: {
  lockedUntil?: string | null
}) {
  const at = lockedUntil ? new Date(lockedUntil) : null
  const time =
    at && !Number.isNaN(at.getTime())
      ? `${pad(at.getHours())}:${pad(at.getMinutes())}`
      : null
  return (
    <ErrorState
      tone='fail'
      code='423'
      headerLabel='LOGIN · TERKUNCI'
      headerValue='423'
      icon={<Lock />}
      title='Akun dikunci'
      desc={
        time
          ? `Terlalu banyak percobaan gagal. Akun aktif kembali pukul ${time}. Percobaan telah dicatat.`
          : 'Terlalu banyak percobaan gagal. Akun ini dikunci selama 15 menit. Percobaan telah dicatat.'
      }
      footer='PETUGAS KEAMANAN · [EKSTENSI TELEPON]'
    />
  )
}
