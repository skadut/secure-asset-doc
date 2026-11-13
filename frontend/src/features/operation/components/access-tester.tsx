import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Shield, X } from 'lucide-react'
import { ApiError, listGrants, type DirectoryUser } from '@/lib/access-api'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CardPanel } from '@/components/card-panel'
import { explainOperationAccess } from '../access'
import { grantsKey, type OperationDocument } from '../api'
import { LevelBadge } from './level-badge'

const SCALE = [
  { level: 1, text: 'CLEAR · GREEN' },
  { level: 2, text: 's.d. AMBER' },
  { level: 3, text: 's.d. AMBER+STRICT' },
  { level: 4, text: 's.d. RED' },
  { level: 5, text: 'Semua TLP · RED+STRICT via grant' },
] as const

export function AccessTester({
  users,
  docs,
}: {
  users: DirectoryUser[]
  docs: OperationDocument[]
}) {
  const [username, setUsername] = useState('')
  const [docId, setDocId] = useState('')
  const user = users.find((u) => u.username === username)
  const doc = docs.find((d) => d.id === docId)

  const grants = useQuery({
    queryKey: grantsKey(docId),
    queryFn: () => listGrants(docId),
    enabled: docId !== '',
    retry: false,
  })

  let result: { permit: boolean; reasons: string[] } | null = null
  let message = 'Pilih pengguna dan dokumen untuk menguji akses.'
  if (user && doc) {
    if (grants.isError)
      message =
        grants.error instanceof ApiError ? grants.error.message : 'Gagal memuat'
    else if (grants.data) {
      const hasActive = grants.data.some(
        (g) => g.username === user.username && g.active
      )
      result = explainOperationAccess(user.accessLevel, doc.tlp, hasActive)
    } else message = 'Memuat hak akses dokumen...'
  }

  return (
    <CardPanel
      title='UJI KEPUTUSAN AKSES'
      meta='SIMULASI'
      className='op-panel min-w-0'
    >
      <div className='op-panel-scroll flex flex-col gap-2.5 p-3.5'>
        <div className='flex min-w-0 flex-col gap-1'>
          <Label
            htmlFor='tester-user'
            className='font-mono text-[7.5px] tracking-[0.75px] text-ink-3 uppercase'
          >
            PENGGUNA
          </Label>
          <Select value={username} onValueChange={setUsername}>
            <SelectTrigger
              id='tester-user'
              className='h-[34px] w-full rounded-none font-mono text-[10px]'
            >
              <SelectValue placeholder='Pilih pengguna'>
                {user && (
                  <span className='flex items-center gap-2'>
                    <span>{user.username}</span>
                    <LevelBadge level={user.accessLevel} />
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.username} value={u.username}>
                  <span className='flex items-center gap-2 font-mono text-[10px]'>
                    <span>{u.username}</span>
                    <LevelBadge level={u.accessLevel} />
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='flex min-w-0 flex-col gap-1'>
          <Label
            htmlFor='tester-doc'
            className='font-mono text-[7.5px] tracking-[0.75px] text-ink-3 uppercase'
          >
            DOKUMEN
          </Label>
          <Select value={docId} onValueChange={setDocId}>
            <SelectTrigger
              id='tester-doc'
              className='h-[34px] w-full rounded-none font-mono text-[10px]'
            >
              <SelectValue placeholder='Pilih dokumen'>
                {doc && `${doc.id} · TLP:${doc.tlp}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {docs.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  <span className='font-mono text-[10px]'>
                    {d.id} · TLP:{d.tlp}
                    {d.title ? ` — ${d.title}` : ''}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          role='status'
          aria-live='polite'
          className='flex flex-col gap-[5px] border border-line bg-surface-2 p-[10.67px]'
        >
          {result ? (
            <>
              <div className='flex items-center gap-1.5 font-mono text-[9px] font-semibold tracking-[0.54px]'>
                {result.permit ? (
                  <>
                    <Check
                      aria-hidden='true'
                      className='size-3.5 text-[#1e7b45]'
                    />
                    <span className='text-[#1e7b45]'>IZINKAN</span>
                  </>
                ) : (
                  <>
                    <X aria-hidden='true' className='size-3.5 text-[#9b1c1c]' />
                    <span className='text-[#9b1c1c]'>TOLAK</span>
                  </>
                )}
              </div>
              <p className='font-sans text-[10px] leading-[15px] text-ink-2'>
                {result.reasons.join('. ')}
              </p>
            </>
          ) : (
            <p className='font-mono text-[10px] text-ink-3'>{message}</p>
          )}
        </div>

        <div className='flex items-start gap-2 border border-line p-2.5'>
          <Shield
            aria-hidden='true'
            className='mt-0.5 size-3 shrink-0 text-ink'
          />
          <p className='font-mono text-[9px] leading-[14px] tracking-[0.72px] text-ink-3'>
            Simulasi hanya penjelasan tampilan. Server tetap memutuskan setiap
            permintaan file (404 bila tidak berhak).
          </p>
        </div>

        <div className='mt-1 flex flex-col gap-1.5 border-t border-line pt-2.5'>
          <p className='font-mono text-[7px] tracking-[0.7px] text-ink-3 uppercase'>
            LEGENDA
          </p>
          <div className='flex flex-col gap-1.5 font-mono text-[7.5px] text-ink-3'>
            <span className='flex items-center gap-1.5'>
              <span
                aria-hidden='true'
                className='size-2 shrink-0 bg-[#2f6b4a]'
              />
              Grant aktif · dapat dicabut
            </span>
            <span className='flex items-center gap-1.5'>
              <span
                aria-hidden='true'
                className='size-2 shrink-0 bg-[#a3aba2]'
              />
              Lewat level akses · terkunci
            </span>
            <span className='flex items-center gap-1.5'>
              <span
                aria-hidden='true'
                className='size-2 shrink-0 bg-[#8a6200]'
              />
              Grant kedaluwarsa
            </span>
          </div>

          <p className='mt-2 font-mono text-[7px] tracking-[0.7px] text-ink-3 uppercase'>
            SKALA LEVEL AKSES
          </p>
          <ul className='flex flex-col gap-1.5'>
            {SCALE.map((s) => (
              <li key={s.level} className='flex items-center gap-2'>
                <LevelBadge level={s.level} />
                <span className='font-mono text-[7.5px] text-ink-3'>
                  {s.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </CardPanel>
  )
}
