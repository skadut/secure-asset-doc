import {
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { documents, type Tlp } from '@/data/grc'
import {
  Check,
  FileSpreadsheet,
  FileText,
  Info,
  LoaderCircle,
  Lock,
  Upload,
} from 'lucide-react'
import { refreshGrc } from '@/lib/grc-refresh'
import { getMe } from '@/lib/session'
import { cn } from '@/lib/utils'
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
import { Textarea } from '@/components/ui/textarea'
import { CardPanel } from '@/components/card-panel'
import { ConfigDrawer } from '@/components/config-drawer'
import { EmptyState } from '@/components/empty-state'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { PageHead } from '@/components/page-head'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { TlpBadge } from '@/components/tlp-badge'
import { TlpMark } from '@/components/tlp-mark'
import { DOC_TYPES, TLP_LEVELS } from '../helpers'
import { formatBytes } from '../uploads/uploads-helpers'
import { createDocument, encodeFile, type CreatedDoc } from './upload-api'
import {
  DOC_MAX_LABEL,
  DOC_PDF_MIME,
  DOC_XLSX_MIME,
  STATUS_LABEL,
  UPLOAD_STEPS,
  addMonths,
  clampStep,
  createErrorMessage,
  docFileError,
  docMimeLabel,
  formatAuditTime,
  previewDocId,
  resolveDocMime,
  reviewDayLabel,
  stepForError,
  todayIso,
  uniqueValues,
  validateStep,
  type DocStatus,
  type UploadMeta,
  type UploadStep,
} from './upload-helpers'

const PRIMARY =
  'h-11 w-full justify-between rounded-none border-[.67px] border-ink bg-ink px-3.5 text-[13.5px] font-semibold text-bg hover:bg-ink'
const SECONDARY =
  'h-11 w-full justify-center rounded-none border-[.67px] border-line bg-surface px-3.5 text-[13.5px] font-semibold text-ink hover:bg-surface-2'
const FIELD =
  'h-[38px] w-full rounded-none border-[.67px] border-line bg-surface px-2.5 text-[13px] text-ink shadow-none placeholder:text-ink-3 focus-visible:border-ink'

const TLP_TOP: Record<Tlp, string> = {
  CLEAR: 'border-t-tlp-clear',
  GREEN: 'border-t-tlp-green',
  AMBER: 'border-t-tlp-amber',
  'AMBER+STRICT': 'border-t-tlp-amber-strict',
  RED: 'border-t-tlp-red',
  'RED+STRICT': 'border-t-tlp-red-strict',
}

const CYCLE_OPTIONS = [3, 6, 12]

function emptyMeta(): UploadMeta {
  return {
    title: '',
    type: '',
    owner: '',
    approver: '',
    version: '1.0',
    tlp: 'AMBER',
    status: 'in review',
    nextReview: addMonths(todayIso(), 6),
    summary: '',
  }
}

export function DocumentUploadWizard({ step }: { step: UploadStep }) {
  const navigate = useNavigate()
  const me = getMe()
  const canCreate = me?.can.document?.c === true
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [meta, setMeta] = useState<UploadMeta>(emptyMeta)
  const [cycle, setCycle] = useState('6')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<CreatedDoc | null>(null)
  const [dragging, setDragging] = useState(false)

  const owners = uniqueValues(documents, 'owner')
  const approvers = uniqueValues(documents, 'approver')
  const previewId = previewDocId(documents.map((doc) => doc.id))
  const today = todayIso()
  const accessLabel = me
    ? `Level L${me.accessLevel}${me.unit ? ` · ${me.unit}` : ''}`
    : 'Level akun Anda'
  const current = UPLOAD_STEPS[step - 1]

  function go(next: UploadStep) {
    setError(null)
    void navigate({ to: '/documents/upload', search: { step: next } })
  }

  function patch<K extends keyof UploadMeta>(key: K, value: UploadMeta[K]) {
    setMeta((currentMeta) => ({ ...currentMeta, [key]: value }))
  }

  function pick(next: File) {
    const message = docFileError(next)
    if (message) {
      setFile(null)
      setError(message)
      return
    }
    setFile(next)
    setError(null)
  }

  async function submit() {
    if (!file || pending) return
    const mime = resolveDocMime(file)
    if (mime === null) {
      setFile(null)
      go(1)
      setError('Hanya PDF atau XLSX yang diterima.')
      return
    }
    setPending(true)
    setError(null)
    let data: string
    try {
      data = await encodeFile(file)
    } catch {
      setPending(false)
      setError('Berkas gagal dibaca. Coba pilih ulang.')
      return
    }
    const outcome = await createDocument({
      ...meta,
      title: meta.title.trim(),
      owner: meta.owner.trim(),
      approver: meta.approver.trim(),
      summary: meta.summary.trim(),
      file: { name: file.name, mime, data },
    })
    setPending(false)
    if (!outcome.ok) {
      const failing = stepForError(outcome.status, outcome.error)
      setError(createErrorMessage(outcome.status, outcome.error))
      go(failing)
      return
    }
    setResult(outcome.doc)
    setFile(null)
    go(6)
    await refreshGrc()
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || step === 6) return
    if (step === 5) {
      void submit()
      return
    }
    const message = validateStep(step, meta, file !== null)
    if (message) {
      setError(message)
      return
    }
    go(clampStep(step + 1))
  }

  function reset() {
    setFile(null)
    setMeta(emptyMeta())
    setCycle('6')
    setResult(null)
    setError(null)
    go(1)
  }

  if (!canCreate) {
    return (
      <PageShell>
        <EmptyState
          title='Tidak diizinkan mengunggah'
          desc='Akun ini tidak memiliki izin membuat dokumen di registri.'
          icon={<Lock />}
          action={
            <Button asChild variant='outline' className={SECONDARY}>
              <Link to='/documents'>Kembali ke registri</Link>
            </Button>
          }
        />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className='mx-auto w-full max-w-[760px]'>
        <CardPanel
          title={`${String(step).padStart(2, '0')} ${current.label}`}
          actions={
            <span className='border border-line bg-surface px-2 py-1 font-mono text-[8.5px] tracking-[.08em] text-ink-3 uppercase'>
              {current.column}
            </span>
          }
        >
          <form onSubmit={onSubmit} className='flex flex-col gap-6 p-4 sm:p-6'>
            <StepRail step={step} onGo={go} />

            {step === 1 && (
              <StepOne
                file={file}
                dragging={dragging}
                inputRef={inputRef}
                onDragging={setDragging}
                onPick={pick}
              />
            )}

            {step === 2 && (
              <StepTwo
                meta={meta}
                previewId={previewId}
                owners={owners}
                approvers={approvers}
                onPatch={patch}
              />
            )}

            {step === 3 && (
              <StepThree
                tlp={meta.tlp}
                accessLabel={accessLabel}
                onTlp={(tlp) => patch('tlp', tlp)}
              />
            )}

            {step === 4 && (
              <StepFour
                meta={meta}
                cycle={cycle}
                today={today}
                onPatch={patch}
                onCycle={(months) => {
                  setCycle(String(months))
                  patch('nextReview', addMonths(todayIso(), months))
                }}
              />
            )}

            {step === 5 && (
              <StepFive
                meta={meta}
                file={file}
                previewId={previewId}
                accessLabel={accessLabel}
                today={today}
              />
            )}

            {step === 6 && result && <StepSix result={result} />}

            {step === 6 && !result && (
              <EmptyState
                title='Belum ada unggahan'
                desc='Selesaikan enam tahap untuk mengunggah dokumen ke registri.'
                icon={<Upload />}
              />
            )}

            {error && (
              <p
                role='alert'
                aria-live='polite'
                className='border border-fail/50 bg-surface-2 px-3 py-2 text-[12.5px] leading-4 text-fail'
              >
                {error}
              </p>
            )}

            <StepActions
              step={step}
              pending={pending}
              hasResult={result !== null}
              onBack={() => go(clampStep(step - 1))}
              onReset={reset}
            />
          </form>
        </CardPanel>
      </div>
    </PageShell>
  )
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='focus-strong flex min-w-0 flex-1 flex-col gap-5'>
        <PageHead
          eyebrow='Akses dokumen · Registri dokumen · Unggah · 6 tahap'
          title='Registri dokumen — Unggah'
          note={
            <span className='font-mono text-[10.5px] tracking-[.08em] text-ink-3 uppercase'>
              PDF · XLSX · DISEGEL SAAT UNGGAH
            </span>
          }
        />
        {children}
      </Main>
    </>
  )
}

