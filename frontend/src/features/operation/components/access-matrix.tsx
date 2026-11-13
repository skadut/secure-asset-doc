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
import { CardPanel } from '@/components/card-panel'
import { TlpMark } from '@/components/tlp-mark'
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
import {
  cellState,
  filterUsers,
  groupUsers,
  switchFor,
  type CellState,
  type UserDimension,
} from '../access'
import { grantsKey, usersKey, type OperationDocument } from '../api'
import { LevelBadge } from './level-badge'

type Target = { username: string; docId: string }

const TLP_ORDER: Tlp[] = [
  'CLEAR',
  'GREEN',
  'AMBER',
  'AMBER+STRICT',
  'RED',
  'RED+STRICT',
]

const DIM_LABEL = {
  level: 'Level',
  rank: 'Pangkat',
  unit: 'Organisasi',
} as const

const reasonFor = (state: CellState) => {
  if (state === 'grant') return 'Akses lewat grant aktif'
  if (state === 'level')
    return 'Akses lewat level akses (tidak dapat dicabut di sini)'
  if (state === 'expired') return 'Grant kedaluwarsa'
  return 'Tidak ada akses'
}

const initials = (user: DirectoryUser) =>
  (user.name ?? user.username)
    .split(/[\s.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

// Renders two siblings (document list, matrix). The parent provides the grid.
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

  const docColumn = (
    <CardPanel
      title='Dokumen'
      meta={String(tlpDocs.length)}
      className='min-w-0 xl:self-stretch'
    >
      <div className='flex flex-col gap-3 p-3'>
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
          <SelectTrigger aria-label='Filter TLP' className='h-9 w-full rounded-none'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='ALL'>Semua TLP</SelectItem>
            {TLP_ORDER.map((tlp) => (
              <SelectItem key={tlp} value={tlp}>
                <TlpMark tlp={tlp} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {tlpDocs.length === 0 ? (
        <p className='px-3 pb-3 text-sm text-ink-3'>
          Tidak ada dokumen untuk filter ini.
        </p>
      ) : (
        <ul aria-label='Daftar dokumen' className='divide-y divide-line border-t border-line'>
          {tlpDocs.map((item) => {
            const active = item.id === activeDocId
            return (
              <li key={item.id}>
                <button
                  type='button'
                  aria-pressed={active}
                  onClick={() => setSelectedDocId(item.id)}
                  className={`flex w-full min-w-0 flex-col gap-1 px-3 py-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${
                    active ? 'bg-surface-2 shadow-[inset_2px_0_0_var(--ink)]' : 'hover:bg-surface-2'
                  }`}
                >
                  <span className='flex min-w-0 items-center gap-2'>
                    <TlpMark tlp={item.tlp} compact />
                    <span className='font-mono text-[10px] text-ink-2'>{item.id}</span>
                  </span>
                  {item.title && (
                    <span className='break-words text-[11px] text-ink'>{item.title}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </CardPanel>
  )

  const matrixColumn = (
    <CardPanel
      title='Matriks akses'
      meta={doc.id}
      className='min-w-0'
    >
      <div className='flex flex-col gap-3 p-3'>
        {doc.title && (
          <h2 className='min-w-0 break-words text-base font-semibold text-ink'>
            {doc.title}
          </h2>
        )}
        <div className='flex min-w-0 flex-col gap-2 sm:flex-row'>
          <div className='min-w-0 flex-1'>
            <Input
              aria-label='Cari nama atau username'
              placeholder='Cari nama atau username'
              type='search'
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className='h-9 w-full rounded-none'
            />
          </div>
          <div className='flex min-w-0 gap-2'>
            <Select
              value={dim}
              onValueChange={(value) => {
                setDim(value as UserDimension)
                setDimValue('all')
              }}
            >
              <SelectTrigger aria-label='Tampilkan per' className='h-9 w-full rounded-none sm:w-36'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>Group: semua</SelectItem>
                <SelectItem value='level'>Level</SelectItem>
                <SelectItem value='rank'>Pangkat</SelectItem>
                <SelectItem value='unit'>Organisasi</SelectItem>
              </SelectContent>
            </Select>
            {dim !== 'all' && (
              <Select value={dimValue} onValueChange={setDimValue}>
                <SelectTrigger aria-label={DIM_LABEL[dim]} className='h-9 w-full rounded-none sm:w-44'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>
                    Semua {DIM_LABEL[dim].toLowerCase()}
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
        {grants.data && (
          <p role='status' className='font-mono text-[10px] text-ink-2'>
            <span className='tabular-nums text-ink'>{grantCount}</span> grant aktif ·{' '}
            <span className='tabular-nums text-ink'>{levelCount}</span>{' '}
            <span className='text-ink-3'>lewat level akses</span>
          </p>
        )}
      </div>

      {grants.isError ? (
        <p role='alert' className='px-3 pb-3 text-sm text-destructive'>
          Gagal memuat hak akses
        </p>
      ) : grants.isPending ? (
        <p role='status' className='px-3 pb-3 text-sm text-ink-3'>
          Memuat hak akses...
        </p>
      ) : users.length === 0 ? (
        <p className='px-3 pb-3 text-sm text-ink-3'>Belum ada pengguna</p>
      ) : filteredUsers.length === 0 ? (
        <p className='px-3 pb-3 text-sm text-ink-3'>
          Tidak ada pengguna yang cocok.
        </p>
      ) : (
        <div className='min-w-0'>
          <div
            aria-hidden='true'
            className='hidden grid-cols-[28px_minmax(0,1fr)_96px_minmax(0,1fr)] gap-3 border-y border-line bg-surface-2 px-3 py-1.5 font-mono text-[8px] uppercase tracking-[.1em] text-ink-3 sm:grid'
          >
            <span className='col-span-2'>Pengguna</span>
            <span>Akses</span>
            <span>Keterangan</span>
          </div>
          {(dim === 'all' || dimValue !== 'all'
            ? [{ key: 'filtered', label: '', users: filteredUsers }]
            : groupUsers(filteredUsers, dim)
          ).map((group) => (
            <div key={group.key}>
              {group.label && (
                <h3 className='border-b border-line bg-surface-2 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[.08em] text-ink-2'>
                  {DIM_LABEL[dim as keyof typeof DIM_LABEL]}: {group.label} ·{' '}
                  {group.users.length} pengguna
                </h3>
              )}
              <ul className='divide-y divide-line'>
                {group.users.map((user) => {
                  const state = stateFor(user)
                  const control = switchFor(state)
                  const label = control.disabled
                    ? `Akses ${user.username} ke ${doc.id}: ${reasonFor(state)}`
                    : `${state === 'grant' ? 'Cabut akses' : 'Beri akses'} ${user.username} ke ${doc.id}`

                  return (
                    <li
                      key={user.username}
                      className='grid min-w-0 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[28px_minmax(0,1fr)_96px_minmax(0,1fr)] sm:min-h-[54px]'
                    >
                      <span
                        aria-hidden='true'
                        className='grid size-7 place-items-center border border-line bg-surface-2 font-mono text-[9px] text-ink-2'
                      >
                        {initials(user)}
                      </span>
                      <div className='min-w-0'>
                        <p className='break-words text-sm font-medium text-ink'>
                          {user.name ?? user.username}
                          {user.name !== null && (
                            <span className='ms-2 font-mono text-[10px] font-normal text-ink-3'>
                              {user.username}
                            </span>
                          )}
                        </p>
                        <p className='mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] break-words text-ink-3'>
                          <LevelBadge level={user.accessLevel} />
                          {user.rankName && <span>{user.rankName}</span>}
                          {user.unit && <span>· {user.unit}</span>}
                        </p>
                      </div>
                      <div className='flex justify-end sm:justify-start'>
                        <Switch
                          className='op-switch'
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
                      </div>
                      <p className='col-span-2 text-[11px] break-words text-ink-3 sm:col-span-1 sm:col-start-auto'>
                        {reasonFor(state)}
                      </p>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className='border-t border-line px-3 py-2.5 text-[11px] text-ink-3'>
        Switch ON mengajukan permintaan akses yang harus disetujui dua pihak.
        Switch OFF mencabut grant aktif.
      </p>
    </CardPanel>
  )

  return (
    <>
      {docColumn}
      {matrixColumn}

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
    </>
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
