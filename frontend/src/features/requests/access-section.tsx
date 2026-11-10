import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ApiError,
  createAccessRequest,
  decideAccessRequest,
  listAccessRequests,
  listUsers,
  revokeGrant,
  type AccessRequest,
  type Approval,
} from '@/lib/access-api'
import { getMe, type Me } from '@/lib/session'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { TlpBadge } from '@/components/tlp-badge'
import { grantsKey } from '@/features/operation/api'

const DOC_RE = /^DOC-\d{4}$/
const USERNAME_RE = /^[a-z0-9.-]{3,40}$/
const REASON_MAX = 500

const STATUS_LABEL: Record<AccessRequest['status'], string> = {
  pending: 'Menunggu',
  approved: 'Diberikan',
  denied: 'Ditolak',
  cancelled: 'Dibatalkan',
}

const ROLE_LABEL: Record<Approval['role'], string> = {
  commander: 'Komandan',
  security_officer: 'Perwira Keamanan',
}

type Role = Approval['role']
type ViewerRole = Role | null
type StepState = 'done' | 'wait' | 'bad' | 'skip' | 'expired'
type Errs = Record<string, string | undefined>

const STEP_TEXT: Record<StepState, string> = {
  done: 'Selesai',
  wait: 'Menunggu',
  bad: 'Ditolak',
  skip: 'Tidak dijalankan',
  expired: 'Kedaluwarsa',
}

