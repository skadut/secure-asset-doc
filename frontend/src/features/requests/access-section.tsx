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
import { Button } from '@/components/ui/button'
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
import { grantsKey } from '@/features/operation/api'
import { CardPanel } from '@/components/card-panel'
import { Chip } from '@/components/chip'
import { EmptyState } from '@/components/empty-state'
import { StatusDot } from '@/components/status-dot'
import { TlpMark } from '@/components/tlp-mark'

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
  done: 'border-t-pass text-pass',
  wait: 'border-t-line-strong text-ink-3',
  bad: 'border-t-fail text-fail',
  skip: 'border-t-line text-ink-3',
  expired: 'border-t-warn text-warn',
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
  const decided = viewerRole !== null && r.approvals.some((a) => a.role === viewerRole)
  const locked = isRequester || isGrantee || decided || viewerRole === null
  const showDecision = r.status === 'pending' && Boolean(me.can.access?.approve) && !r.approvals.some((a) => a.approver === me.username)
  const queue = queueLabel(r, me, viewerRole)
  const steps = stepsOf(r, now)
  const statusTone = r.status === 'approved' ? 'pass' : r.status === 'denied' ? 'fail' : r.status === 'pending' ? 'warn' : 'ink'

  return (
    <CardPanel
      title={<span className='flex items-center gap-2'><TlpMark tlp={r.tlp} /><span className='text-line-strong'>/</span><span className='break-all'>{r.documentId}</span></span>}
      meta={<StatusDot tone={statusTone}>{queue}</StatusDot>}
      className='overflow-hidden'
    >
      <div className='grid min-w-0 gap-4 p-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(250px,.8fr)]'>
        <div className='flex min-w-0 flex-col gap-3'>
          <div className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[11px]'>
            <span className='font-mono text-[8px] uppercase tracking-[.1em] text-ink-3'>Penerima</span>
            <span className='break-words font-medium text-ink'>{r.grantee} <span className='font-normal text-ink-3'>· {r.granteeUnit ?? '—'}</span></span>
            <span className='font-mono text-[8px] uppercase tracking-[.1em] text-ink-3'>Pemohon</span><span className='break-words text-ink-2'>{r.requestedBy}</span>
            <span className='font-mono text-[8px] uppercase tracking-[.1em] text-ink-3'>Alasan</span><span className='break-words whitespace-pre-line text-ink-2'>{r.reason}</span>
            <span className='font-mono text-[8px] uppercase tracking-[.1em] text-ink-3'>Kedaluwarsa</span><span className='text-ink-2'>{r.expiresAt ? fmt(r.expiresAt) : 'Tidak kedaluwarsa'}</span>
          </div>
          <div className='flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2 font-mono text-[8px] text-ink-3'>
            <span>DIAJUKAN {fmt(r.createdAt)}</span><span>STATUS {STATUS_LABEL[r.status].toUpperCase()}</span>
          </div>
          <ol aria-label='Tahapan persetujuan' className='grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-3 sm:grid-cols-3'>
            {steps.map((s) => <li key={s.label} className={`flex flex-col gap-0.5 border-t-2 pt-1.5 font-mono text-[8px] ${STEP_TONE[s.state]}`}><span className='font-medium text-ink-2'>{s.label}</span><span>{STEP_TEXT[s.state]}</span></li>)}
          </ol>
        </div>
        <section aria-label='Slot persetujuan' className='flex min-w-0 flex-col border border-line'>
          {(['commander', 'security_officer'] as const).map((role) => {
            const approval = r.approvals.find((a) => a.role === role)
            const roleState = approval ? approval.decision === 'approve' ? 'pass' : 'fail' : r.status === 'pending' ? 'warn' : 'ink'
            return <div key={role} className='flex min-w-0 flex-wrap items-center gap-2 border-b border-line p-2.5 last:border-b-0'>
              <span aria-hidden='true' className={`grid size-5 shrink-0 place-items-center border font-mono text-[9px] ${approval?.decision === 'approve' ? 'border-pass text-pass' : approval?.decision === 'deny' ? 'border-fail text-fail' : 'border-line-strong text-ink-3'}`}>{approval ? approval.decision === 'approve' ? '✓' : '×' : '·'}</span>
              <div className='min-w-0 flex-1'><p className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>{ROLE_LABEL[role]}</p>{approval ? <p className='break-words text-[10px] text-ink-2'>{approval.approver} · {approval.decision === 'approve' ? 'DISETUJUI' : 'DITOLAK'} {fmt(approval.at)}</p> : <StatusDot tone={roleState}>Menunggu</StatusDot>}</div>
              {showDecision && <div className='flex gap-1.5'><Button size='sm' className='h-7 px-2 text-[10px]' disabled={locked || deciding} aria-describedby={isRequester ? `${reasonId}-disabled` : undefined} onClick={() => onDecide(r, 'approve', reason)}>Setujui</Button><Button size='sm' variant='outline' className='h-7 px-2 text-[10px]' disabled={locked || deciding} aria-describedby={isRequester ? `${reasonId}-disabled` : undefined} onClick={() => onDecide(r, 'deny', reason)}>Tolak</Button></div>}
            </div>
          })}
          {showDecision && <div className='flex flex-col gap-2 border-t border-line bg-surface-2 p-2.5'><Label htmlFor={reasonId} className='font-mono text-[8px] uppercase text-ink-3'>Catatan keputusan · opsional</Label><Textarea id={reasonId} value={reason} disabled={locked} onChange={(e) => setReason(e.target.value)} className='min-h-16 rounded-none bg-surface text-[11px]' />{(isRequester || isGrantee || decided || viewerRole === null) && <p id={`${reasonId}-disabled`} className='text-[10px] text-ink-3'>{isRequester ? 'Pemohon tidak dapat memutuskan permintaannya.' : isGrantee ? 'Penerima akses tidak dapat memutuskan permintaan ini.' : decided ? 'Anda sudah memberi keputusan.' : 'Peran Anda tidak memiliki wewenang persetujuan.'}</p>}</div>}
        </section>
      </div>
      <div className='flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-3.5 py-2'>
        <span className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Dua persetujuan berbeda wajib · audit tercatat</span>
        <div className='flex flex-wrap gap-1.5'>{r.approvals.map((a) => <Chip key={a.role} tone={a.decision === 'approve' ? 'pass' : 'fail'}>{ROLE_LABEL[a.role]} · {a.approver} · {a.reason ?? fmt(a.at)}</Chip>)}</div>
      </div>
    </CardPanel>
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
    <section className='grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]'>
      <section
        aria-labelledby={`${uid}-queue`}
        className='flex min-w-0 flex-col gap-3'
      >
        <div className='flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2'>
          <h2 id={`${uid}-queue`} className='font-mono text-[9px] uppercase tracking-[.1em] text-ink-2'>Antrean permintaan</h2>
          <span className='font-mono text-[8px] text-ink-3'>{list.length} tercatat</span>
        </div>

        {requests.isPending ? (
          <div className='flex flex-col gap-3'>
            <Skeleton className='h-40 w-full rounded-none' />
            <Skeleton className='h-40 w-full rounded-none' />
          </div>
        ) : requests.isError ? (
          <Alert variant='destructive'>
            <AlertTitle>Gagal memuat permintaan</AlertTitle>
            <AlertDescription>{errMsg(requests.error)}</AlertDescription>
          </Alert>
        ) : list.length === 0 ? (
          <EmptyState
            title='Belum ada permintaan akses'
            desc='Permintaan baru akan tampil di sini untuk diputuskan dua pihak.'
          />
        ) : (
          <ul className='flex flex-col gap-3'>
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

      <aside className='flex min-w-0 flex-col gap-3'>
      {canRequest && (
        <CardPanel title='Ajukan permintaan akses' meta='2 persetujuan'>
            <form
              className='flex flex-col gap-3.5 p-3.5'
              noValidate
              onSubmit={submitCreate}
            >
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor={`${uid}-doc`} className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>ID dokumen <span className='text-line-strong'>· format DOC-0000</span></Label>
                <Input
                  id={`${uid}-doc`}
                  value={docId}
                  placeholder='DOC-0001'
                  autoComplete='off'
                  className='rounded-none font-mono text-[11px]'
                  aria-invalid={Boolean(createErrs.docId)}
                  aria-describedby={
                    createErrs.docId ? `${uid}-doc-err` : undefined
                  }
                  onChange={(e) => setDocId(e.target.value)}
                />
                <FieldError id={`${uid}-doc-err`} msg={createErrs.docId} />
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label htmlFor={`${uid}-grantee`} className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Penerima akses</Label>
                <Select
                  value={grantee}
                  onValueChange={setGrantee}
                  disabled={users.isPending || users.isError}
                >
                  <SelectTrigger
                    id={`${uid}-grantee`}
                    className='w-full rounded-none text-[11px]'
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
                  <p className='text-[10px] text-ink-3'>
                    Daftar pengguna gagal dimuat.
                  </p>
                )}
                <FieldError
                  id={`${uid}-grantee-err`}
                  msg={createErrs.grantee}
                />
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label htmlFor={`${uid}-reason`} className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Alasan</Label>
                <Textarea
                  id={`${uid}-reason`}
                  value={reason}
                  className='min-h-20 rounded-none text-[11px]'
                  aria-invalid={Boolean(createErrs.reason)}
                  aria-describedby={`${uid}-reason-count${createErrs.reason ? ` ${uid}-reason-err` : ''}`}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className='flex items-start justify-between gap-2'>
                  <FieldError
                    id={`${uid}-reason-err`}
                    msg={createErrs.reason}
                  />
                  <span
                    id={`${uid}-reason-count`}
                    className='ms-auto font-mono text-[8px] text-ink-3 tabular-nums'
                  >
                    {[...reason.trim()].length}/{REASON_MAX}
                  </span>
                </div>
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label htmlFor={`${uid}-expires`} className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Kedaluwarsa · opsional</Label>
                <Input
                  id={`${uid}-expires`}
                  type='datetime-local'
                  value={expires}
                  className='rounded-none text-[11px]'
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

              <div className='border border-line bg-surface-2 p-2.5'>
                <p className='mb-1.5 font-mono text-[8px] uppercase tracking-[.08em] text-ink-2'>Butuh dua persetujuan berbeda</p>
                <ol className='flex flex-col gap-1 font-mono text-[8px] text-ink-3'>
                  <li><span className='text-ink-2'>01</span> Komandan · L5</li>
                  <li><span className='text-ink-2'>02</span> Perwira keamanan · flag SO</li>
                </ol>
              </div>

              <Button
                type='submit'
                className='w-full rounded-none'
                disabled={create.isPending}
              >
                Ajukan permintaan
              </Button>
              <p className='font-mono text-[8px] leading-[1.5] text-ink-3'>Permintaan dicatat pada audit log. Akses baru aktif setelah dua persetujuan.</p>
            </form>
        </CardPanel>
      )}

      {canRevoke && (
        <CardPanel title='Cabut akses' meta='langsung berlaku'>
            <form
              className='flex flex-col gap-3.5 p-3.5'
              noValidate
              onSubmit={submitRevoke}
            >
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor={`${uid}-rev-doc`} className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>ID dokumen</Label>
                <Input
                  id={`${uid}-rev-doc`}
                  value={revokeDoc}
                  placeholder='DOC-0001'
                  autoComplete='off'
                  className='rounded-none font-mono text-[11px]'
                  aria-invalid={Boolean(revokeErrs.docId)}
                  aria-describedby={
                    revokeErrs.docId ? `${uid}-rev-doc-err` : undefined
                  }
                  onChange={(e) => setRevokeDoc(e.target.value)}
                />
                <FieldError id={`${uid}-rev-doc-err`} msg={revokeErrs.docId} />
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label htmlFor={`${uid}-rev-user`} className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Nama pengguna</Label>
                <Input
                  id={`${uid}-rev-user`}
                  value={revokeUser}
                  autoComplete='off'
                  className='rounded-none font-mono text-[11px]'
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
                className='w-full rounded-none'
              >
                Cabut akses
              </Button>
            </form>
        </CardPanel>
      )}
      </aside>

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
