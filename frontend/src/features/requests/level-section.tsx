import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import {
  ApiError,
  createLevelRequest,
  decideLevelRequest,
  fips199For,
  listLevelRequests,
  listUsers,
  type Fips199,
  type LevelChangeInput,
  type LevelRequest,
} from '@/lib/access-api'
import { getMe, type Me } from '@/lib/session'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CardPanel } from '@/components/card-panel'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusDot } from '@/components/status-dot'

type Decision = 'approve' | 'deny'

const STATUS: Record<string, string> = {
  pending: 'Menunggu',
  approved: 'Diberikan',
  denied: 'Ditolak',
  cancelled: 'Dibatalkan',
}
const LEVELS = [1, 2, 3, 4, 5]
const FIPS: Fips199[] = ['LOW', 'MODERATE', 'HIGH']
const STATUS_TONE: Record<string, 'pass' | 'warn' | 'fail' | 'ink'> = {
  pending: 'warn',
  approved: 'pass',
  denied: 'fail',
  cancelled: 'ink',
}
const LABEL = 'font-mono text-[9px] uppercase tracking-[.1em] text-ink-3'

const len = (s: string) => [...s.trim()].length
const yesNo = (v: boolean) => (v ? 'Ya' : 'Tidak')
const errMsg = (e: unknown) =>
  e instanceof ApiError ? e.message : 'Permintaan gagal diproses'
const pad = (n: number) => String(n).padStart(2, '0')
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fmtTime = (iso: string) => new Date(iso).toLocaleString('id-ID')

function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number)
  return isoDay(new Date(y, m - 1, d + n))
}

// Mirrors backend plus12Months: clamped to month end.
function maxReviewDue(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate()
  return `${y + 1}-${pad(m)}-${pad(Math.min(d, last))}`
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className={LABEL}>{label}</dt>
      <dd className='min-w-0 text-[12.5px] break-words text-ink'>{children}</dd>
    </>
  )
}