function StepRail({
  step,
  onGo,
}: {
  step: UploadStep
  onGo: (step: UploadStep) => void
}) {
  return (
    <ol aria-label='Tahap unggah' className='grid grid-cols-6 gap-2'>
      {UPLOAD_STEPS.map(({ n, label }) => {
        const done = n < step
        const active = n === step
        return (
          <li
            key={n}
            aria-current={active ? 'step' : undefined}
            className='min-w-0'
          >
            <button
              type='button'
              disabled={!done}
              onClick={() => done && onGo(n)}
              className='group flex w-full flex-col gap-1.5 text-left disabled:cursor-default'
            >
              <span
                aria-hidden='true'
                className={cn(
                  'h-[3px] w-full',
                  done || active ? 'bg-ink' : 'bg-line'
                )}
              />
              <span
                className={cn(
                  'truncate font-mono text-[8.5px] tracking-[.07em] uppercase',
                  active ? 'text-ink' : 'text-ink-3',
                  done && 'group-hover:text-ink'
                )}
              >
                {String(n).padStart(2, '0')} {label}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function StepHeading({ title, desc }: { title: string; desc: string }) {
  return (
    <header className='flex flex-col gap-1.5'>
      <h2 className='font-heading text-[22px] leading-tight font-semibold text-ink'>
        {title}
      </h2>
      <p className='max-w-[62ch] text-[12.5px] leading-5 text-ink-3'>{desc}</p>
    </header>
  )
}

function Field({
  label,
  required = false,
  hint,
  htmlFor,
  children,
}: {
  label: string
  required?: boolean
  hint?: ReactNode
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      <Label
        htmlFor={htmlFor}
        className='gap-1 font-mono text-[8.5px] font-medium tracking-[.09em] text-ink-3 uppercase'
      >
        {label}
        {required && (
          <span aria-hidden='true' className='text-fail'>
            *
          </span>
        )}
      </Label>
      {children}
      {hint && (
        <p className='font-mono text-[9.5px] leading-4 text-ink-3'>{hint}</p>
      )}
    </div>
  )
}

function ReadOnlyBox({ children }: { children: ReactNode }) {
  return (
    <div className='flex h-[38px] items-center justify-between gap-2 border-[.67px] border-line bg-surface-2 px-2.5 text-[12.5px] text-ink-2'>
      <span className='min-w-0 truncate'>{children}</span>
      <Lock aria-hidden='true' className='size-3.5 shrink-0 text-ink-3' />
    </div>
  )
}

function StepOne({
  file,
  dragging,
  inputRef,
  onDragging,
  onPick,
}: {
  file: File | null
  dragging: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onDragging: (dragging: boolean) => void
  onPick: (file: File) => void
}) {
  const mime = file ? resolveDocMime(file) : null
  return (
    <div className='flex flex-col gap-4'>
      <StepHeading
        title='Pilih berkas'
        desc='Seret berkas ke area di bawah atau pilih dari perangkat. Hanya PDF dan XLSX yang diterima hingga 10 MB.'
      />
      <input
        ref={inputRef}
        id='doc-file'
        type='file'
        accept={`${DOC_PDF_MIME},${DOC_XLSX_MIME},.pdf,.xlsx`}
        className='sr-only'
        onChange={(event) => {
          const next = event.target.files?.[0]
          event.target.value = ''
          if (next) onPick(next)
        }}
      />
      <button
        type='button'
        aria-describedby='doc-file-hint'
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          onDragging(true)
        }}
        onDragLeave={() => onDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          onDragging(false)
          const next = event.dataTransfer.files[0]
          if (next) onPick(next)
        }}
        className={cn(
          'flex min-h-[190px] flex-col items-center justify-center gap-2 border border-dashed px-4 py-8 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]',
          dragging
            ? 'border-ink bg-surface-active'
            : 'border-line-2 bg-surface-2 hover:bg-surface-active'
        )}
      >
        <Upload aria-hidden='true' className='size-5 text-ink-3' />
        <span className='text-[14px] font-semibold text-ink'>
          Seret PDF atau XLSX ke sini
        </span>
        <span
          id='doc-file-hint'
          className='font-mono text-[9.5px] tracking-[.06em] text-ink-3 uppercase'
        >
          atau klik untuk memilih · maks. {DOC_MAX_LABEL}
        </span>
      </button>

      {file && mime && (
        <div className='flex items-center gap-3 border border-line bg-surface px-3 py-2.5'>
          <span className='flex size-8 shrink-0 items-center justify-center border border-line text-ink-2'>
            {mime === DOC_XLSX_MIME ? (
              <FileSpreadsheet aria-hidden='true' className='size-4' />
            ) : (
              <FileText aria-hidden='true' className='size-4' />
            )}
          </span>
          <div className='min-w-0 flex-1'>
            <p className='truncate text-[13px] font-semibold text-ink'>
              {file.name}
            </p>
            <p className='font-mono text-[10.5px] text-ink-3'>
              {docMimeLabel(mime)} · {formatBytes(file.size)}
            </p>
          </div>
          <span className='inline-flex shrink-0 items-center gap-1 border border-line bg-surface-2 px-2 py-1 font-mono text-[8.5px] tracking-[.06em] text-ink-2 uppercase'>
            <Check aria-hidden='true' className='size-3 text-pass' />
            Format &amp; ukuran diperiksa
          </span>
        </div>
      )}

      <p className='text-[11px] leading-4 text-ink-3'>
        Server memeriksa isi berkas (magic bytes) saat diunggah. Tidak ada
        pemindaian malware.
      </p>
    </div>
  )
}

function StepTwo({
  meta,
  previewId,
  owners,
  approvers,
  onPatch,
}: {
  meta: UploadMeta
  previewId: string
  owners: string[]
  approvers: string[]
  onPatch: <K extends keyof UploadMeta>(key: K, value: UploadMeta[K]) => void
}) {
  return (
    <div className='flex flex-col gap-4'>
      <StepHeading
        title='Identitas dokumen'
        desc='ID dibuat sistem. Judul tampil di kolom DOKUMEN pada registri.'
      />

      <Field label='ID'>
        <ReadOnlyBox>
          <span className='font-mono'>{previewId} · dibuat otomatis</span>
        </ReadOnlyBox>
      </Field>

      <Field label='Judul dokumen' required htmlFor='doc-title'>
        <Input
          id='doc-title'
          value={meta.title}
          maxLength={200}
          aria-required='true'
          onChange={(event) => onPatch('title', event.target.value)}
          className={FIELD}
        />
      </Field>

      <Field label='Jenis' required>
        <Select
          value={meta.type}
          onValueChange={(value) => onPatch('type', value)}
        >
          <SelectTrigger
            aria-label='Jenis dokumen'
            className={cn(FIELD, 'justify-between [&_svg]:size-3')}
          >
            <SelectValue placeholder='Pilih jenis' />
          </SelectTrigger>
          <SelectContent className='rounded-none border-line'>
            {DOC_TYPES.map((type) => (
              <SelectItem key={type} value={type} className='rounded-none'>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className='grid gap-4 sm:grid-cols-2'>
        <PeopleField
          label='Pemilik'
          id='doc-owner'
          value={meta.owner}
          options={owners}
          placeholder='Pilih pemilik'
          onChange={(value) => onPatch('owner', value)}
        />
        <PeopleField
          label='Penyetuju'
          id='doc-approver'
          value={meta.approver}
          options={approvers}
          placeholder='Pilih penyetuju'
          onChange={(value) => onPatch('approver', value)}
        />
      </div>

      <Field
        label='Versi'
        htmlFor='doc-version'
        hint='Versi awal. Unggahan berikutnya menambah versi, bukan dokumen baru.'
      >
        <Input
          id='doc-version'
          value={meta.version}
          onChange={(event) => onPatch('version', event.target.value)}
          className={cn(FIELD, 'font-mono')}
        />
      </Field>
    </div>
  )
}

function PeopleField({
  label,
  id,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string
  id: string
  value: string
  options: string[]
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <Field label={label} required htmlFor={id}>
      {options.length > 0 ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger
            id={id}
            aria-label={label}
            className={cn(FIELD, 'justify-between [&_svg]:size-3')}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent className='rounded-none border-line'>
            {options.map((option) => (
              <SelectItem key={option} value={option} className='rounded-none'>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          value={value}
          aria-required='true'
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={FIELD}
        />
      )}
    </Field>
  )
}

function StepThree({
  tlp,
  accessLabel,
  onTlp,
}: {
  tlp: Tlp
  accessLabel: string
  onTlp: (tlp: Tlp) => void
}) {
  return (
    <div className='flex flex-col gap-4'>
      <StepHeading
        title='Klasifikasi & akses'
        desc='TLP menentukan siapa yang dapat melihat dokumen. Hak baca ditentukan per dokumen, bukan pangkat.'
      />

      <Field label='TLP' required>
        <div
          role='radiogroup'
          aria-label='TLP'
          className='grid grid-cols-2 gap-[1px] border border-line bg-line sm:grid-cols-3 lg:grid-cols-6'
        >
          {TLP_LEVELS.map((level) => {
            const active = level === tlp
            return (
              <button
                key={level}
                type='button'
                role='radio'
                aria-checked={active}
                onClick={() => onTlp(level)}
                className={cn(
                  'flex min-h-[52px] flex-col justify-center gap-1 border-t-[3px] px-2.5 py-2 text-left focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus)]',
                  TLP_TOP[level],
                  active
                    ? 'bg-surface-active outline outline-1 -outline-offset-1 outline-ink'
                    : 'bg-surface hover:bg-surface-active'
                )}
              >
                <TlpMark tlp={level} compact />
                <span className='font-mono text-[9.5px] tracking-[.04em] text-ink-2'>
                  {level}
                </span>
                {level === 'RED+STRICT' && (
                  <span className='font-mono text-[8px] tracking-[.05em] text-ink-3 uppercase'>
                    Lewat grant
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </Field>
      <p className='font-mono text-[9px] tracking-[.04em] text-ink-3 uppercase'>
        RED/RED+STRICT hanya lewat grant bernama.
      </p>

      <Field
        label='Akses minimum'
        hint='Ditetapkan server dari level akun Anda.'
      >
        <ReadOnlyBox>{accessLabel}</ReadOnlyBox>
      </Field>

      <Field label='Grant bernama'>
        <ReadOnlyBox>
          {tlp === 'RED+STRICT'
            ? 'Wajib grant bernama sebelum dokumen tampil.'
            : `Tidak diperlukan untuk ${tlp}`}
        </ReadOnlyBox>
      </Field>

      <div className='flex gap-2 border border-line bg-surface-2 px-3 py-2 text-[12px] leading-5 text-ink-2'>
        <Info aria-hidden='true' className='mt-1 size-3.5 shrink-0 text-warn' />
        <p>
          Klasifikasi RED ke atas memicu otorisasi ganda sebelum dokumen tampil
          di registri.
        </p>
      </div>
    </div>
  )
}

function StepFour({
  meta,
  cycle,
  today,
  onPatch,
  onCycle,
}: {
  meta: UploadMeta
  cycle: string
  today: string
  onPatch: <K extends keyof UploadMeta>(key: K, value: UploadMeta[K]) => void
  onCycle: (months: number) => void
}) {
  return (
    <div className='flex flex-col gap-4'>
      <StepHeading
        title='Status & tinjauan'
        desc='Tanggal tinjauan menentukan penanda “lewat” atau “hari lagi” di registri.'
      />

      <Field label='Status awal' required>
        <div
          role='radiogroup'
          aria-label='Status awal'
          className='grid grid-cols-2 gap-[1px] border border-line bg-line'
        >
          {(['draft', 'in review'] as DocStatus[]).map((status) => {
            const active = meta.status === status
            return (
              <button
                key={status}
                type='button'
                role='radio'
                aria-checked={active}
                onClick={() => onPatch('status', status)}
                className={cn(
                  'flex min-h-[44px] items-center gap-2 px-3 text-left focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus)]',
                  active
                    ? 'bg-surface-active outline outline-1 -outline-offset-1 outline-ink'
                    : 'bg-surface hover:bg-surface-active'
                )}
              >
                <i
                  aria-hidden='true'
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    status === 'draft' ? 'bg-ink-3' : 'bg-warn'
                  )}
                />
                <span className='text-[13px] font-semibold text-ink'>
                  {STATUS_LABEL[status]}
                </span>
              </button>
            )
          })}
        </div>
      </Field>
      <p className='text-[11.5px] leading-4 text-ink-3'>
        Approved hanya dapat ditetapkan oleh penyetuju setelah tinjauan.
      </p>

      <div className='grid gap-4 sm:grid-cols-2'>
        <Field
          label='Tinjauan berikutnya'
          required
          htmlFor='doc-next-review'
          hint={reviewDayLabel(meta.nextReview, today)}
        >
          <Input
            id='doc-next-review'
            type='date'
            value={meta.nextReview}
            aria-required='true'
            onChange={(event) => onPatch('nextReview', event.target.value)}
            className={cn(FIELD, 'font-mono')}
          />
        </Field>
        <Field label='Siklus' hint='Hanya mengisi tanggal tinjauan.'>
          <Select
            value={cycle}
            onValueChange={(value) => onCycle(Number(value))}
          >
            <SelectTrigger
              aria-label='Siklus tinjauan'
              className={cn(FIELD, 'justify-between [&_svg]:size-3')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className='rounded-none border-line'>
              {CYCLE_OPTIONS.map((months) => (
                <SelectItem
                  key={months}
                  value={String(months)}
                  className='rounded-none'
                >
                  {months} bulan
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field
        label='Catatan perubahan'
        required
        htmlFor='doc-summary'
        hint={`${meta.summary.length}/500`}
      >
        <Textarea
          id='doc-summary'
          value={meta.summary}
          maxLength={500}
          rows={3}
          aria-required='true'
          onChange={(event) => onPatch('summary', event.target.value)}
          className='min-h-[92px] rounded-none border-[.67px] border-line bg-surface px-2.5 py-2 text-[13px] shadow-none focus-visible:border-ink'
        />
      </Field>
    </div>
  )
}

function StepFive({
  meta,
  file,
  previewId,
  accessLabel,
  today,
}: {
  meta: UploadMeta
  file: File | null
  previewId: string
  accessLabel: string
  today: string
}) {
  const mime = file ? resolveDocMime(file) : null
  return (
    <div className='flex flex-col gap-4'>
      <StepHeading
        title='Tinjau & kirim'
        desc='Periksa metadata sebelum diunggah. Berkas akan disegel dan dicatat di audit log.'
      />

      <dl className='border-t border-line'>
        <ReviewRow label='ID'>
          <span className='font-mono'>{previewId}</span>
        </ReviewRow>
        <ReviewRow label='Dokumen'>{meta.title}</ReviewRow>
        <ReviewRow label='Jenis'>{meta.type || '—'}</ReviewRow>
        <ReviewRow label='TLP'>
          <TlpBadge tlp={meta.tlp} />
        </ReviewRow>
        <ReviewRow label='Status'>{STATUS_LABEL[meta.status]}</ReviewRow>
        <ReviewRow label='Versi'>
          <span className='font-mono'>{meta.version}</span>
        </ReviewRow>
        <ReviewRow label='Tinjauan'>
          {meta.nextReview} · {reviewDayLabel(meta.nextReview, today)}
        </ReviewRow>
        <ReviewRow label='Akses'>{accessLabel}</ReviewRow>
        <ReviewRow label='Pemilik'>{meta.owner || '—'}</ReviewRow>
        <ReviewRow label='Penyetuju'>{meta.approver || '—'}</ReviewRow>
        <ReviewRow label='Berkas'>
          {file
            ? `${file.name} · ${docMimeLabel(mime ?? '')} · ${formatBytes(file.size)}`
            : '—'}
        </ReviewRow>
      </dl>

      <div className='flex gap-2 border border-line bg-surface-2 px-3 py-2 text-[11.5px] leading-4 text-ink-3'>
        <Info aria-hidden='true' className='size-3.5 shrink-0' />
        <p>
          Pengunggahan dicatat di audit log. Metadata dapat diubah setelah
          unggah; berkas versi ini tidak.
        </p>
      </div>
    </div>
  )
}

function StepSix({ result }: { result: CreatedDoc }) {
  return (
    <div className='flex flex-col gap-4'>
      <StepHeading
        title='Dokumen terunggah'
        desc={`${result.id} masuk registri dengan status ${STATUS_LABEL[result.status]} dan menunggu persetujuan ${result.approver}.`}
      />

      <div className='overflow-x-auto border border-line'>
        <div className='min-w-[520px]'>
          <div className='grid grid-cols-[90px_minmax(0,1fr)_90px_80px_48px] gap-2 border-b border-line bg-surface-2 px-3 py-1.5 font-mono text-[8.5px] tracking-[.09em] text-ink-3 uppercase'>
            <span>ID</span>
            <span>Dokumen</span>
            <span>TLP</span>
            <span>Status</span>
            <span>Versi</span>
          </div>
          <div className='grid grid-cols-[90px_minmax(0,1fr)_90px_80px_48px] items-center gap-2 border-b border-line px-3 py-2.5 text-[12.5px] text-ink'>
            <span className='font-mono text-[11.5px]'>{result.id}</span>
            <span className='min-w-0 truncate'>{result.title}</span>
            <TlpBadge tlp={result.tlp} />
            <span>{STATUS_LABEL[result.status]}</span>
            <span className='font-mono text-[11.5px]'>{result.version}</span>
          </div>
          <dl className='px-3'>
            <ReviewRow label='Audit'>
              doc.upload · {formatAuditTime(result.at)}
            </ReviewRow>
            <ReviewRow label='Oleh'>{result.uploadedBy}</ReviewRow>
            <ReviewRow label='Berikutnya'>
              Persetujuan {result.approver}
            </ReviewRow>
          </dl>
        </div>
      </div>
    </div>
  )
}

function ReviewRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className='grid grid-cols-[118px_minmax(0,1fr)] gap-3 border-b border-line py-2 last:border-b-0'>
      <dt className='font-mono text-[8.5px] leading-4 tracking-[.08em] text-ink-3 uppercase'>
        {label}
      </dt>
      <dd className='min-w-0 text-[12.5px] leading-5 break-words text-ink'>
        {children}
      </dd>
    </div>
  )
}

function StepActions({
  step,
  pending,
  hasResult,
  onBack,
  onReset,
}: {
  step: UploadStep
  pending: boolean
  hasResult: boolean
  onBack: () => void
  onReset: () => void
}) {
  const enter = (
    <span
      aria-hidden='true'
      className='font-mono text-[9px] tracking-[.1em] opacity-70'
    >
      ENTER
    </span>
  )

  if (step === 6) {
    return (
      <div className='flex flex-col gap-2'>
        <Button asChild className={PRIMARY}>
          <Link to='/documents'>
            <span>Lihat di registri</span>
            {enter}
          </Link>
        </Button>
        <Button
          type='button'
          variant='outline'
          className={SECONDARY}
          onClick={onReset}
        >
          {hasResult ? 'Unggah dokumen lain' : 'Mulai unggah'}
        </Button>
      </div>
    )
  }

  const primaryLabel = step === 5 ? 'Unggah dokumen' : 'Lanjutkan'

  return (
    <div className='flex flex-col gap-2'>
      <Button type='submit' disabled={pending} className={PRIMARY}>
        <span className='inline-flex items-center gap-2'>
          {pending && (
            <LoaderCircle
              aria-hidden='true'
              className='size-4 animate-spin motion-reduce:animate-none'
            />
          )}
          {pending ? 'Mengunggah…' : primaryLabel}
        </span>
        {enter}
      </Button>
      {step === 1 ? (
        <Button asChild variant='outline' className={SECONDARY}>
          <Link to='/documents'>Batal</Link>
        </Button>
      ) : (
        <Button
          type='button'
          variant='outline'
          className={SECONDARY}
          onClick={onBack}
        >
          {step === 5 ? 'Ubah metadata' : 'Kembali'}
        </Button>
      )}
    </div>
  )
}