const STEP_TONE: Record<StepState, string> = {
  done: 'border-t-primary text-foreground',
  wait: 'border-t-border text-muted-foreground',
  bad: 'border-t-destructive text-destructive',
  skip: 'border-t-border text-muted-foreground',
  expired: 'border-t-border text-muted-foreground',
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
const errMsg = (e: unknown) =>
  e instanceof ApiError ? e.message : 'Terjadi kesalahan'
const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409

const viewerRoleOf = (me: Me, r: AccessRequest): ViewerRole => {
  if (me.superAdmin) {
    const roles = r.approvals.map((a) => a.role)
    return roles.includes('commander') && !roles.includes('security_officer')
      ? 'security_officer'
      : 'commander'
  }
  return me.accessLevel === 5
    ? 'commander'
    : me.securityOfficer
      ? 'security_officer'
      : null
}

function stepsOf(
  r: AccessRequest,
  now: number
): { label: string; state: StepState }[] {
  const denied =
    r.status === 'denied' || r.approvals.some((a) => a.decision === 'deny')
  const approval = (role: Role): StepState => {
    const a = r.approvals.find((x) => x.role === role)
    if (a) return a.decision === 'approve' ? 'done' : 'bad'
    return denied ? 'skip' : 'wait'
  }
  const approved = r.status === 'approved'
  const halted = denied || r.status === 'cancelled'
  const active =
    approved && (r.expiresAt === null || Date.parse(r.expiresAt) > now)
  return [
    { label: 'Diajukan', state: 'done' },
    { label: 'Persetujuan Komandan', state: approval('commander') },
    {
      label: 'Persetujuan Perwira Keamanan',
      state: approval('security_officer'),
    },
    { label: 'Diberikan', state: approved ? 'done' : halted ? 'skip' : 'wait' },
    {
      label: 'Aktif',
      state: halted ? 'skip' : !approved ? 'wait' : active ? 'done' : 'expired',
    },
  ]
}

function queueLabel(r: AccessRequest, me: Me, viewerRole: ViewerRole): string {
  if (r.status === 'approved') return 'Diberikan'
  if (r.status === 'denied') return 'Ditolak'
  if (r.status === 'cancelled') return 'Dibatalkan'
  if (r.requestedBy === me.username) return 'Permintaan Anda'
  if (r.grantee === me.username) return 'Menunggu persetujuan'
  if (viewerRole && !r.approvals.some((a) => a.role === viewerRole))
    return 'Perlu keputusan Anda'
  return 'Menunggu persetujuan'
}

function validateCreate(f: {
  docId: string
  grantee: string
  reason: string
  expires: string
}): Errs {
  const e: Errs = {}
  if (!DOC_RE.test(f.docId.trim())) e.docId = 'Format ID dokumen harus DOC-0000'
  if (!f.grantee) e.grantee = 'Pilih penerima akses'
  const len = [...f.reason.trim()].length
  if (len < 1 || len > REASON_MAX)
    e.reason = `Alasan wajib diisi, maksimal ${REASON_MAX} karakter`
  if (f.expires && !(new Date(f.expires).getTime() > Date.now()))
    e.expires = 'Waktu kedaluwarsa harus di masa depan'
  return e
}

function validateRevoke(docId: string, username: string): Errs {
  const e: Errs = {}
  if (!DOC_RE.test(docId.trim())) e.docId = 'Format ID dokumen harus DOC-0000'
  if (!USERNAME_RE.test(username.trim()))
    e.username = 'Gunakan 3–40 huruf kecil, angka, titik, atau tanda hubung'
  return e
}

function FieldError({ id, msg }: { id: string; msg?: string }) {
  return msg ? (
    <p id={id} className='text-sm text-destructive'>
      {msg}
    </p>
  ) : null
}

type ItemProps = {
  r: AccessRequest
  me: Me
  viewerRole: ViewerRole
  deciding: boolean
  onDecide: (
    r: AccessRequest,
    decision: 'approve' | 'deny',
    reason: string
  ) => void
}

function RequestItem({ r, me, viewerRole, deciding, onDecide }: ItemProps) {
  const reasonId = useId()
  const [reason, setReason] = useState('')
  const [now] = useState(() => Date.now())
  const isRequester = r.requestedBy === me.username
  const isGrantee = r.grantee === me.username
  const decided =
    viewerRole !== null && r.approvals.some((a) => a.role === viewerRole)
  const locked = isRequester || isGrantee || decided || viewerRole === null
  const showDecision =
    r.status === 'pending' &&
    Boolean(me.can.access?.approve) &&
    !r.approvals.some((a) => a.approver === me.username)
  const queue = queueLabel(r, me, viewerRole)
  const steps = stepsOf(r, now)

  return (
    <Card>
      <CardHeader className='gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <TlpBadge tlp={r.tlp} />
          <span className='font-mono text-sm break-all'>{r.documentId}</span>
          <Badge
            variant={queue === 'Perlu keputusan Anda' ? 'default' : 'outline'}
          >
            {queue}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <ol
          aria-label='Tahapan persetujuan'
          className='grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-2'
        >
          {steps.map((s) => (
            <li
              key={s.label}
              className={`flex flex-col gap-0.5 border-t-4 pt-2 text-sm ${STEP_TONE[s.state]}`}
            >
              <span className='font-medium text-foreground'>{s.label}</span>
              <span>{STEP_TEXT[s.state]}</span>
            </li>
          ))}
        </ol>

        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm'>
          <dt className='text-muted-foreground'>Penerima</dt>
          <dd className='break-words'>
            {r.grantee} · {r.granteeUnit ?? '—'}
          </dd>
          <dt className='text-muted-foreground'>Pemohon</dt>
          <dd className='break-words'>{r.requestedBy}</dd>
          <dt className='text-muted-foreground'>Alasan</dt>
          <dd className='break-words whitespace-pre-line'>{r.reason}</dd>
          <dt className='text-muted-foreground'>Kedaluwarsa</dt>
          <dd>{r.expiresAt ? fmt(r.expiresAt) : 'Tidak kedaluwarsa'}</dd>
          <dt className='text-muted-foreground'>Status</dt>
          <dd>{STATUS_LABEL[r.status]}</dd>
          <dt className='text-muted-foreground'>Diajukan</dt>
          <dd>{fmt(r.createdAt)}</dd>
        </dl>

        <div className='flex flex-col gap-2 border-t pt-4'>
          <h3 className='text-sm font-medium'>Keputusan</h3>
          {r.approvals.length === 0 ? (
            <p className='text-sm text-muted-foreground'>Belum ada keputusan</p>
          ) : (
            <ul className='flex flex-col gap-2'>
              {r.approvals.map((a) => (
                <li key={a.role} className='rounded-md border p-3 text-sm'>
                  <div className='font-medium'>
                    {ROLE_LABEL[a.role]} · {a.approver} ·{' '}
                    {a.decision === 'approve' ? 'Disetujui' : 'Ditolak'}
                  </div>
                  <div className='break-words text-muted-foreground'>
                    {a.reason ?? '—'} · {fmt(a.at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {showDecision && (
          <div className='flex flex-col gap-3 border-t pt-4'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor={reasonId}>Alasan (opsional)</Label>
              <Textarea
                id={reasonId}
                value={reason}
                disabled={locked}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            {isRequester && (
              <p
                id={`${reasonId}-disabled`}
                className='text-sm text-muted-foreground'
              >
                Pemohon tidak dapat menyetujui permintaannya sendiri
              </p>
            )}
            {!isRequester && isGrantee && (
              <p className='text-sm text-muted-foreground'>
                Penerima akses tidak dapat memutuskan permintaan ini
              </p>
            )}
            {!isRequester && !isGrantee && decided && (
              <p className='text-sm text-muted-foreground'>
                Anda sudah memberi keputusan untuk permintaan ini
              </p>
            )}
            {!isRequester && !isGrantee && !decided && viewerRole === null && (
              <p className='text-sm text-muted-foreground'>
                Peran Anda tidak memiliki wewenang persetujuan
              </p>
            )}
            <div className='grid gap-2 sm:grid-cols-2'>
              <Button
                disabled={locked || deciding}
                aria-describedby={
                  isRequester ? `${reasonId}-disabled` : undefined
                }
                onClick={() => onDecide(r, 'approve', reason)}
              >
                Setujui
              </Button>
              <Button
                variant='outline'
                disabled={locked || deciding}
                aria-describedby={
                  isRequester ? `${reasonId}-disabled` : undefined
                }
                onClick={() => onDecide(r, 'deny', reason)}
              >
                Tolak
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function AccessSection() {
  const me = getMe()
  const uid = useId()
  const queryClient = useQueryClient()
  const canRequest = Boolean(me?.can.access?.request)
  const canRevoke = Boolean(me?.can.access?.revoke)

  const requests = useQuery({
    queryKey: ['access-requests'],
    queryFn: listAccessRequests,
    retry: false,
  })
  const users = useQuery({
    queryKey: ['access-users'],
    queryFn: listUsers,
    retry: false,
    enabled: canRequest,
  })

  const refreshRequests = () =>
    queryClient.invalidateQueries({ queryKey: ['access-requests'] })

  const decide = useMutation({
    mutationFn: (v: {
      id: string
      documentId: string
      decision: 'approve' | 'deny'
      reason?: string
    }) => decideAccessRequest(v.id, { decision: v.decision, reason: v.reason }),
    onSuccess: (res, v) => {
      toast.success(res.granted ? 'Akses diberikan' : 'Keputusan disimpan')
      void refreshRequests()
      if (res.granted)
        void queryClient.invalidateQueries({
          queryKey: ['document-grants', v.documentId],
        })
    },
    onError: (e) => {
      toast.error(errMsg(e))
      if (isConflict(e)) void refreshRequests()
    },
  })

  const [docId, setDocId] = useState(
    () => new URLSearchParams(window.location.search).get('doc') ?? ''
  )
  const [grantee, setGrantee] = useState('')
  const [reason, setReason] = useState('')
  const [expires, setExpires] = useState('')
  const [createAttempted, setCreateAttempted] = useState(false)

  const create = useMutation({
    mutationFn: () =>
      createAccessRequest(docId.trim(), {
        grantee,
        reason: reason.trim(),
        expiresAt: expires ? new Date(expires).toISOString() : undefined,
      }),
    onSuccess: () => {
      toast.success('Permintaan akses diajukan')
      setGrantee('')
      setReason('')
      setExpires('')
      setCreateAttempted(false)
      void refreshRequests()
    },
    onError: (e) => {
      toast.error(errMsg(e))
      if (isConflict(e)) void refreshRequests()
    },
  })

  const [revokeDoc, setRevokeDoc] = useState('')
  const [revokeUser, setRevokeUser] = useState('')
  const [revokeAttempted, setRevokeAttempted] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)

  const revoke = useMutation({
    mutationFn: (v: { docId: string; username: string }) =>
      revokeGrant(v.docId, v.username),
    onSuccess: (_, v) => {
      toast.success('Akses dicabut')
      setRevokeOpen(false)
      void refreshRequests()
      void queryClient.invalidateQueries({
        queryKey: ['document-grants', v.docId],
      })
      void queryClient.invalidateQueries({ queryKey: grantsKey(v.docId) })
    },
    onError: (e, v) => {
      toast.error(errMsg(e))
      if (isConflict(e)) {
        void refreshRequests()
        void queryClient.invalidateQueries({
          queryKey: ['document-grants', v.docId],
        })
      }
    },
  })

  if (!me)
    return (
      <p className='text-muted-foreground'>
        Sesi tidak tersedia. Muat ulang halaman.
      </p>
    )

  const list = requests.data ?? []
  const createErrs = createAttempted
    ? validateCreate({ docId, grantee, reason, expires })
    : {}
  const revokeErrs = revokeAttempted
    ? validateRevoke(revokeDoc, revokeUser)
    : {}
  const granteeOptions = (users.data ?? []).filter(
    (u) => u.username !== me.username
  )

  const onDecide = (
    r: AccessRequest,
    decision: 'approve' | 'deny',
    reasonText: string
  ) =>
    decide.mutate({
      id: r.id,
      documentId: r.documentId,
      decision,
      reason: reasonText.trim() || undefined,
    })

  const submitCreate = (e: FormEvent) => {
    e.preventDefault()
    setCreateAttempted(true)
    if (
      Object.keys(validateCreate({ docId, grantee, reason, expires }))
        .length === 0
    )
      create.mutate()
  }

  const submitRevoke = (e: FormEvent) => {
    e.preventDefault()
    setRevokeAttempted(true)
    if (Object.keys(validateRevoke(revokeDoc, revokeUser)).length === 0)
      setRevokeOpen(true)
  }

  return (
    <section className='flex min-w-0 flex-col gap-6'>
      <section
        aria-labelledby={`${uid}-queue`}
        className='flex min-w-0 flex-col gap-4'
      >
        <h2 id={`${uid}-queue`} className='text-lg font-semibold'>
          Permintaan akses
        </h2>

        {requests.isPending ? (
          <div className='flex flex-col gap-3'>
            <Skeleton className='h-32 w-full' />
            <Skeleton className='h-32 w-full' />
          </div>
        ) : requests.isError ? (
          <Alert variant='destructive'>
            <AlertTitle>Gagal memuat permintaan</AlertTitle>
            <AlertDescription>{errMsg(requests.error)}</AlertDescription>
          </Alert>
        ) : list.length === 0 ? (
          <p className='text-muted-foreground'>Belum ada permintaan akses.</p>
        ) : (
          <ul className='flex flex-col gap-4'>
            {list.map((r) => (
              <li key={r.id}>
                <RequestItem
                  r={r}
                  me={me}
                  viewerRole={viewerRoleOf(me, r)}
                  deciding={decide.isPending && decide.variables?.id === r.id}
                  onDecide={onDecide}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {canRequest && (
        <Card>
          <CardHeader>
            <CardTitle>Ajukan akses</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className='flex flex-col gap-4'
              noValidate
              onSubmit={submitCreate}
            >
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor={`${uid}-doc`}>ID dokumen</Label>
                <Input
                  id={`${uid}-doc`}
                  value={docId}
                  placeholder='DOC-0001'
                  autoComplete='off'
                  aria-invalid={Boolean(createErrs.docId)}
                  aria-describedby={
                    createErrs.docId ? `${uid}-doc-err` : undefined
                  }
                  onChange={(e) => setDocId(e.target.value)}
                />
                <FieldError id={`${uid}-doc-err`} msg={createErrs.docId} />
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label htmlFor={`${uid}-grantee`}>Penerima akses</Label>
                <Select
                  value={grantee}
                  onValueChange={setGrantee}
                  disabled={users.isPending || users.isError}
                >
                  <SelectTrigger
                    id={`${uid}-grantee`}
                    className='w-full'
                    aria-invalid={Boolean(createErrs.grantee)}
                    aria-describedby={
                      createErrs.grantee ? `${uid}-grantee-err` : undefined
                    }
                  >
                    <SelectValue
                      placeholder={
                        users.isPending ? 'Memuat pengguna…' : 'Pilih penerima'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {granteeOptions.map((u) => (
                      <SelectItem key={u.username} value={u.username}>
                        {u.username} · {u.rankName ?? '—'} · Level{' '}
                        {u.accessLevel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {users.isError && (
                  <p className='text-sm text-muted-foreground'>
                    Daftar pengguna gagal dimuat.
                  </p>
                )}
                <FieldError
                  id={`${uid}-grantee-err`}
                  msg={createErrs.grantee}
                />
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label htmlFor={`${uid}-reason`}>Alasan</Label>
                <Textarea
                  id={`${uid}-reason`}
                  value={reason}
                  aria-invalid={Boolean(createErrs.reason)}
                  aria-describedby={`${uid}-reason-count${createErrs.reason ? ` ${uid}-reason-err` : ''}`}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className='flex items-start justify-between gap-2 text-sm'>
                  <FieldError
                    id={`${uid}-reason-err`}
                    msg={createErrs.reason}
                  />
                  <span
                    id={`${uid}-reason-count`}
                    className='ms-auto text-muted-foreground tabular-nums'
                  >
                    {[...reason.trim()].length}/{REASON_MAX}
                  </span>
                </div>
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label htmlFor={`${uid}-expires`}>Kedaluwarsa (opsional)</Label>
                <Input
                  id={`${uid}-expires`}
                  type='datetime-local'
                  value={expires}
                  aria-invalid={Boolean(createErrs.expires)}
                  aria-describedby={
                    createErrs.expires ? `${uid}-expires-err` : undefined
                  }
                  onChange={(e) => setExpires(e.target.value)}
                />
                <FieldError
                  id={`${uid}-expires-err`}
                  msg={createErrs.expires}
                />
              </div>

              <Button
                type='submit'
                className='w-full sm:w-auto'
                disabled={create.isPending}
              >
                Ajukan akses
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {canRevoke && (
        <Card>
          <CardHeader>
            <CardTitle>Cabut akses</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className='flex flex-col gap-4'
              noValidate
              onSubmit={submitRevoke}
            >
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor={`${uid}-rev-doc`}>ID dokumen</Label>
                <Input
                  id={`${uid}-rev-doc`}
                  value={revokeDoc}
                  placeholder='DOC-0001'
                  autoComplete='off'
                  aria-invalid={Boolean(revokeErrs.docId)}
                  aria-describedby={
                    revokeErrs.docId ? `${uid}-rev-doc-err` : undefined
                  }
                  onChange={(e) => setRevokeDoc(e.target.value)}
                />
                <FieldError id={`${uid}-rev-doc-err`} msg={revokeErrs.docId} />
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label htmlFor={`${uid}-rev-user`}>Nama pengguna</Label>
                <Input
                  id={`${uid}-rev-user`}
                  value={revokeUser}
                  autoComplete='off'
                  aria-invalid={Boolean(revokeErrs.username)}
                  aria-describedby={
                    revokeErrs.username ? `${uid}-rev-user-err` : undefined
                  }
                  onChange={(e) => setRevokeUser(e.target.value)}
                />
                <FieldError
                  id={`${uid}-rev-user-err`}
                  msg={revokeErrs.username}
                />
              </div>

              <Button
                type='submit'
                variant='destructive'
                className='w-full sm:w-auto'
              >
                Cabut akses
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title='Cabut akses?'
        desc='Pencabutan langsung berlaku dan hanya untuk satu pengguna.'
        confirmText='Cabut akses'
        cancelBtnText='Batal'
        destructive
        isLoading={revoke.isPending}
        handleConfirm={() =>
          revoke.mutate({
            docId: revokeDoc.trim(),
            username: revokeUser.trim(),
          })
        }
      />
    </section>
  )
}