function RequestItem({ r, me }: { r: LevelRequest; me: Me }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [dec, setDec] = useState<Decision | null>(null)
  const pending = r.status === 'pending'
  const blocked = r.requestedBy === me.username || r.targetUser === me.username
  const isGrantee = r.targetUser === me.username
  // Pending rows are always raises (lowers apply immediately). Raise approve: commander only.
  // Deny: commander or security officer (mirrors canManage in levels.mjs).
  const base = me.can.access?.approve === true
  const canApprove = base && me.accessLevel === 5
  const canDeny = base && (me.accessLevel === 5 || me.securityOfficer)
  const reasonId = `reason-${r.id}`

  const decide = useMutation({
    mutationFn: (decision: Decision) =>
      decideLevelRequest(r.id, {
        decision,
        reason: reason.trim() || undefined,
      }),
    onSuccess: (res) => {
      toast.success(
        res.applied ? 'Perubahan level disetujui' : 'Permintaan ditolak'
      )
      setDec(null)
      setReason('')
      void qc.invalidateQueries({ queryKey: ['level-requests'] })
      void qc.invalidateQueries({ queryKey: ['access-users'] })
    },
    onError: (e) => {
      toast.error(errMsg(e))
      setDec(null)
      if (e instanceof ApiError && e.status === 409) {
        void qc.invalidateQueries({ queryKey: ['level-requests'] })
      }
    },
  })

  return (
    <li className='flex flex-col gap-3 border border-line bg-surface p-3.5'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='min-w-0 text-[15px] font-medium break-all text-ink'>
          {r.targetUser}
        </p>
        <StatusDot tone={STATUS_TONE[r.status] ?? 'ink'}>
          {STATUS[r.status] ?? r.status}
        </StatusDot>
      </div>

      <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5'>
        <Field label='Perubahan level'>{`${r.currentLevel} → ${r.newLevel}`}</Field>
        <Field label='Justifikasi'>{r.justification}</Field>
        <Field label='Screening diverifikasi (PS-3)'>
          {yesNo(r.screeningVerified)}
        </Field>
        <Field label='Referensi screening'>{r.screeningRef ?? '—'}</Field>
        <Field label='Perjanjian akses ditandatangani (PS-6)'>
          {yesNo(r.accessAgreementSigned)}
        </Field>
        <Field label='Tanggal perjanjian akses'>
          {r.accessAgreementDate ?? '—'}
        </Field>
        <Field label='Tinjau ulang sebelum (AC-2)'>{r.reviewDue ?? '—'}</Field>
        <Field label='Basis FIPS 199'>{r.fips199Basis ?? '—'}</Field>
        <Field label='Diajukan oleh'>{r.requestedBy}</Field>
        <Field label='Dibuat'>{fmtTime(r.createdAt)}</Field>
        {!pending && (
          <>
            <Field label='Diputuskan oleh'>{r.decidedBy ?? '—'}</Field>
            <Field label='Waktu keputusan'>
              {r.decidedAt ? fmtTime(r.decidedAt) : '—'}
            </Field>
            <Field label='Alasan keputusan'>{r.decisionReason ?? '—'}</Field>
          </>
        )}
      </dl>

      {pending && (canApprove || canDeny) && (
        <div className='flex flex-col gap-3'>
          {blocked && (
            <p className='text-[12.5px] text-ink-3'>
              {isGrantee
                ? 'Penerima perubahan level tidak dapat memutuskan permintaan ini'
                : 'Anda tidak dapat memutuskan permintaan ini'}
            </p>
          )}
          <Label className={LABEL} htmlFor={reasonId}>
            Alasan keputusan (opsional)
          </Label>
          <Textarea
            id={reasonId}
            value={reason}
            disabled={blocked}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className='flex flex-wrap gap-2'>
            {canApprove && (
              <Button
                className='h-11'
                disabled={blocked || decide.isPending}
                onClick={() => setDec('approve')}
              >
                Setujui
              </Button>
            )}
            {canDeny && (
              <Button
                variant='outline'
                className='h-11'
                disabled={blocked || decide.isPending}
                onClick={() => setDec('deny')}
              >
                Tolak
              </Button>
            )}
          </div>
          <ConfirmDialog
            open={dec !== null}
            onOpenChange={(o) => {
              if (!o) setDec(null)
            }}
            title={
              dec === 'approve'
                ? 'Setujui perubahan level?'
                : 'Tolak permintaan ini?'
            }
            desc={
              dec === 'approve'
                ? `Level ${r.targetUser} akan diubah menjadi ${r.newLevel}.`
                : 'Permintaan perubahan level ini akan ditolak.'
            }
            confirmText={dec === 'approve' ? 'Setujui' : 'Tolak'}
            cancelBtnText='Batal'
            destructive={dec === 'deny'}
            isLoading={decide.isPending}
            handleConfirm={() => {
              if (dec) decide.mutate(dec)
            }}
          />
        </div>
      )}
    </li>
  )
}

