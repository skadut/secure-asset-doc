import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, listGrants, type DirectoryUser } from '@/lib/access-api'
import { CardPanel } from '@/components/card-panel'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
    <CardPanel title='Uji keputusan akses' meta='simulasi' className='min-w-0'>
      <div className='flex flex-col gap-4 p-3.5'>
        <div className='flex min-w-0 flex-col gap-1.5'>
          <Label
            htmlFor='tester-user'
            className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'
          >
            Pengguna
          </Label>
          <Select value={username} onValueChange={setUsername}>
            <SelectTrigger id='tester-user' className='h-9 w-full rounded-none'>
              <SelectValue placeholder='Pilih pengguna' />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.username} value={u.username}>
                  {u.username} · Level {u.accessLevel}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='flex min-w-0 flex-col gap-1.5'>
          <Label
            htmlFor='tester-doc'
            className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'
          >
            Dokumen
          </Label>
          <Select value={docId} onValueChange={setDocId}>
            <SelectTrigger id='tester-doc' className='h-9 w-full rounded-none'>
              <SelectValue placeholder='Pilih dokumen' />
            </SelectTrigger>
            <SelectContent>
              {docs.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.title ? `${d.id} · ${d.title}` : d.id} · TLP:{d.tlp}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          role='status'
          aria-live='polite'
          className='min-w-0 border border-line bg-surface-2 p-3'
        >
          {result ? (
            <>
              <p
                className={`flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.08em] ${
                  result.permit ? 'text-pass' : 'text-fail'
                }`}
              >
                <span aria-hidden='true'>{result.permit ? '✓' : '×'}</span>
                {result.permit ? 'Diizinkan' : 'Ditolak'}
              </p>
              <ul className='mt-2 list-disc ps-5 text-[11px] leading-normal text-ink-2'>
                {result.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className='text-[11px] text-ink-3'>{message}</p>
          )}
        </div>

        <p className='text-[10px] text-ink-3'>
          Keputusan final dibuat oleh server.
        </p>

        <div className='flex flex-col gap-2 border-t border-line pt-3'>
          <p className='font-mono text-[8px] uppercase tracking-[.1em] text-ink-3'>
            Skala level akses
          </p>
          <ul className='flex flex-col gap-1.5'>
            {SCALE.map((s) => (
              <li key={s.level} className='flex items-center gap-2 text-[10px] text-ink-2'>
                <LevelBadge level={s.level} />
                <span>{s.text}</span>
              </li>
            ))}
          </ul>
          <div className='flex flex-wrap gap-x-3 gap-y-1 pt-1 font-mono text-[8px] text-ink-3'>
            <span className='flex items-center gap-1.5'>
              <i aria-hidden='true' className='size-2 bg-pass' />
              Grant aktif · dapat dicabut
            </span>
            <span className='flex items-center gap-1.5'>
              <i aria-hidden='true' className='size-2 bg-ink-3' />
              Lewat level akses
            </span>
            <span className='flex items-center gap-1.5'>
              <i aria-hidden='true' className='size-2 bg-warn' />
              Grant kedaluwarsa
            </span>
          </div>
        </div>
      </div>
    </CardPanel>
  )
}
