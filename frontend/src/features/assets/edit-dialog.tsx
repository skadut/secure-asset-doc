import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  assets,
  type Asset,
  type Criticality,
  type PurdueLevel,
} from '@/data/grc'
import { refreshGrc } from '@/lib/grc-refresh'
import { getMe } from '@/lib/session'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Chip } from '@/components/chip'
import { criticalityLabel, statusLabel } from './columns'

const FIELDS = [
  'name',
  'type',
  'site',
  'purdueLevel',
  'criticality',
  'status',
  'lastReviewed',
  'owner',
] as const
type Field = (typeof FIELDS)[number]
type Values = Pick<Asset, Field>
const LABELS: Record<Field, string> = {
  name: 'Nama',
  type: 'Tipe',
  site: 'Site',
  purdueLevel: 'Purdue',
  criticality: 'Kritikalitas',
  status: 'Status',
  lastReviewed: 'Tinjauan',
  owner: 'Pemilik',
}
const FIELD_OPTIONS = {
  type: [
    'PLC',
    'RTU',
    'HMI',
    'SCADA server',
    'Historian',
    'Engineering workstation',
    'Firewall',
    'Switch',
    'Data diode',
  ],
  site: [
    'Camp Halvard Water Plant',
    'Fort Tamsin Reservoir',
    'Marlow Supply Depot Relay Site',
    'Camp Halvard Operations Center',
    'Fort Tamsin Signal Exchange',
    'Kestrel Naval Station Operations Center',
    'Ridgeline Air Base Substation',
  ],
  purdueLevel: ['L0', 'L1', 'L2', 'L3', 'L3.5', 'L4'],
} as const
const textClass =
  'rounded-none border-line bg-surface font-mono text-[12px] text-ink focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
const labelClass = 'font-mono text-[9px] tracking-[.08em] text-ink-3 uppercase'
const snapshot = (asset: Asset): Values =>
  Object.fromEntries(FIELDS.map((field) => [field, asset[field]])) as Values
const formatTime = () =>
  new Date().toLocaleTimeString('id-ID', { hour12: false })

function changedFields(before: Values, after: Values) {
  return FIELDS.filter((field) => before[field] !== after[field])
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <Label htmlFor={htmlFor} className={labelClass}>
      {children}
    </Label>
  )
}

