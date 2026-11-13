import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
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
import { CardPanel } from '@/components/card-panel'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { TlpMark } from '@/components/tlp-mark'
import {
  cellState,
  filterUsers,
  groupUsers,
  levelPermits,
  switchFor,
  type CellState,
  type UserDimension,
} from '../access'
import { grantsKey, usersKey, type OperationDocument } from '../api'
import { LevelBadge } from './level-badge'

type Target = { username: string; docId: string }

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
  const [documentQuery, setDocumentQuery] = useState('')
  const [query, setQuery] = useState('')
  const [dim, setDim] = useState<UserDimension>('all')
  const [dimValue, setDimValue] = useState('all')
  const [revokeTarget, setRevokeTarget] = useState<Target | null>(null)
  const [requestTarget, setRequestTarget] = useState<Target | null>(null)
  const queryClient = useQueryClient()
  const normalizedDocumentQuery = documentQuery.trim().toLowerCase()
  const visibleDocs = docs.filter((item) =>
    `${item.id} ${item.title ?? ''} ${item.tlp}`
      .toLowerCase()
      .includes(normalizedDocumentQuery)
  )
  const activeDocId = docs.some((item) => item.id === selectedDocId)
    ? selectedDocId
    : docs[0].id
  const doc = docs.find((item) => item.id === activeDocId) ?? docs[0]
  const holderCountFor = (item: OperationDocument) => {
    const eligible = users.filter((user) =>
      levelPermits(user.accessLevel, item.tlp)
    ).length
    const index = docs.findIndex((docItem) => docItem.id === item.id)
    const activeGrants =
      grantQueries[index]?.data?.filter((grant) => grant.active) ?? []
    return (
      eligible +
      activeGrants.filter((grant) =>
        users.some(
          (user) =>
            user.username === grant.username &&
            !levelPermits(user.accessLevel, item.tlp)
        )
      ).length
    )
  }
  const filteredUsers = filterUsers(users, {
    query,
    dim: dimValue === 'all' ? 'all' : dim,
    value: dimValue,
  })
  const dimOptions = dim === 'all' ? [] : groupUsers(users, dim)
  const grantQueries = useQueries({
    queries: docs.map((item) => ({
      queryKey: grantsKey(item.id),
      queryFn: () => listGrants(item.id),
      retry: false,
    })),
  })
  const grants = grantQueries[docs.findIndex((item) => item.id === activeDocId)]

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
      meta={String(visibleDocs.length)}
      className='op-panel min-w-0'
    >
      <label className='mx-3 my-2 flex h-[30px] items-center gap-2 border border-line bg-surface-2 px-2.5'>
        <Search aria-hidden='true' className='size-3 shrink-0 text-ink-3' />
        <Input
          aria-label='Cari atau filter TLP'
          placeholder='Cari atau filter TLP'
          value={documentQuery}
          onChange={(event) => setDocumentQuery(event.target.value)}
          className='h-full border-0 bg-transparent px-0 font-mono text-[11.5px] shadow-none focus-visible:ring-0'
        />
      </label>
      {visibleDocs.length === 0 ? (
        <p className='px-3 pb-3 text-sm text-ink-3'>
          Tidak ada dokumen yang cocok.
        </p>
      ) : (
        <div className='op-panel-scroll'>
          <ul
            aria-label='Daftar dokumen'
            className='divide-y divide-line border-t border-line'
          >
            {visibleDocs.map((item) => {
              const active = item.id === activeDocId
              return (
                <li key={item.id}>
                  <button
                    type='button'
                    aria-pressed={active}
                    onClick={() => setSelectedDocId(item.id)}
                    className={`flex w-full min-w-0 flex-col gap-1 px-3 py-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring ${active ? 'bg-surface-2 shadow-[inset_2px_0_0_var(--ink)]' : 'hover:bg-surface-2'}`}
                  >
                    <span className='flex min-w-0 items-center gap-2'>
                      <TlpMark tlp={item.tlp} compact />
                      <span className='min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2'>
                        {item.id}
                      </span>
                      <span className='font-mono text-[9px] whitespace-nowrap text-ink-3'>
                        {holderCountFor(item)} pemegang
                      </span>
                    </span>
                    {item.title && (
                      <span className='truncate ps-[14px] text-[12.5px] text-ink'>
                        {item.title}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </CardPanel>
  )

  const matrixColumn = (
    <CardPanel title={`Matriks akses / ${doc.id}`} className='op-panel min-w-0'>
      <div className='flex min-w-0 flex-col gap-2 border-b border-line px-3 py-2 sm:flex-row'>
        <div className='relative min-w-0 flex-1'>
          <Search
            aria-hidden='true'
            className='pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-ink-3'
          />
          <Input
            aria-label='Cari nama atau username'
            placeholder='Cari nama atau username'
            type='search'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className='h-[30px] w-full rounded-none ps-8 font-mono text-[12.5px]'
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
            <SelectTrigger
              aria-label='Tampilkan per'
              className='h-[30px] w-full rounded-none font-mono text-[12.5px] sm:w-36'
            >
              <SelectValue placeholder='Group: semua' />
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
              <SelectTrigger
                aria-label={DIM_LABEL[dim]}
                className='h-[30px] w-full rounded-none font-mono text-[12.5px] sm:w-44'
              >
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
        <div className='op-panel-scroll min-w-0'>
          <div
            aria-hidden='true'
            className='hidden h-[26px] grid-cols-[24px_minmax(0,1fr)_120px_minmax(0,1fr)] items-center gap-3 border-b border-line bg-surface-2 px-3 font-mono text-[8.5px] tracking-[.075em] text-ink-3 uppercase sm:grid'
          >
            <span className='col-span-2'>Pengguna</span>
            <span className='text-center'>Akses</span>
            <span>Keterangan</span>
          </div>
          {(dim === 'all' || dimValue !== 'all'
            ? [{ key: 'filtered', label: '', users: filteredUsers }]
            : dim === 'unit'
              ? groupUsers(filteredUsers, 'unit').map((group) => ({
                  ...group,
                  label: `UNIT: ${group.label}`,
                }))
              : groupUsers(filteredUsers, dim)
          ).map((group) => (
            <div key={group.key}>
              {group.label && (
                <h3 className='flex h-[26px] items-center border-b border-line bg-surface-2 px-3 font-mono text-[8.5px] tracking-[.075em] text-ink-3 uppercase'>
                  {group.label}
                </h3>
              )}
              <ul className='divide-y divide-line'>
                {group.users.map((user) => {
                  const state = stateFor(user)
                  const control = switchFor(state)
                  const label = control.disabled
                    ? `Akses ${user.username} ke ${doc.id}: ${reasonFor(state)}`
                    : `${state === 'grant' ? 'Cabut akses' : 'Beri akses'} ${user.username} ke ${doc.id}`
                  const rankUnit = [user.rankName, user.unit]
                    .filter(Boolean)
                    .join(' · ')

                  return (
                    <li
                      key={user.username}
                      className='grid min-h-[54px] min-w-0 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-3 py-2 sm:grid-cols-[24px_minmax(0,1fr)_120px_minmax(0,1fr)]'
                    >
                      <span
                        aria-hidden='true'
                        className='grid size-6 place-items-center border border-line bg-surface-2 font-mono text-[9px] text-ink-2'
                      >
                        {initials(user)}
                      </span>
                      <div className='min-w-0 overflow-hidden'>
                        <p className='truncate text-[13px] leading-[17px] text-ink'>
                          {user.name ?? user.username}
                        </p>
                        <p className='mt-[3px] flex min-w-0 items-center gap-1.5 text-[8.5px] leading-[11px] text-ink-3'>
                          <LevelBadge level={user.accessLevel} />
                          {rankUnit && (
                            <span className='truncate font-mono'>
                              {rankUnit}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className='flex items-center justify-center gap-[26px]'>
                        <Switch
                          className='op-switch h-5 w-9 [&_[data-slot=switch-thumb]]:size-3.5'
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
                        <span
                          aria-hidden='true'
                          className='font-mono text-[7.5px] leading-[9px] text-ink-3'
                        >
                          LVL
                        </span>
                      </div>
                      <p className='col-span-2 truncate font-mono text-[9px] leading-[12px] text-ink-3 sm:col-span-1'>
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

      <p className='border-t border-line px-3 py-2.5 text-[12.5px] text-ink-3'>
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
