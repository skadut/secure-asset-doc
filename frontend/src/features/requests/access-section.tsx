import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Clock, Shield, X } from 'lucide-react'
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
import { getDocument } from '@/lib/grc'
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
import { CardPanel } from '@/components/card-panel'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { StatusDot } from '@/components/status-dot'
import { TlpMark } from '@/components/tlp-mark'
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
type Errs = Record<string, string | undefined>

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
const fmtTime = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
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
  const isRequester = r.requestedBy === me.username
  const isGrantee = r.grantee === me.username
  const decided =
    viewerRole !== null && r.approvals.some((a) => a.role === viewerRole)
  const locked = isRequester || isGrantee || decided || viewerRole === null
  const showDecision =
    r.status === 'pending' &&
    Boolean(me.can.access?.approve) &&
    !r.approvals.some((a) => a.approver === me.username)
  const documentTitle = getDocument(r.documentId)?.title
  const statusTone =
    r.status === 'approved'
      ? 'pass'
      : r.status === 'denied'
        ? 'fail'
        : r.status === 'pending'
          ? 'warn'
          : 'ink'
  const meta =
    r.status === 'pending' ? (
      <StatusDot tone='warn'>Menunggu {r.approvals.length}/2</StatusDot>
    ) : (
      <StatusDot tone={statusTone}>{STATUS_LABEL[r.status]}</StatusDot>
    )

  return (
    <CardPanel
      title={
        <span className='flex min-w-0 items-center gap-2'>
          <TlpMark tlp={r.tlp} />
          <span className='text-ink-3'>/</span>
          <span className='shrink-0'>{r.documentId}</span>
          {documentTitle && (
            <span className='truncate font-mono text-[9px] font-normal tracking-normal text-ink-3 normal-case'>
              {documentTitle}
            </span>
          )}
        </span>
      }
      actions={meta}
      className='req-card overflow-hidden'
    >
      <div className='grid min-w-0 gap-4 p-3.5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,.8fr)]'>
        <div className='flex min-w-0 flex-col gap-3'>
          <p className='flex flex-wrap items-baseline gap-x-2 text-[11px]'>
            <span className='font-mono text-[8px] tracking-[.1em] text-ink-3 uppercase'>
              Penerima
            </span>
            <span className='font-medium break-all text-ink'>{r.grantee}</span>
            <span className='break-words text-ink-3'>
              · {r.granteeUnit ?? '—'}
            </span>
          </p>
          <p className='text-[13px] leading-normal break-words whitespace-pre-line text-ink'>
            {r.reason}
          </p>
          <p className='font-mono text-[8px] leading-[1.6] text-ink-3'>
            Diajukan {r.requestedBy} · {fmt(r.createdAt)} · kedaluwarsa{' '}
            {r.expiresAt ? fmt(r.expiresAt) : 'tanpa kedaluwarsa'}
          </p>
        </div>

        <section
          aria-label='Slot persetujuan'
          className='flex min-w-0 flex-col border border-line'
        >
          {(['commander', 'security_officer'] as const).map((role) => {
            const approval = r.approvals.find((a) => a.role === role)
            const canAct = showDecision && role === viewerRole && !approval
            return (
              <div
                key={role}
                className='flex min-w-0 flex-wrap items-center gap-2.5 border-b border-line px-2.5 py-2 last:border-b-0'
              >
                <span
                  aria-hidden='true'
                  className={`req-slot-mark grid size-5 shrink-0 place-items-center border ${
                    approval?.decision === 'approve'
                      ? 'border-pass bg-pass text-surface'
                      : approval?.decision === 'deny'
                        ? 'border-fail bg-fail text-surface'
                        : 'border-line bg-surface-2 text-ink-3'
                  }`}
                >
                  {!approval ? (
                    <Clock className='size-3' />
                  ) : approval.decision === 'approve' ? (
                    <Check className='size-3' />
                  ) : (
                    <X className='size-3' />
                  )}
                </span>
                <div className='flex min-w-0 flex-1 flex-col gap-1'>
                  <p className='font-mono text-[8px] tracking-[.08em] text-ink-3 uppercase'>
                    {ROLE_LABEL[role]}
                  </p>
                  {approval ? (
                    <>
                      <p className='text-[11px] font-medium break-words text-ink'>
                        {approval.approver}
                      </p>
                      {approval.reason && (
                        <p className='text-[10px] break-words text-ink-2'>
                          {approval.reason}
                        </p>
                      )}
                    </>
                  ) : (
                    <StatusDot tone={r.status === 'pending' ? 'warn' : 'ink'}>
                      Menunggu
                    </StatusDot>
                  )}
                </div>
                {approval && (
                  <time
                    dateTime={approval.at}
                    title={fmt(approval.at)}
                    className={`shrink-0 font-mono text-[8px] ${
                      approval.decision === 'approve'
                        ? 'text-pass'
                        : 'text-fail'
                    }`}
                  >
                    {approval.decision === 'approve' ? 'DISETUJUI' : 'DITOLAK'}{' '}
                    {fmtTime(approval.at)}
                  </time>
                )}
                {canAct && (
                  <div className='flex shrink-0 gap-1.5'>
                    <Button
                      size='sm'
                      className='h-[30px] rounded-none px-2.5 text-[11.5px] font-semibold'
                      disabled={locked || deciding}
                      aria-describedby={
                        isRequester ? `${reasonId}-disabled` : undefined
                      }
                      onClick={() => onDecide(r, 'approve', reason)}
                    >
                      Setujui
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      className='h-[30px] rounded-none px-2.5 text-[11.5px] font-semibold'
                      disabled={locked || deciding}
                      aria-describedby={
                        isRequester ? `${reasonId}-disabled` : undefined
                      }
                      onClick={() => onDecide(r, 'deny', reason)}
                    >
                      Tolak
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
          {showDecision && (
            <div className='flex flex-col gap-2 border-t border-line bg-surface-2 p-2.5'>
              <Label
                htmlFor={reasonId}
                className='font-mono text-[8px] text-ink-3 uppercase'
              >
                Catatan keputusan · opsional
              </Label>
              <Textarea
                id={reasonId}
                value={reason}
                disabled={locked}
                onChange={(e) => setReason(e.target.value)}
                className='min-h-16 rounded-none bg-surface text-[11px]'
              />
              {locked && (
                <p
                  id={`${reasonId}-disabled`}
                  className='text-[10px] text-ink-3'
                >
                  {isRequester
                    ? 'Pemohon tidak dapat memutuskan permintaannya.'
                    : isGrantee
                      ? 'Penerima akses tidak dapat memutuskan permintaan ini.'
                      : decided
                        ? 'Anda sudah memberi keputusan.'
                        : 'Peran Anda tidak memiliki wewenang persetujuan.'}
                </p>
              )}
            </div>
          )}
        </section>
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
  const resetCreate = () => {
    setDocId('')
    setGrantee('')
    setReason('')
    setExpires('')
    setCreateAttempted(false)
  }
  const hasDraft = Boolean(docId || grantee || reason || expires)

  const create = useMutation({
    mutationFn: () =>
      createAccessRequest(docId.trim(), {
        grantee,
        reason: reason.trim(),
        expiresAt: expires ? new Date(expires).toISOString() : undefined,
      }),
    onSuccess: () => {
      toast.success('Permintaan akses diajukan')
      resetCreate()
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
        aria-label='Antrean permintaan'
        className='flex min-w-0 flex-col gap-3'
      >
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
          <>
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
            <p className='flex items-start gap-2.5 border border-line bg-surface px-3.5 py-2.5 text-[11px] text-ink-2'>
              <Shield
                aria-hidden='true'
                className='mt-px size-3.5 shrink-0 text-ink'
              />
              <span>
                Pemohon dan penerima tidak dapat menyetujui. Satu orang tidak
                boleh mengisi dua slot. Penolakan satu pihak mengakhiri
                permintaan.
              </span>
            </p>
          </>
        )}
      </section>

      <aside className='flex min-w-0 flex-col gap-3'>
        {canRequest && (
          <CardPanel
            title='Ajukan permintaan akses'
            actions={
              hasDraft ? (
                <button
                  type='button'
                  onClick={resetCreate}
                  aria-label='Reset formulir'
                  className='text-ink-3 transition-colors hover:text-ink'
                >
                  <X className='size-3.5' />
                </button>
              ) : undefined
            }
          >
            <form
              className='flex flex-col gap-3.5 p-3.5'
              noValidate
              onSubmit={submitCreate}
            >
              <div className='flex flex-col gap-1.5'>
                <div className='flex items-baseline justify-between gap-2'>
                  <Label
                    htmlFor={`${uid}-doc`}
                    className='font-mono text-[8px] tracking-[.08em] text-ink-3 uppercase'
                  >
                    ID dokumen
                  </Label>
                  <span className='font-mono text-[8px] text-ink-3'>
                    format DOC-0000
                  </span>
                </div>
                <Input
                  id={`${uid}-doc`}
                  value={docId}
                  placeholder='DOC-0011'
                  autoComplete='off'
                  className='h-[34px] rounded-none font-mono text-[10px] md:text-[10px]'
                  aria-invalid={Boolean(createErrs.docId)}
                  aria-describedby={
                    createErrs.docId ? `${uid}-doc-err` : undefined
                  }
                  onChange={(e) => setDocId(e.target.value)}
                />
                <FieldError id={`${uid}-doc-err`} msg={createErrs.docId} />
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label
                  htmlFor={`${uid}-grantee`}
                  className='font-mono text-[8px] tracking-[.08em] text-ink-3 uppercase'
                >
                  Penerima
                </Label>
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
                <div className='flex items-baseline justify-between gap-2'>
                  <Label
                    htmlFor={`${uid}-reason`}
                    className='font-mono text-[8px] tracking-[.08em] text-ink-3 uppercase'
                  >
                    Alasan
                  </Label>
                  <span
                    id={`${uid}-reason-count`}
                    className='font-mono text-[8px] text-ink-3 tabular-nums'
                  >
                    {[...reason.trim()].length} / {REASON_MAX}
                  </span>
                </div>
                <Textarea
                  id={`${uid}-reason`}
                  value={reason}
                  className='min-h-20 rounded-none text-[11px]'
                  aria-invalid={Boolean(createErrs.reason)}
                  aria-describedby={`${uid}-reason-count${createErrs.reason ? ` ${uid}-reason-err` : ''}`}
                  onChange={(e) => setReason(e.target.value)}
                />
                <FieldError id={`${uid}-reason-err`} msg={createErrs.reason} />
              </div>

              <div className='flex flex-col gap-1.5'>
                <div className='flex items-baseline justify-between gap-2'>
                  <Label
                    htmlFor={`${uid}-expires`}
                    className='font-mono text-[8px] tracking-[.08em] text-ink-3 uppercase'
                  >
                    Kedaluwarsa
                  </Label>
                  <span className='font-mono text-[8px] text-ink-3'>
                    opsional
                  </span>
                </div>
                <div className='relative'>
                  <Clock
                    aria-hidden='true'
                    className='pointer-events-none absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-ink-3'
                  />
                  <Input
                    id={`${uid}-expires`}
                    type='datetime-local'
                    value={expires}
                    className='h-[34px] rounded-none pl-7 font-mono text-[10px] md:text-[10px]'
                    aria-invalid={Boolean(createErrs.expires)}
                    aria-describedby={
                      createErrs.expires ? `${uid}-expires-err` : undefined
                    }
                    onChange={(e) => setExpires(e.target.value)}
                  />
                </div>
                <FieldError
                  id={`${uid}-expires-err`}
                  msg={createErrs.expires}
                />
              </div>

              <div className='border border-line bg-surface-2 p-3'>
                <p className='mb-2.5 font-mono text-[8px] tracking-[.08em] text-ink-3 uppercase'>
                  Butuh dua persetujuan berbeda
                </p>
                <ol className='flex flex-col gap-2 text-[10.5px] text-ink-2'>
                  <li className='flex items-center gap-2'>
                    <span className='grid size-3.5 shrink-0 place-items-center border border-line-2 font-mono text-[7px] leading-none text-ink-3'>
                      01
                    </span>
                    Komandan · L5
                  </li>
                  <li className='flex items-center gap-2'>
                    <span className='grid size-3.5 shrink-0 place-items-center border border-line-2 font-mono text-[7px] leading-none text-ink-3'>
                      02
                    </span>
                    Perwira keamanan · flag SO
                  </li>
                </ol>
              </div>

              <Button
                type='submit'
                className='h-10 w-full justify-between rounded-none text-[12.5px] font-semibold'
                disabled={create.isPending}
              >
                Ajukan permintaan
                <ArrowRight aria-hidden='true' />
              </Button>
              <p className='font-mono text-[9px] leading-[1.5] text-ink-3'>
                Permintaan tidak dapat dibatalkan setelah diajukan. Keputusan
                dicatat di audit log.
              </p>
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
                <Label
                  htmlFor={`${uid}-rev-doc`}
                  className='font-mono text-[8px] tracking-[.08em] text-ink-3 uppercase'
                >
                  ID dokumen
                </Label>
                <Input
                  id={`${uid}-rev-doc`}
                  value={revokeDoc}
                  placeholder='DOC-0001'
                  autoComplete='off'
                  className='h-[34px] rounded-none font-mono text-[10px] md:text-[10px]'
                  aria-invalid={Boolean(revokeErrs.docId)}
                  aria-describedby={
                    revokeErrs.docId ? `${uid}-rev-doc-err` : undefined
                  }
                  onChange={(e) => setRevokeDoc(e.target.value)}
                />
                <FieldError id={`${uid}-rev-doc-err`} msg={revokeErrs.docId} />
              </div>

              <div className='flex flex-col gap-1.5'>
                <Label
                  htmlFor={`${uid}-rev-user`}
                  className='font-mono text-[8px] tracking-[.08em] text-ink-3 uppercase'
                >
                  Nama pengguna
                </Label>
                <Input
                  id={`${uid}-rev-user`}
                  value={revokeUser}
                  autoComplete='off'
                  className='h-[34px] rounded-none font-mono text-[10px] md:text-[10px]'
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
                className='h-10 w-full rounded-none text-[12.5px] font-semibold'
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
