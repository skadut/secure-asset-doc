import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ApiError, listGrants, type DirectoryUser } from '@/lib/access-api'
import { explainOperationAccess } from '../access'
import { grantsKey, type OperationDocument } from '../api'

export function AccessTester({ users, docs }: { users: DirectoryUser[]; docs: OperationDocument[] }) {
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
    if (grants.isError) message = grants.error instanceof ApiError ? grants.error.message : 'Gagal memuat'
    else if (grants.data) {
      const hasActive = grants.data.some((g) => g.username === user.username && g.active)
      result = explainOperationAccess(user.accessLevel, doc.tlp, hasActive)
    } else message = 'Memuat hak akses dokumen...'
  }

  return (
    <section className='flex min-w-0 flex-col gap-4'>
      <div>
        <h2 className='text-base font-semibold'>Uji keputusan akses</h2>
        <p className='text-sm text-muted-foreground'>Simulasi aturan di sisi klien, tanpa membuka dokumen.</p>
      </div>

      <div className='grid min-w-0 gap-3 sm:grid-cols-2'>
        <div className='flex min-w-0 flex-col gap-1.5'>
          <Label htmlFor='tester-user'>Pengguna</Label>
          <Select value={username} onValueChange={setUsername}>
            <SelectTrigger id='tester-user' className='h-11 w-full'>
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
          <Label htmlFor='tester-doc'>Dokumen</Label>
          <Select value={docId} onValueChange={setDocId}>
            <SelectTrigger id='tester-doc' className='h-11 w-full'>
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
      </div>

      <div role='status' aria-live='polite' className='flex min-w-0 flex-col gap-3 rounded-md border bg-card p-4'>
        {result ? (
          <>
            <Badge variant='outline' className='w-fit text-sm font-semibold'>
              {result.permit ? 'Diizinkan' : 'Ditolak'}
            </Badge>
            <ul className='list-disc ps-5 text-sm'>
              {result.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className='text-sm text-muted-foreground'>{message}</p>
        )}
        <p className='text-xs text-muted-foreground'>Keputusan final dibuat oleh server.</p>
      </div>
    </section>
  )
}
