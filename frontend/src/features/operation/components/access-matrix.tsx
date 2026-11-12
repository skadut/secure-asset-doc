import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type Tlp } from '@/data/grc'
import { toast } from 'sonner'
import {
  ApiError,
  createAccessRequest,
  listGrants,
  revokeGrant,
  type DirectoryUser,
} from '@/lib/access-api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { TlpBadge } from '@/components/tlp-badge'
import {
  cellState,
  filterUsers,
  groupUsers,
  type CellState,
  type UserDimension,
} from '../access'
import { grantsKey, usersKey, type OperationDocument } from '../api'
import { LevelBadge } from './level-badge'

type Target = { username: string; docId: string }

export function switchFor(state: CellState): {
  checked: boolean
  disabled: boolean
} {
  return {
    checked: state === 'grant' || state === 'level',
    disabled: state === 'level',
  }
}

const reasonFor = (state: CellState) => {
  if (state === 'grant') return 'Akses lewat grant aktif'
  if (state === 'level')
    return 'Akses lewat level akses (tidak dapat dicabut di sini)'
  if (state === 'expired') return 'Grant kedaluwarsa'
  return 'Tidak ada akses'
}

export function AccessPanel({
  users,
  docs,
}: {
  users: DirectoryUser[]
  docs: OperationDocument[]
}) {
  const [selectedDocId, setSelectedDocId] = useState(docs[0].id)
  const [tlpFilter, setTlpFilter] = useState<Tlp | 'ALL'>('ALL')
  const [query, setQuery] = useState('')
  const [dim, setDim] = useState<UserDimension>('all')
  const [dimValue, setDimValue] = useState('all')
  const [revokeTarget, setRevokeTarget] = useState<Target | null>(null)
  const [requestTarget, setRequestTarget] = useState<Target | null>(null)
  const queryClient = useQueryClient()
  const tlpDocs =
    tlpFilter === 'ALL' ? docs : docs.filter((item) => item.tlp === tlpFilter)
  const activeDocId = tlpDocs.some((item) => item.id === selectedDocId)
    ? selectedDocId
    : (tlpDocs[0]?.id ?? docs[0].id)
  const doc = docs.find((item) => item.id === activeDocId) ?? docs[0]
  const filteredUsers = filterUsers(users, {
    query,
    dim: dimValue === 'all' ? 'all' : dim,
    value: dimValue,
  })
  const dimLabel = {
    level: 'Level',
    rank: 'Pangkat',
    unit: 'Organisasi',
  } as const
  const dimOptions = dim === 'all' ? [] : groupUsers(users, dim)
  const grants = useQuery({
    queryKey: grantsKey(activeDocId),
    queryFn: () => listGrants(activeDocId),
    retry: false,
  })

  const stateFor = (user: DirectoryUser) => {
    const grantState = grants.data?.find(
      (grant) => grant.username === user.username
    )
    return cellState(
      user.accessLevel,
      doc.tlp,
      grantState ? (grantState.active ? 'active' : 'expired') : null
    )
  }

  const grantCount = users.filter((user) => stateFor(user) === 'grant').length
  const levelCount = users.filter((user) => stateFor(user) === 'level').length

  const revokeAccess = useMutation({
    mutationFn: (pending: Target) =>
      revokeGrant(pending.docId, pending.username),
    onSuccess: async (_data, pending) => {
      toast.success(`Akses ${pending.username} ke ${pending.docId} dicabut`)
      setRevokeTarget(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: grantsKey(pending.docId) }),
        queryClient.invalidateQueries({ queryKey: usersKey }),
      ])
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError ? error.message : 'Gagal mencabut akses'
      ),
  })

  return (
    <section className='flex min-w-0 flex-col gap-4'>
      <div className='flex min-w-0 flex-col gap-3'>
        <div className='flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center'>
          <Select
            value={tlpFilter}
            onValueChange={(value) => {
              setTlpFilter(value as Tlp | 'ALL')
              const first = (
                value === 'ALL' ? docs : docs.filter((d) => d.tlp === value)
              )[0]
              if (first) setSelectedDocId(first.id)
            }}
          >
            <SelectTrigger
              aria-label='Filter TLP'
              className='min-h-11 w-full sm:w-52'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='ALL'>Semua TLP</SelectItem>
              {(
                [
                  'CLEAR',
                  'GREEN',
                  'AMBER',
                  'AMBER+STRICT',
                  'RED',
                  'RED+STRICT',
                ] as const
              ).map((tlp) => (
                <SelectItem key={tlp} value={tlp}>
                  <TlpBadge tlp={tlp} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={activeDocId} onValueChange={setSelectedDocId}>
            <SelectTrigger
              aria-label='Pilih dokumen'
              className='min-h-11 w-full min-w-0 overflow-hidden *:data-[slot=select-value]:min-w-0 sm:w-72'
              disabled={tlpDocs.length === 0}
            >
              {tlpDocs.length === 0 ? (
                <SelectValue placeholder='Tidak ada dokumen' />
              ) : (
                <SelectValue />
              )}
            </SelectTrigger>
            {tlpDocs.length > 0 && (
              <SelectContent>
                {tlpDocs.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    <span className='flex w-full min-w-0 items-center justify-between gap-3'>
                      <span className='min-w-0 truncate font-mono'>
                        {item.id}
                      </span>
                      <span className='shrink-0'>
                        <TlpBadge tlp={item.tlp} />
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            )}
          </Select>
          <div className='flex min-w-0 flex-wrap gap-2'>
            <Input
              aria-label='Cari nama atau username'
              placeholder='Cari nama atau username'
              type='search'
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className='min-h-11 w-full min-w-0 sm:flex-1'
            />
            <Select
              value={dim}
              onValueChange={(value) => {
                setDim(value as UserDimension)
                setDimValue('all')
              }}
            >
              <SelectTrigger
                aria-label='Tampilkan per'
                className='min-h-11 w-full sm:w-44'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>Semua</SelectItem>
                <SelectItem value='level'>Level</SelectItem>
                <SelectItem value='rank'>Pangkat</SelectItem>
                <SelectItem value='unit'>Organisasi</SelectItem>
              </SelectContent>
            </Select>
            {dim !== 'all' && (
              <Select value={dimValue} onValueChange={setDimValue}>
                <SelectTrigger
                  aria-label={dimLabel[dim]}
                  className='min-h-11 w-full sm:w-52'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>
                    Semua {dimLabel[dim].toLowerCase()}
                  </SelectItem>
                  {dimOptions.map(({ key, label }) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        {doc.title && (
          <h2 className='min-w-0 text-base font-semibold break-words text-foreground'>
            {doc.title}
          </h2>
        )}
        {grants.data && (
          <p role='status' className='text-sm'>
            <span className='font-medium tabular-nums'>{grantCount}</span>{' '}
            pengguna diberi grant aktif ·{' '}
            <span className='tabular-nums'>{levelCount}</span>{' '}
            <span className='text-muted-foreground'>lewat level akses</span>
          </p>
        )}
      </div>

      {grants.isError ? (
        <p role='alert' className='text-sm text-destructive'>
          Gagal memuat hak akses
        </p>
      ) : grants.isPending ? (
        <p role='status' className='text-sm text-muted-foreground'>
          Memuat hak akses...
        </p>
      ) : users.length === 0 ? (
        <p className='text-sm text-muted-foreground'>Belum ada pengguna</p>
      ) : filteredUsers.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          Tidak ada pengguna yang cocok.
        </p>
      ) : (
        <div className='min-w-0 space-y-3'>
          {(dim === 'all' || dimValue !== 'all'
            ? [{ key: 'filtered', label: '', users: filteredUsers }]
            : groupUsers(filteredUsers, dim)
          ).map((group) => (
            <div key={group.key}>
              {group.label && (
                <h3 className='mb-2 text-sm font-semibold'>
                  {group.label} · {group.users.length} pengguna
                </h3>
              )}
              <ul className='min-w-0 divide-y rounded-md border bg-card'>
                {group.users.map((user) => {
                  const state = stateFor(user)
                  const control = switchFor(state)
                  const label = control.disabled
                    ? `Akses ${user.username} ke ${doc.id}: ${reasonFor(state)}`
                    : `${state === 'grant' ? 'Cabut akses' : 'Beri akses'} ${user.username} ke ${doc.id}`

                  return (
                    <li
                      key={user.username}
                      className='flex min-w-0 items-center justify-between gap-4 px-4 py-3'
                    >
                      <div className='min-w-0 flex-1'>
                        <p className='text-sm font-medium break-words'>
                          {user.name ?? user.username}
                          {user.name !== null && (
                            <span className='ms-2 font-mono text-xs font-normal text-muted-foreground'>
                              {user.username}
                            </span>
                          )}
                        </p>
                        <p className='mt-1 flex flex-wrap items-center gap-1 text-xs break-words text-muted-foreground'>
                          {user.rankName && <>{user.rankName} · </>}
                          <LevelBadge level={user.accessLevel} />
                          {user.unit && <> · {user.unit}</>}
                        </p>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          {reasonFor(state)}
                        </p>
                      </div>
                      <Switch
                        checked={control.checked}
                        disabled={control.disabled || revokeAccess.isPending}
                        aria-label={label}
                        onCheckedChange={(checked) => {
                          const next = {
                            username: user.username,
                            docId: doc.id,
                          }
                          if (checked) setRequestTarget(next)
                          else setRevokeTarget(next)
                        }}
                      />
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className='text-xs text-muted-foreground'>
        Switch ON mengajukan permintaan akses yang harus disetujui dua pihak.
        Switch OFF mencabut grant aktif.
      </p>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !revokeAccess.isPending) setRevokeTarget(null)
        }}
        title='Cabut akses?'
        desc={
          revokeTarget
            ? `Cabut grant aktif ${revokeTarget.username} ke dokumen ${revokeTarget.docId}?`
            : ''
        }
        destructive
        cancelBtnText='Batal'
        confirmText='Cabut akses'
        isLoading={revokeAccess.isPending}
        handleConfirm={() => {
          if (revokeTarget) revokeAccess.mutate(revokeTarget)
        }}
      />

      {requestTarget && (
        <AccessRequestDialog
          target={requestTarget}
          onClose={() => setRequestTarget(null)}
        />
      )}
    </section>
  )
}

function AccessRequestDialog({
  target,
  onClose,
}: {
  target: Target
  onClose: () => void
}) {
  const formId = useId()
  const reasonId = useId()
  const expiryId = useId()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [expiry, setExpiry] = useState('')
  const trimmed = reason.trim()
  const valid = trimmed.length >= 1 && trimmed.length <= 500

  const submit = useMutation({
    mutationFn: () =>
      createAccessRequest(target.docId, {
        grantee: target.username,
        reason: trimmed,
        ...(expiry
          ? {
              expiresAt: new Date(`${expiry}T23:59:59.999`).toISOString(),
            }
          : {}),
      }),
    onSuccess: async () => {
      toast.success(
        `Permintaan akses ${target.username} ke ${target.docId} diajukan`
      )
      onClose()
      await queryClient.invalidateQueries({ queryKey: ['access-requests'] })
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Gagal mengajukan permintaan akses'
      ),
  })

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open && !submit.isPending) onClose()
      }}
      title='Ajukan permintaan akses'
      desc={
        <>
          Pengguna <span className='font-mono'>{target.username}</span>, dokumen{' '}
          <span className='font-mono'>{target.docId}</span>. Permintaan ini
          membutuhkan persetujuan ganda di Otorisasi ganda sebelum akses aktif.
        </>
      }
      cancelBtnText='Batal'
      confirmText='Ajukan permintaan'
      form={formId}
      disabled={!valid}
      isLoading={submit.isPending}
    >
      <form
        id={formId}
        className='grid gap-4'
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (valid && !submit.isPending) submit.mutate()
        }}
      >
        <div className='grid gap-2'>
          <Label htmlFor={reasonId}>Alasan permintaan</Label>
          <Textarea
            id={reasonId}
            required
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <div className='grid gap-2'>
          <Label htmlFor={expiryId}>Berlaku sampai (opsional)</Label>
          <Input
            id={expiryId}
            type='date'
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
            className='min-h-11'
          />
        </div>
      </form>
    </ConfirmDialog>
  )
}