export function EditAssetDialog({
  asset,
  open,
  onOpenChange,
  onSaved,
}: {
  asset: Asset
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}) {
  const original = useMemo(() => snapshot(asset), [asset])
  const [values, setValues] = useState<Values>(original)
  const [phase, setPhase] = useState<'edit' | 'review' | 'saved'>('edit')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return
    setValues(snapshot(asset))
    setPhase('edit')
    setReason('')
    setError('')
    setBusy(false)
  }, [asset, open])
  /* eslint-enable react-hooks/set-state-in-effect */
  const changes = changedFields(original, values)
  const owners = [
    ...new Set([...assets.map((item) => item.owner), asset.owner]),
  ].sort()

  const valid =
    values.name.trim().length > 0 &&
    values.name.length <= 120 &&
    changes.length > 0
  const update = <K extends Field>(field: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [field]: value }))
  const fieldHelper = (field: Field) =>
    original[field] !== values[field] ? (
      <span className='font-mono text-[9px] text-warn'>
        Diubah dari {String(original[field])}
      </span>
    ) : null
  const backToEdit = () => {
    setPhase('edit')
    setError('')
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!reason.trim()) {
      setError('Alasan perubahan wajib diisi.')
      return
    }
    setBusy(true)
    setError('')
    const body = Object.fromEntries(
      changes.map((field) => [field, values[field]])
    )
    try {
      const response = await fetch(
        `/api/assets/${encodeURIComponent(asset.id)}`,
        {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, reason: reason.trim() }),
        }
      )
      const result: unknown = await response.json().catch(() => null)
      if (
        response.status === 400 &&
        result &&
        typeof result === 'object' &&
        'error' in result &&
        result.error === 'no changes'
      ) {
        setError('Tidak ada perubahan untuk disimpan.')
        return
      }
      if (!response.ok)
        throw new Error(
          result &&
            typeof result === 'object' &&
            'error' in result &&
            typeof result.error === 'string'
            ? result.error
            : `Gagal menyimpan perubahan (HTTP ${response.status}).`
        )
      await refreshGrc()
      onSaved?.()
      setPhase('saved')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Gagal menyimpan perubahan.'
      )
    } finally {
      setBusy(false)
    }
  }

  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return
    if ((event.target as HTMLElement).tagName === 'TEXTAREA') return
    event.preventDefault()
    if (phase === 'edit' && valid) setPhase('review')
    else if (phase === 'review' && reason.trim() && !busy) void submit()
  }

  const changedPayloadFields = changes.map((field) => LABELS[field]).join(', ')
  const step = phase === 'edit' ? 2 : 3

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className='max-h-[92dvh] max-w-[calc(100%-2rem)] gap-0 overflow-y-auto rounded-none border-line bg-surface p-0 shadow-xl sm:max-w-[720px]'
        aria-describedby='edit-dialog-description'
      >
        <div className='flex items-center justify-between bg-ink px-5 py-3 text-surface'>
          <span className='font-mono text-[10px] tracking-[.1em]'>
            02 · EDIT
          </span>
          <Chip tone='warn'>{asset.id}</Chip>
        </div>
        <form
          onSubmit={submit}
          onKeyDown={onFormKeyDown}
          className='flex min-h-[420px] flex-col p-5 sm:p-6'
        >
          <div
            className='mb-6 grid grid-cols-3 gap-1'
            aria-label='Langkah edit aset'
          >
            {['01 DAFTAR', '02 EDIT', '03 TINJAU'].map((item, index) => (
              <div
                key={item}
                className={`border-t-2 pt-2 font-mono text-[9px] tracking-[.06em] ${index < step ? 'border-ink text-ink' : 'border-line text-ink-3'}`}
              >
                {item}
              </div>
            ))}
          </div>
          <div className='mb-5'>
            <DialogTitle className='text-xl font-semibold text-ink'>
              {phase === 'edit'
                ? 'Edit metadata'
                : phase === 'review'
                  ? 'Tinjau perubahan'
                  : 'Metadata diperbarui'}
            </DialogTitle>
            <DialogDescription
              id='edit-dialog-description'
              className='mt-2 text-[12px] leading-5 text-ink-2'
            >
              {phase === 'edit'
                ? 'Semua kolom daftar dapat diubah kecuali ID. Kolom yang berubah ditandai.'
                : phase === 'review'
                  ? 'Pastikan nilai metadata dan alasan perubahan sudah benar.'
                  : `Baris ${asset.id} di daftar aset langsung memakai nilai baru.`}
            </DialogDescription>
          </div>

          {phase === 'edit' && (
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='flex flex-col gap-1.5 sm:col-span-2'>
                <FieldLabel htmlFor='edit-asset-id'>ID</FieldLabel>
                <Input
                  id='edit-asset-id'
                  readOnly
                  value={asset.id}
                  className={`${textClass} bg-surface-2`}
                />
              </div>
              <div className='flex flex-col gap-1.5'>
                <FieldLabel htmlFor='edit-asset-name'>NAMA *</FieldLabel>
                <Input
                  id='edit-asset-name'
                  value={values.name}
                  maxLength={120}
                  required
                  onChange={(e) => update('name', e.target.value)}
                  className={textClass}
                  aria-invalid={!values.name.trim() || values.name.length > 120}
                />
                {fieldHelper('name')}
                {values.name.length > 120 && (
                  <span className='text-[11px] text-fail'>
                    Maksimal 120 karakter.
                  </span>
                )}
              </div>
              <div className='flex flex-col gap-1.5'>
                <FieldLabel htmlFor='edit-asset-type'>TIPE *</FieldLabel>
                <Select
                  value={values.type}
                  onValueChange={(v) => update('type', v as Asset['type'])}
                >
                  <SelectTrigger id='edit-asset-type' className={textClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className='rounded-none'>
                    {FIELD_OPTIONS.type.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldHelper('type')}
              </div>
              <div className='flex flex-col gap-1.5'>
                <FieldLabel htmlFor='edit-asset-site'>SITE *</FieldLabel>
                <Select
                  value={values.site}
                  onValueChange={(v) => update('site', v)}
                >
                  <SelectTrigger id='edit-asset-site' className={textClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className='rounded-none'>
                    {FIELD_OPTIONS.site.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldHelper('site')}
              </div>
              <div className='flex flex-col gap-1.5'>
                <FieldLabel htmlFor='edit-asset-purdue'>PURDUE *</FieldLabel>
                <Select
                  value={values.purdueLevel}
                  onValueChange={(v) => update('purdueLevel', v as PurdueLevel)}
                >
                  <SelectTrigger id='edit-asset-purdue' className={textClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className='rounded-none'>
                    {FIELD_OPTIONS.purdueLevel.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldHelper('purdueLevel')}
              </div>
              <div className='flex flex-col gap-1.5'>
                <span className={labelClass}>KRITIKALITAS *</span>
                <RadioGroup
                  value={values.criticality}
                  onValueChange={(v) => update('criticality', v as Criticality)}
                  className='flex h-10 items-center gap-4'
                >
                  {(['high', 'medium', 'low'] as const).map((v) => (
                    <Label
                      key={v}
                      className='flex cursor-pointer items-center gap-1.5 text-[12px] text-ink'
                    >
                      <RadioGroupItem value={v} id={`edit-criticality-${v}`} />
                      <i
                        aria-hidden='true'
                        className={`size-1.5 rounded-full ${v === 'high' ? 'bg-fail' : v === 'medium' ? 'bg-warn' : 'bg-ink-3'}`}
                      />
                      {v === 'high'
                        ? 'High'
                        : v === 'medium'
                          ? 'Medium'
                          : 'Low'}
                    </Label>
                  ))}
                </RadioGroup>
                {fieldHelper('criticality')}
              </div>
              <div className='flex flex-col gap-1.5'>
                <span className={labelClass}>STATUS *</span>
                <RadioGroup
                  value={values.status}
                  onValueChange={(v) => update('status', v as Asset['status'])}
                  className='flex h-10 items-center gap-3'
                >
                  {(['active', 'maintenance', 'retired'] as const).map((v) => (
                    <Label
                      key={v}
                      className='flex cursor-pointer items-center gap-1.5 text-[12px] text-ink'
                    >
                      <RadioGroupItem value={v} id={`edit-status-${v}`} />
                      {v === 'active'
                        ? 'Active'
                        : v === 'maintenance'
                          ? 'Maintenance'
                          : 'Retired'}
                    </Label>
                  ))}
                </RadioGroup>
                {fieldHelper('status')}
              </div>
              <div className='flex flex-col gap-1.5'>
                <FieldLabel htmlFor='edit-asset-reviewed'>
                  TINJAUAN TERAKHIR
                </FieldLabel>
                <Input
                  id='edit-asset-reviewed'
                  type='date'
                  value={values.lastReviewed}
                  onChange={(e) => update('lastReviewed', e.target.value)}
                  className={textClass}
                />
                {fieldHelper('lastReviewed')}
              </div>
              <div className='flex flex-col gap-1.5'>
                <FieldLabel htmlFor='edit-asset-owner'>PEMILIK *</FieldLabel>
                <Select
                  value={values.owner}
                  onValueChange={(v) => update('owner', v)}
                >
                  <SelectTrigger id='edit-asset-owner' className={textClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className='rounded-none'>
                    {(owners.length ? owners : ['Unit OT']).map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldHelper('owner')}
              </div>
            </div>
          )}

          {phase === 'review' && (
            <>
              <dl className='mb-5 border border-line text-[12px]'>
                {(['id', ...FIELDS] as const).map((key) => {
                  const field = key === 'id' ? null : key
                  const label = field ? LABELS[field].toUpperCase() : 'ID'
                  const previous = field ? original[field] : asset.id
                  const next = field ? values[field] : asset.id
                  const isChanged = field !== null && changes.includes(field)
                  return (
                    <div
                      key={key}
                      className={`grid grid-cols-[100px_minmax(0,1fr)] gap-3 border-b border-line px-3 py-2 last:border-b-0 ${isChanged ? 'bg-surface-2' : ''}`}
                    >
                      <dt className='font-mono text-[9px] tracking-[.06em] text-ink-3'>
                        {label}
                      </dt>
                      <dd className='min-w-0 break-words text-ink'>
                        {isChanged ? (
                          <>
                            <span className='text-ink-3 line-through'>
                              {field === 'criticality'
                                ? criticalityLabel[previous as Criticality]
                                : field === 'status'
                                  ? statusLabel[previous as Asset['status']]
                                  : String(previous)}
                            </span>
                            <span className='mx-2 text-ink-3'>→</span>
                            <strong className='font-semibold text-ink'>
                              {field === 'criticality'
                                ? criticalityLabel[values.criticality]
                                : field === 'status'
                                  ? statusLabel[values.status]
                                  : String(next)}
                            </strong>
                          </>
                        ) : field === 'criticality' ? (
                          criticalityLabel[values.criticality]
                        ) : field === 'status' ? (
                          statusLabel[values.status]
                        ) : (
                          String(next)
                        )}
                      </dd>
                    </div>
                  )
                })}
              </dl>
              <div className='flex flex-col gap-1.5'>
                <FieldLabel htmlFor='edit-asset-reason'>
                  ALASAN PERUBAHAN *
                </FieldLabel>
                <Textarea
                  id='edit-asset-reason'
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  aria-invalid={!reason.trim() && !!error}
                  className={`${textClass} min-h-20 resize-y`}
                />
                {!reason.trim() && (
                  <span className='text-[11px] text-warn'>
                    Isi alasan perubahan sebelum menyimpan.
                  </span>
                )}
              </div>
            </>
          )}

          {phase === 'saved' && (
            <>
              <dl className='mb-5 border border-line text-[12px]'>
                {[
                  ['AUDIT', `asset.update · ${formatTime()}`],
                  ['KOLOM', changedPayloadFields],
                  ['OLEH', getMe()?.name ?? '—'],
                  ['ALASAN', reason.trim()],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className='grid grid-cols-[100px_minmax(0,1fr)] gap-3 border-b border-line px-3 py-2 last:border-b-0'
                  >
                    <dt className='font-mono text-[9px] tracking-[.06em] text-ink-3'>
                      {label}
                    </dt>
                    <dd className='break-words text-ink'>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className='border-s-2 border-line-strong bg-surface-2 px-3 py-2 text-[11px] leading-5 text-ink-2'>
                Riwayat nilai lama tersimpan di audit log; perubahan dapat
                dicabut, tidak dapat dihapus dari sini.
              </p>
            </>
          )}

          {error && (
            <p
              role='alert'
              aria-live='assertive'
              className='mt-3 text-[12px] text-fail'
            >
              {error}
            </p>
          )}
          <div className='mt-auto flex flex-col gap-2 pt-6'>
            {phase === 'edit' && (
              <Button
                type='button'
                disabled={!valid}
                onClick={() => {
                  setError('')
                  setPhase('review')
                }}
                className='h-11 w-full justify-between rounded-none bg-ink px-3 text-left text-surface hover:bg-ink/90 disabled:opacity-50'
              >
                <span>Tinjau perubahan</span>
                <span className='font-mono text-[9px]'>ENTER</span>
              </Button>
            )}
            {phase === 'review' && (
              <>
                <Button
                  type='submit'
                  disabled={!reason.trim() || busy}
                  className='h-11 w-full justify-between rounded-none bg-ink px-3 text-left text-surface hover:bg-ink/90 disabled:opacity-50'
                >
                  <span>{busy ? 'Menyimpan…' : 'Simpan perubahan'}</span>
                  <span className='font-mono text-[9px]'>ENTER</span>
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  onClick={backToEdit}
                  className='h-11 w-full rounded-none border-line'
                >
                  Kembali ke edit
                </Button>
              </>
            )}
            {phase === 'saved' && (
              <Button
                type='button'
                onClick={() => onOpenChange(false)}
                className='h-11 w-full justify-between rounded-none bg-ink px-3 text-left text-surface hover:bg-ink/90'
              >
                <span>Kembali ke daftar</span>
                <span className='font-mono text-[9px]'>ENTER</span>
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