function CreateForm({ me }: { me: Me }) {
  const qc = useQueryClient()
  const users = useQuery({
    queryKey: ['access-users'],
    queryFn: listUsers,
    retry: false,
  })

  const [target, setTarget] = useState('')
  const [newLevel, setNewLevel] = useState('')
  const [justification, setJustification] = useState('')
  const [screeningVerified, setScreeningVerified] = useState(false)
  const [screeningRef, setScreeningRef] = useState('')
  const [agreementSigned, setAgreementSigned] = useState(false)
  const [agreementDate, setAgreementDate] = useState('')
  const [reviewDue, setReviewDue] = useState('')
  const [fips, setFips] = useState<Fips199 | ''>('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirmLower, setConfirmLower] = useState(false)

  const t = new Date().toISOString().slice(0, 10)
  const minReview = addDays(t, 1)
  const maxReview = maxReviewDue(t)
  const others = users.data?.filter((u) => u.username !== me.username) ?? []
  const current = users.data?.find((u) => u.username === target)?.accessLevel
  const level = Number(newLevel)
  const isRaise = current !== undefined && newLevel !== '' && level > current
  const isLower = current !== undefined && newLevel !== '' && level < current
  const isSame = current !== undefined && newLevel !== '' && level === current

  const reset = () => {
    setTarget('')
    setNewLevel('')
    setJustification('')
    setScreeningVerified(false)
    setScreeningRef('')
    setAgreementSigned(false)
    setAgreementDate('')
    setReviewDue('')
    setFips('')
    setErrors({})
  }

  const submit = useMutation({
    mutationFn: (input: LevelChangeInput) => createLevelRequest(target, input),
    onSuccess: (res) => {
      if ('applied' in res) {
        toast.success('Level diturunkan')
        void qc.invalidateQueries({ queryKey: ['access-users'] })
      } else {
        toast.success('Permintaan perubahan level dibuat')
      }
      void qc.invalidateQueries({ queryKey: ['level-requests'] })
      reset()
    },
    onError: (e) => {
      toast.error(errMsg(e))
      if (e instanceof ApiError && e.status === 409) {
        void qc.invalidateQueries({ queryKey: ['level-requests'] })
      }
    },
    onSettled: () => setConfirmLower(false),
  })

  function validate() {
    const e: Record<string, string> = {}
    if (!target || current === undefined) e.target = 'Pilih pengguna'
    if (newLevel === '') e.newLevel = 'Pilih level baru'
    else if (isSame) e.newLevel = 'Level baru harus berbeda dari level sekarang'
    const j = len(justification)
    if (j < 1 || j > 500)
      e.justification = 'Justifikasi wajib diisi, maksimal 500 karakter'
    if (isRaise) {
      if (!screeningVerified)
        e.screeningVerified = 'Centang jika screening sudah diverifikasi (PS-3)'
      const refLen = len(screeningRef)
      if (refLen < 1 || refLen > 120) {
        e.screeningRef =
          'Referensi screening wajib diisi, maksimal 120 karakter (PS-3)'
      }
      if (!agreementSigned)
        e.agreementSigned =
          'Centang jika perjanjian akses sudah ditandatangani (PS-6)'
      if (!agreementDate || agreementDate > t) {
        e.agreementDate =
          'Tanggal perjanjian akses wajib diisi dan tidak boleh setelah hari ini (PS-6)'
      }
      if (!reviewDue) e.reviewDue = 'Isi tanggal tinjau ulang (AC-2)'
      else if (reviewDue < minReview)
        e.reviewDue = 'Tanggal tinjau ulang harus setelah hari ini (AC-2)'
      else if (reviewDue > maxReview) {
        e.reviewDue =
          'Tanggal tinjau ulang maksimal 12 bulan dari hari ini (AC-2)'
      }
      if (!fips) e.fips = 'Pilih basis FIPS 199'
    }
    return e
  }

  function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length > 0) return
    const base = { newLevel: level, justification: justification.trim() }
    if (isLower) {
      setConfirmLower(true)
      return
    }
    submit.mutate({
      ...base,
      screeningVerified: true,
      screeningRef: screeningRef.trim(),
      accessAgreementSigned: true,
      accessAgreementDate: agreementDate,
      reviewDue,
      fips199Basis: fips || undefined,
    })
  }

  const err = (k: string) =>
    errors[k] ? (
      <p id={`${k}-err`} className='text-sm text-destructive'>
        {errors[k]}
      </p>
    ) : null
  const invalid = (k: string) => Boolean(errors[k])
  const describe = (k: string) => (errors[k] ? `${k}-err` : undefined)

  return (
    <CardPanel title='Ajukan perubahan level' className='min-w-0'>
      <div className='p-3.5'>
        <form onSubmit={onSubmit} noValidate className='flex flex-col gap-4'>
          {users.isError && (
            <Alert variant='destructive'>
              <AlertDescription>{errMsg(users.error)}</AlertDescription>
            </Alert>
          )}

          <div className='flex flex-col gap-2'>
            <Label className={LABEL} htmlFor='lvl-target'>
              Pengguna
            </Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger
                id='lvl-target'
                className='h-11 w-full'
                aria-invalid={invalid('target')}
                aria-describedby={describe('target')}
              >
                <SelectValue placeholder='Pilih pengguna' />
              </SelectTrigger>
              <SelectContent>
                {others.map((u) => (
                  <SelectItem key={u.username} value={u.username}>
                    {u.rankName ? `${u.username} · ${u.rankName}` : u.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {err('target')}
          </div>

          <p className='text-[12.5px] text-ink-3'>
            Level sekarang:{' '}
            <span className='font-medium text-ink'>{current ?? '—'}</span>
          </p>

          <div className='flex flex-col gap-2'>
            <Label className={LABEL} htmlFor='lvl-new'>
              Level baru
            </Label>
            <Select
              value={newLevel}
              onValueChange={(v) => {
                setNewLevel(v)
                setFips(fips199For(Number(v)))
              }}
            >
              <SelectTrigger
                id='lvl-new'
                className='h-11 w-full'
                aria-invalid={invalid('newLevel')}
                aria-describedby={describe('newLevel')}
              >
                <SelectValue placeholder='Pilih level' />
              </SelectTrigger>
              <SelectContent>
                {LEVELS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {`Level ${n}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-[12.5px] text-ink-3'>
              Berikan level minimum yang dibutuhkan (AC-6).
            </p>
            {err('newLevel')}
          </div>

          {isLower && (
            <p className='text-[12.5px] font-medium text-ink'>
              Penurunan level langsung berlaku. Sesi pengguna akan diakhiri.
            </p>
          )}

          <div className='flex flex-col gap-2'>
            <div className='flex items-center justify-between gap-2'>
              <Label className={LABEL} htmlFor='lvl-justification'>
                Justifikasi
              </Label>
              <span className='text-[11.5px] text-ink-3'>
                {len(justification)}/500
              </span>
            </div>
            <Textarea
              id='lvl-justification'
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              aria-invalid={invalid('justification')}
              aria-describedby={describe('justification')}
            />
            {err('justification')}
          </div>

          {isRaise && (
            <fieldset className='flex flex-col gap-4 border border-line bg-surface-2 p-3.5'>
              <legend className={`px-1 ${LABEL}`}>Syarat kenaikan level</legend>

              <div className='flex flex-col gap-2'>
                <div className='flex items-center gap-3'>
                  <Checkbox
                    id='lvl-screening'
                    checked={screeningVerified}
                    onCheckedChange={(v) => setScreeningVerified(v === true)}
                    aria-invalid={invalid('screeningVerified')}
                    aria-describedby={describe('screeningVerified')}
                  />
                  <Label className={LABEL} htmlFor='lvl-screening'>
                    Screening sudah diverifikasi (PS-3)
                  </Label>
                </div>
                {err('screeningVerified')}
              </div>

              <div className='flex flex-col gap-2'>
                <Label className={LABEL} htmlFor='lvl-screening-ref'>
                  Referensi screening (PS-3)
                </Label>
                <Input
                  id='lvl-screening-ref'
                  className='h-11'
                  value={screeningRef}
                  onChange={(e) => setScreeningRef(e.target.value)}
                  aria-invalid={invalid('screeningRef')}
                  aria-describedby={describe('screeningRef')}
                />
                {err('screeningRef')}
              </div>

              <div className='flex flex-col gap-2'>
                <div className='flex items-center gap-3'>
                  <Checkbox
                    id='lvl-agreement'
                    checked={agreementSigned}
                    onCheckedChange={(v) => setAgreementSigned(v === true)}
                    aria-invalid={invalid('agreementSigned')}
                    aria-describedby={describe('agreementSigned')}
                  />
                  <Label className={LABEL} htmlFor='lvl-agreement'>
                    Perjanjian akses sudah ditandatangani (PS-6)
                  </Label>
                </div>
                {err('agreementSigned')}
              </div>

              <div className='flex flex-col gap-2'>
                <Label className={LABEL} htmlFor='lvl-agreement-date'>
                  Tanggal perjanjian akses (PS-6)
                </Label>
                <Input
                  id='lvl-agreement-date'
                  type='date'
                  className='h-11'
                  max={t}
                  value={agreementDate}
                  onChange={(e) => setAgreementDate(e.target.value)}
                  aria-invalid={invalid('agreementDate')}
                  aria-describedby={describe('agreementDate')}
                />
                {err('agreementDate')}
              </div>

              <div className='flex flex-col gap-2'>
                <Label className={LABEL} htmlFor='lvl-review-due'>
                  Tinjau ulang sebelum (AC-2)
                </Label>
                <Input
                  id='lvl-review-due'
                  type='date'
                  className='h-11'
                  min={minReview}
                  max={maxReview}
                  value={reviewDue}
                  onChange={(e) => setReviewDue(e.target.value)}
                  aria-invalid={invalid('reviewDue')}
                  aria-describedby={describe('reviewDue')}
                />
                <p className='text-[12.5px] text-ink-3'>
                  Antara besok dan 12 bulan dari hari ini (AC-2).
                </p>
                {err('reviewDue')}
              </div>

              <div className='flex flex-col gap-2'>
                <Label className={LABEL} htmlFor='lvl-fips'>
                  Basis FIPS 199
                </Label>
                <Select
                  value={fips}
                  onValueChange={(v) => setFips(v as Fips199)}
                >
                  <SelectTrigger
                    id='lvl-fips'
                    className='h-11 w-full'
                    aria-invalid={invalid('fips')}
                    aria-describedby={describe('fips')}
                  >
                    <SelectValue placeholder='Pilih basis' />
                  </SelectTrigger>
                  <SelectContent>
                    {FIPS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {err('fips')}
              </div>
            </fieldset>
          )}

          <Button
            type='submit'
            className='h-11 w-full justify-between rounded-none'
            disabled={submit.isPending}
          >
            {isLower ? 'Turunkan level' : 'Ajukan perubahan'}
            <ArrowRight aria-hidden='true' />
          </Button>

          <ConfirmDialog
            open={confirmLower}
            onOpenChange={(o) => {
              if (!o) setConfirmLower(false)
            }}
            title='Turunkan level sekarang?'
            desc={`Level ${target} akan diturunkan menjadi ${level} sekarang juga. Perubahan langsung berlaku dan semua sesi pengguna tersebut akan diakhiri.`}
            confirmText='Turunkan level'
            cancelBtnText='Batal'
            destructive
            isLoading={submit.isPending}
            handleConfirm={() =>
              submit.mutate({
                newLevel: level,
                justification: justification.trim(),
              })
            }
          />
        </form>
      </div>
    </CardPanel>
  )
}

export function LevelSection() {
  const me = getMe()
  const canManage = me !== null && (me.accessLevel === 5 || me.securityOfficer)

  const list = useQuery({
    queryKey: ['level-requests'],
    queryFn: listLevelRequests,
    retry: false,
    enabled: canManage,
  })

  if (!me) return null

  return (
    <section className='grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]'>
      {canManage && (
        <CardPanel title='Daftar permintaan' className='min-w-0'>
          {list.isError ? (
            <div className='p-3.5'>
              <Alert variant='destructive'>
                <AlertDescription>{errMsg(list.error)}</AlertDescription>
              </Alert>
            </div>
          ) : list.data ? (
            list.data.length === 0 ? (
              <p className='p-3.5 text-[12.5px] text-ink-3'>
                Belum ada permintaan.
              </p>
            ) : (
              <ul className='flex flex-col gap-3 p-3.5'>
                {list.data.map((r) => (
                  <RequestItem key={r.id} r={r} me={me} />
                ))}
              </ul>
            )
          ) : (
            <p className='p-3.5 text-[12.5px] text-ink-3'>Memuat...</p>
          )}
        </CardPanel>
      )}

      {me.can.access?.request && (
        <aside className='flex min-w-0 flex-col gap-3'>
          <CreateForm me={me} />
        </aside>
      )}
    </section>
  )
}
