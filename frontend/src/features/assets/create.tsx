import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  TODAY,
  assets,
  type Asset,
  type Criticality,
  type PurdueLevel,
  type Sector,
} from '@/data/grc'
import { Lock, ScrollText, ShieldAlert } from 'lucide-react'
import { refreshGrc } from '@/lib/grc-refresh'
import { getMe, type Me } from '@/lib/session'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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
import { CardPanel } from '@/components/card-panel'
import { Chip } from '@/components/chip'
import { ConfigDrawer } from '@/components/config-drawer'
import { ErrorState } from '@/components/error-state'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { PageHead } from '@/components/page-head'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { StatusDot } from '@/components/status-dot'
import { ThemeSwitch } from '@/components/theme-switch'
import { criticalityLabel, isReviewOverdue, statusLabel } from './columns'
import { zoneFor } from './zone'

const ASSET_TYPES: Asset['type'][] = [
  'PLC',
  'RTU',
  'HMI',
  'SCADA server',
  'Historian',
  'Firewall',
  'Switch',
  'Data diode',
  'Engineering workstation',
]

const SITES = [
  'Camp Halvard Water Plant',
  'Fort Tamsin Reservoir',
  'Marlow Supply Depot Relay Site',
  'Camp Halvard Operations Center',
  'Fort Tamsin Signal Exchange',
  'Kestrel Naval Station Operations Center',
  'Ridgeline Air Base Substation',
] as const

// ponytail: fixed site→sector fallback; replace with a site registry when sites become editable.
const SITE_SECTOR: Record<string, Sector> = {
  'Camp Halvard Water Plant': 'Water',
  'Fort Tamsin Reservoir': 'Water',
  'Marlow Supply Depot Relay Site': 'Telecom',
  'Camp Halvard Operations Center': 'Energy',
  'Fort Tamsin Signal Exchange': 'Energy',
  'Kestrel Naval Station Operations Center': 'Telecom',
  'Ridgeline Air Base Substation': 'Telecom',
}

const PURDUE_LEVELS: PurdueLevel[] = ['L0', 'L1', 'L2', 'L3', 'L3.5', 'L4']

const CRITICALITY: {
  value: Criticality
  label: string
  dot: string
}[] = [
  { value: 'high', label: 'High', dot: 'bg-fail' },
  { value: 'medium', label: 'Medium', dot: 'bg-warn' },
  { value: 'low', label: 'Low', dot: 'bg-ink-3' },
]

const STATUSES: { value: Asset['status']; label: string; dot: string }[] = [
  { value: 'active', label: 'Active', dot: 'bg-pass' },
  { value: 'maintenance', label: 'Maintenance', dot: 'bg-warn' },
  { value: 'retired', label: 'Retired', dot: 'bg-ink-3' },
]

const IPV4 =
  /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

const STEP_LABELS = [
  'IDENTITAS',
  'LOKASI & ZONA',
  'RISIKO & SIKLUS',
  'TINJAU',
  'TERSIMPAN',
] as const

const STEP_CHIPS = [
  'KOLOM ID · NAMA · TIPE',
  'KOLOM SITE · PURDUE',
  'KOLOM KRITIKALITAS · STATUS · TINJAUAN',
  'SIAP DISIMPAN',
  'TERSIMPAN',
] as const

type Step = 1 | 2 | 3 | 4 | 5

type Form = {
  name: string
  type: Asset['type'] | ''
  site: string
  purdueLevel: PurdueLevel
  vendor: string
  model: string
  firmware: string
  ipAddress: string
  criticality: Criticality
  status: Asset['status']
  owner: string
  lastReviewed: string
}

type Field =
  | 'name'
  | 'type'
  | 'site'
  | 'vendor'
  | 'model'
  | 'firmware'
  | 'ipAddress'
  | 'owner'
  | 'lastReviewed'

const STEP_FIELDS: Record<1 | 2 | 3 | 4, Field[]> = {
  1: ['name', 'type', 'vendor', 'model', 'firmware', 'ipAddress'],
  2: ['site'],
  3: ['owner', 'lastReviewed'],
  4: [
    'name',
    'type',
    'vendor',
    'model',
    'firmware',
    'ipAddress',
    'site',
    'owner',
    'lastReviewed',
  ],
}

const fieldClass =
  'h-[38px] rounded-none border-line bg-surface font-mono text-[11px] text-ink shadow-none placeholder:text-ink-3 focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink aria-invalid:border-fail aria-invalid:ring-0 max-sm:h-11'

const selectClass = `${fieldClass} px-2.5 [&_svg]:size-3 [&_svg]:opacity-100`

const labelClass =
  'font-mono text-[9px] font-medium tracking-[.1em] text-ink-3 uppercase'

const RADIO_CARD =
  'flex h-9 w-full aspect-auto items-center justify-start gap-2 rounded-none border border-line bg-surface px-2.5 font-mono text-[10.5px] text-ink-3 shadow-none focus-visible:border-ink focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink data-[state=checked]:border-ink data-[state=checked]:text-ink [&_[data-slot=radio-group-indicator]]:hidden max-sm:h-11'

const initialForm = (owner: string): Form => ({
  name: '',
  type: '',
  site: '',
  purdueLevel: 'L1',
  vendor: '',
  model: '',
  firmware: '',
  ipAddress: '',
  criticality: 'high',
  status: 'active',
  owner,
  lastReviewed: TODAY,
})

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function auditTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function nextReviewDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`)
  if (!iso || Number.isNaN(d.getTime())) return '—'
  d.setUTCFullYear(d.getUTCFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

function FieldError({ id, children }: { id?: string; children?: string }) {
  if (!children) return null
  return (
    <p id={id} className='text-[10.5px] leading-4 text-fail'>
      {children}
    </p>
  )
}

function CreateForbidden() {
  return (
    <ErrorState
      tone='dark'
      code='403'
      headerLabel='HALAMAN · 403 (MODE GELAP)'
      headerValue='403'
      title='Fitur ini di luar peran Anda'
      desc='Gate server menolak permintaan ini. Hubungi perwira keamanan bila akses dibutuhkan.'
      action={
        <Button
          asChild
          variant='outline'
          size='sm'
          className='relative h-8 rounded-none border-rail-line bg-transparent px-3 text-[12px] font-normal text-rail-ink shadow-none hover:bg-rail-active hover:text-rail-ink'
        >
          <Link to='/'>Kembali</Link>
        </Button>
      }
    />
  )
}

export function CreateAsset() {
  const me = getMe()
  if (!me || me.can.asset.c !== true) {
    return (
      <>
        <Header fixed>
          <Search className='me-auto' />
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </Header>
        <Main className='flex flex-1 flex-col gap-4'>
          <CreateForbidden />
        </Main>
      </>
    )
  }
  return <CreateAssetWizard me={me} />
}

function CreateAssetWizard({ me }: { me: Me }) {
  const navigate = useNavigate()
  const owners = [
    ...new Set([...assets.map((asset) => asset.owner), 'Unit OT']),
  ].sort((a, b) => a.localeCompare(b, 'id'))
  const [step, setStep] = useState<Step>(1)
  const defaultOwner = owners.includes('Unit OT')
    ? 'Unit OT'
    : (owners[0] ?? 'Unit OT')
  const [form, setForm] = useState<Form>(() => initialForm(defaultOwner))
  const [attempted, setAttempted] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState<{
    id: string
    at: string
    before: number
    after: number
  } | null>(null)

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (key === 'name' || key === 'site') setConflict(null)
    setSubmitError(null)
  }

  const name = form.name.trim()
  const duplicate =
    name.length > 0 && form.site !== ''
      ? assets.find(
          (asset) =>
            asset.name.trim().toLowerCase() === name.toLowerCase() &&
            asset.site === form.site
        )
      : undefined
  const sector =
    assets.find((asset) => asset.site === form.site)?.sector ??
    SITE_SECTOR[form.site] ??
    'Water'
  const zone = form.type ? zoneFor(form.purdueLevel, form.type) : '—'
  const overdue = isReviewOverdue(form.lastReviewed)

  const errors: Partial<Record<Field, string>> = {}
  if (!name) errors.name = 'Nama wajib diisi.'
  else if (name.length > 120) errors.name = 'Nama maksimal 120 karakter.'
  else if (duplicate)
    errors.name = `Nama sudah dipakai ${duplicate.id} di ${duplicate.site}.`
  else if (conflict) errors.name = conflict
  if (!form.type) errors.type = 'Tipe wajib dipilih.'
  if (!form.vendor.trim()) errors.vendor = 'Vendor wajib diisi.'
  if (!form.model.trim()) errors.model = 'Model wajib diisi.'
  if (!form.firmware.trim()) errors.firmware = 'Firmware wajib diisi.'
  if (!IPV4.test(form.ipAddress.trim()))
    errors.ipAddress = 'Alamat IPv4 tidak valid.'
  if (!form.site) errors.site = 'Site wajib dipilih.'
  if (!form.owner) errors.owner = 'Pemilik wajib dipilih.'
  if (!form.lastReviewed) errors.lastReviewed = 'Tanggal tinjauan wajib diisi.'

  const stepValid = (s: Step) =>
    s === 5 || STEP_FIELDS[s].every((field) => !errors[field])

  const valid = stepValid(step)

  const visibleError = (field: Field) => {
    const message = errors[field]
    if (!message) return undefined
    if (attempted) return message
    const value = form[field]
    return typeof value === 'string' && value.trim() !== ''
      ? message
      : undefined
  }

  const advance = () => {
    if (pending || step === 5) return
    if (!stepValid(step)) {
      setAttempted(true)
      return
    }
    if (step === 4) void submit()
    else setStep((step + 1) as Step)
  }

  const submit = async () => {
    if (pending) return
    if (!stepValid(4)) {
      setAttempted(true)
      return
    }
    setPending(true)
    setSubmitError(null)
    const before = assets.length
    const payload = {
      name,
      type: form.type as Asset['type'],
      site: form.site,
      sector,
      purdueLevel: form.purdueLevel,
      vendor: form.vendor.trim(),
      model: form.model.trim(),
      firmware: form.firmware.trim(),
      ipAddress: form.ipAddress.trim(),
      criticality: form.criticality,
      status: form.status,
      owner: form.owner,
      lastReviewed: form.lastReviewed,
    }
    try {
      const res = await fetch('/api/assets', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body: unknown = await res.json().catch(() => null)
      const json =
        body && typeof body === 'object'
          ? (body as {
              id?: string
              zone?: string
              at?: string
              error?: string
            })
          : null
      if (res.status === 201 && json?.id) {
        await refreshGrc()
        setSaved({
          id: json.id,
          at: json.at ?? new Date().toISOString(),
          before,
          after: assets.length,
        })
        setStep(5)
        return
      }
      if (res.status === 409) {
        setConflict('Nama sudah dipakai di site ini. Pilih nama lain.')
        setStep(1)
        return
      }
      if (res.status === 403) {
        setSubmitError('Akses ditolak. Pembuatan aset butuh level L4.')
        return
      }
      if (res.status === 502 || res.status === 503) {
        setSubmitError('Modul kripto tidak merespons. Aset tidak disimpan.')
        return
      }
      if (res.status === 400 && json?.error?.startsWith('invalid ')) {
        const field = json.error.slice('invalid '.length)
        const stepFor: Record<string, Step> = {
          name: 1,
          type: 1,
          vendor: 1,
          model: 1,
          firmware: 1,
          ipAddress: 1,
          site: 2,
          purdueLevel: 2,
          criticality: 3,
          status: 3,
          owner: 3,
          lastReviewed: 3,
        }
        setStep(stepFor[field] ?? 1)
        setSubmitError(`Isian ${field} tidak valid.`)
        return
      }
      setSubmitError('Penyimpanan gagal. Aset tidak disimpan.')
    } catch {
      setSubmitError('Jaringan bermasalah. Aset tidak disimpan.')
    } finally {
      setPending(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      void navigate({ to: '/assets' })
      return
    }
    if (event.key !== 'Enter' || step === 5) return
    const target = event.target as HTMLElement
    const isInput = target.tagName === 'INPUT'
    const isSelectTrigger = target.getAttribute('role') === 'combobox'
    if (!isInput && !isSelectTrigger) return
    if (target.closest('[data-slot="select-content"],[role="listbox"]')) return
    event.preventDefault()
    advance()
  }

  const reset = () => {
    setForm(initialForm(defaultOwner))
    setSaved(null)
    setConflict(null)
    setSubmitError(null)
    setAttempted(false)
    setStep(1)
  }

  const secondaryLabel =
    step === 1 ? 'Batal' : step === 4 ? 'Ubah metadata' : 'Kembali'
  const primaryLabel =
    step === 1 || step === 2
      ? 'Lanjutkan'
      : step === 3
        ? 'Tinjau aset'
        : step === 4
          ? 'Simpan aset'
          : 'Lihat di daftar aset'

  const reviewRows: { label: string; value: ReactNode }[] = [
    { label: 'ID', value: saved?.id ?? 'AST-0025' },
    { label: 'NAMA', value: name },
    { label: 'TIPE', value: form.type },
    { label: 'SITE', value: form.site },
    { label: 'PURDUE', value: `${form.purdueLevel} · ${zone}` },
    {
      label: 'KRITIKALITAS',
      value: (
        <StatusDot
          tone={
            form.criticality === 'high'
              ? 'fail'
              : form.criticality === 'medium'
                ? 'warn'
                : 'ink'
          }
        >
          {criticalityLabel[form.criticality]}
        </StatusDot>
      ),
    },
    {
      label: 'STATUS',
      value: (
        <StatusDot
          tone={
            form.status === 'active'
              ? 'pass'
              : form.status === 'maintenance'
                ? 'warn'
                : 'ink'
          }
        >
          {statusLabel[form.status]}
        </StatusDot>
      ),
    },
    {
      label: 'TINJAUAN',
      value: `${form.lastReviewed} · ${overdue ? 'Terlambat' : 'Dalam 365 hari'}`,
    },
    { label: 'PEMILIK', value: form.owner },
  ]

  const stepBody = () => {
    if (step === 1) {
      return (
        <>
          <div>
            <h2 className='font-heading text-[18px] leading-tight font-semibold text-ink'>
              Identitas aset
            </h2>
            <p className='mt-1 text-[12px] leading-4 text-ink-3'>
              ID dibuat sistem berurutan. Nama harus unik per site.
            </p>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label className={labelClass} htmlFor='asset-id'>
              ID
            </Label>
            <div className='relative'>
              <Input
                id='asset-id'
                readOnly
                value='AST-0025 · dibuat otomatis'
                className='h-[38px] rounded-none border-line bg-surface-2 pr-10 font-mono text-[11px] text-ink-2 shadow-none focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink max-sm:h-11'
              />
              <Lock
                aria-hidden='true'
                className='pointer-events-none absolute top-1/2 right-3 size-3 -translate-y-1/2 text-ink-3'
              />
            </div>
            <p className='text-[10.5px] leading-4 text-ink-3'>
              Tampil di kolom NAMA pada daftar aset.
            </p>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label className={labelClass} htmlFor='asset-name'>
              NAMA *
            </Label>
            <Input
              id='asset-name'
              value={form.name}
              maxLength={120}
              onChange={(event) => set('name', event.target.value)}
              aria-invalid={visibleError('name') ? true : undefined}
              aria-describedby={
                visibleError('name') ? 'asset-name-error' : undefined
              }
              className={fieldClass}
            />
            <FieldError id='asset-name-error'>
              {visibleError('name')}
            </FieldError>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label className={labelClass} htmlFor='asset-type'>
              TIPE *
            </Label>
            <Select
              value={form.type || undefined}
              onValueChange={(value) => set('type', value as Asset['type'])}
            >
              <SelectTrigger
                id='asset-type'
                aria-invalid={visibleError('type') ? true : undefined}
                aria-describedby={
                  visibleError('type') ? 'asset-type-error' : undefined
                }
                className={cn(selectClass, 'w-full')}
              >
                <SelectValue placeholder='Pilih tipe' />
              </SelectTrigger>
              <SelectContent className='rounded-none'>
                {ASSET_TYPES.map((type) => (
                  <SelectItem
                    key={type}
                    value={type}
                    className='font-mono text-[11px]'
                  >
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id='asset-type-error'>
              {visibleError('type')}
            </FieldError>
            <p className='font-mono text-[9px] leading-4 text-ink-3'>
              {ASSET_TYPES.join(' · ')}
            </p>
          </div>
          <section className='flex flex-col gap-3 border-t border-line pt-3'>
            <h3 className={labelClass}>PERANGKAT &amp; JARINGAN</h3>
            <div className='grid gap-3 sm:grid-cols-2'>
              {(
                [
                  ['vendor', 'VENDOR *', 'asset-vendor'],
                  ['model', 'MODEL *', 'asset-model'],
                  ['firmware', 'FIRMWARE *', 'asset-firmware'],
                  ['ipAddress', 'IP ADDRESS *', 'asset-ip'],
                ] as const
              ).map(([field, label, id]) => (
                <div key={field} className='flex flex-col gap-1.5'>
                  <Label className={labelClass} htmlFor={id}>
                    {label}
                  </Label>
                  <Input
                    id={id}
                    value={form[field]}
                    onChange={(event) => set(field, event.target.value)}
                    inputMode={field === 'ipAddress' ? 'decimal' : undefined}
                    aria-invalid={visibleError(field) ? true : undefined}
                    aria-describedby={
                      visibleError(field) ? `${id}-error` : undefined
                    }
                    className={fieldClass}
                  />
                  <FieldError id={`${id}-error`}>
                    {visibleError(field)}
                  </FieldError>
                </div>
              ))}
            </div>
          </section>
        </>
      )
    }
    if (step === 2) {
      return (
        <>
          <div>
            <h2 className='font-heading text-[18px] leading-tight font-semibold text-ink'>
              Lokasi &amp; zona
            </h2>
            <p className='mt-1 text-[12px] leading-4 text-ink-3'>
              Level Purdue menentukan zona IEC 62443 dan conduit yang berlaku.
            </p>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label className={labelClass} htmlFor='asset-site'>
              SITE *
            </Label>
            <Select
              value={form.site || undefined}
              onValueChange={(value) => set('site', value)}
            >
              <SelectTrigger
                id='asset-site'
                aria-invalid={visibleError('site') ? true : undefined}
                aria-describedby={
                  visibleError('site') ? 'asset-site-error' : undefined
                }
                className={cn(selectClass, 'w-full')}
              >
                <SelectValue placeholder='Pilih site' />
              </SelectTrigger>
              <SelectContent className='rounded-none'>
                {SITES.map((site) => (
                  <SelectItem
                    key={site}
                    value={site}
                    className='font-mono text-[11px]'
                  >
                    {site}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id='asset-site-error'>
              {visibleError('site')}
            </FieldError>
          </div>
          <div className='flex flex-col gap-1.5'>
            <span className={labelClass}>PURDUE *</span>
            <div
              role='group'
              aria-label='Level Purdue'
              className='grid grid-cols-6 border border-line'
            >
              {PURDUE_LEVELS.map((level) => (
                <button
                  key={level}
                  type='button'
                  aria-pressed={form.purdueLevel === level}
                  onClick={() => set('purdueLevel', level)}
                  className={cn(
                    'h-[34px] border-r border-line font-mono text-[10.5px] last:border-r-0 max-sm:h-11',
                    form.purdueLevel === level
                      ? 'border-ink bg-surface-2 font-medium text-ink shadow-[inset_0_0_0_1px_var(--ink)]'
                      : 'bg-surface text-ink-3 hover:bg-surface-2'
                  )}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label className={labelClass} htmlFor='asset-zone'>
              ZONA IEC 62443
            </Label>
            <div className='relative'>
              <Input
                id='asset-zone'
                readOnly
                value={zone}
                className='h-[38px] rounded-none border-line bg-surface-2 pr-10 font-mono text-[11px] text-ink-2 shadow-none focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink max-sm:h-11'
              />
              <Lock
                aria-hidden='true'
                className='pointer-events-none absolute top-1/2 right-3 size-3 -translate-y-1/2 text-ink-3'
              />
            </div>
            <p className='text-[10.5px] leading-4 text-ink-3'>
              Diturunkan dari level Purdue.
            </p>
          </div>
        </>
      )
    }
    if (step === 3) {
      return (
        <>
          <div>
            <h2 className='font-heading text-[18px] leading-tight font-semibold text-ink'>
              Risiko &amp; siklus
            </h2>
          </div>
          <div className='flex flex-col gap-1.5'>
            <span className={labelClass}>KRITIKALITAS *</span>
            <RadioGroup
              value={form.criticality}
              onValueChange={(value) =>
                set('criticality', value as Criticality)
              }
              className='grid grid-cols-3 gap-2'
            >
              {CRITICALITY.map((item) => (
                <RadioGroupItem
                  key={item.value}
                  value={item.value}
                  className={RADIO_CARD}
                >
                  <i
                    aria-hidden='true'
                    className={cn('size-1.5 rounded-full', item.dot)}
                  />
                  {item.label}
                </RadioGroupItem>
              ))}
            </RadioGroup>
          </div>
          <div className='flex flex-col gap-1.5'>
            <span className={labelClass}>STATUS *</span>
            <RadioGroup
              value={form.status}
              onValueChange={(value) => set('status', value as Asset['status'])}
              className='grid grid-cols-3 gap-2'
            >
              {STATUSES.map((item) => (
                <RadioGroupItem
                  key={item.value}
                  value={item.value}
                  className={RADIO_CARD}
                >
                  <i
                    aria-hidden='true'
                    className={cn('size-1.5 rounded-full', item.dot)}
                  />
                  {item.label}
                </RadioGroupItem>
              ))}
            </RadioGroup>
          </div>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='flex flex-col gap-1.5'>
              <Label className={labelClass} htmlFor='asset-reviewed'>
                TINJAUAN TERAKHIR *
              </Label>
              <Input
                id='asset-reviewed'
                type='date'
                value={form.lastReviewed}
                onChange={(event) => set('lastReviewed', event.target.value)}
                aria-invalid={visibleError('lastReviewed') ? true : undefined}
                aria-describedby={
                  visibleError('lastReviewed')
                    ? 'asset-reviewed-error'
                    : undefined
                }
                className={fieldClass}
              />
              <FieldError id='asset-reviewed-error'>
                {visibleError('lastReviewed')}
              </FieldError>
              <p className='text-[10.5px] leading-4 text-ink-3'>
                Berikutnya: {nextReviewDate(form.lastReviewed)} (365 hari)
              </p>
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label className={labelClass} htmlFor='asset-owner'>
                PEMILIK *
              </Label>
              <Select
                value={form.owner}
                onValueChange={(value) => set('owner', value)}
              >
                <SelectTrigger
                  id='asset-owner'
                  aria-invalid={visibleError('owner') ? true : undefined}
                  className={cn(selectClass, 'w-full')}
                >
                  <SelectValue placeholder='Pilih pemilik' />
                </SelectTrigger>
                <SelectContent className='rounded-none'>
                  {owners.map((owner) => (
                    <SelectItem
                      key={owner}
                      value={owner}
                      className='font-mono text-[11px]'
                    >
                      {owner}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError>{visibleError('owner')}</FieldError>
            </div>
          </div>
          <div className='flex items-start gap-2 border border-line bg-surface-2 px-3 py-2'>
            <ShieldAlert
              aria-hidden='true'
              className='mt-0.5 size-3.5 shrink-0 text-warn'
            />
            <p className='text-[11.5px] leading-4 text-ink-2'>
              Kritikalitas High mewajibkan tinjauan ≤ 365 hari; lewat dari itu
              ditandai &quot;Terlambat&quot;.
            </p>
          </div>
        </>
      )
    }
    return (
      <>
        <div>
          <h2 className='font-heading text-[18px] leading-tight font-semibold text-ink'>
            Tinjau &amp; simpan
          </h2>
        </div>
        <dl className='border border-line text-[12px]'>
          {reviewRows.map((row) => (
            <div
              key={row.label}
              className='grid grid-cols-[150px_minmax(0,1fr)] border-b border-line last:border-b-0'
            >
              <dt className='bg-surface-2 px-3 py-1.5 font-mono text-[8.5px] tracking-[.08em] text-ink-3 uppercase'>
                {row.label}
              </dt>
              <dd className='min-w-0 px-3 py-1.5 break-words text-ink'>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
        <div className='flex items-start gap-2 border border-line bg-surface-2 px-3 py-2'>
          <ScrollText
            aria-hidden='true'
            className='mt-0.5 size-3.5 shrink-0 text-ink-3'
          />
          <p className='text-[11.5px] leading-4 text-ink-3'>
            Pembuatan aset dicatat di audit log (asset.create) beserta nama
            pengguna dan waktu.
          </p>
        </div>
      </>
    )
  }

  const successBody = saved && (
    <>
      <div>
        <h2 className='font-heading text-[24px] leading-tight font-semibold text-ink'>
          Aset ditambahkan
        </h2>
        <p className='mt-1 text-[12px] leading-4 text-ink-3'>
          {saved.id} muncul di daftar aset. TOTAL ASET {saved.before} →{' '}
          {saved.after}.
        </p>
      </div>
      <div className='overflow-x-auto border border-line'>
        <div className='min-w-[640px]'>
          <div className='grid grid-cols-[90px_minmax(0,1fr)_130px_190px_70px_90px] border-b border-line bg-surface-2 px-3 py-1.5 font-mono text-[8.5px] tracking-[.08em] text-ink-3 uppercase'>
            <span>ID</span>
            <span>NAMA</span>
            <span>TIPE</span>
            <span>SITE</span>
            <span>PURDUE</span>
            <span>STATUS</span>
          </div>
          <div className='grid grid-cols-[90px_minmax(0,1fr)_130px_190px_70px_90px] px-3 py-2 text-[12px] text-ink'>
            <span className='font-mono text-[11px]'>{saved.id}</span>
            <span className='truncate'>{name}</span>
            <span>{form.type}</span>
            <span className='truncate'>{form.site}</span>
            <span className='font-mono text-[11px]'>{form.purdueLevel}</span>
            <span>{statusLabel[form.status]}</span>
          </div>
        </div>
      </div>
      <dl className='grid grid-cols-[80px_minmax(0,1fr)] gap-y-2 border-t border-line pt-3'>
        <dt className='font-mono text-[8.5px] tracking-[.1em] text-ink-3 uppercase'>
          AUDIT
        </dt>
        <dd className='font-mono text-[10.5px] text-ink-2'>
          asset.create · {auditTime(saved.at)}
        </dd>
        <dt className='font-mono text-[8.5px] tracking-[.1em] text-ink-3 uppercase'>
          OLEH
        </dt>
        <dd className='font-mono text-[10.5px] text-ink-2'>{me.name}</dd>
      </dl>
    </>
  )

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4'>
        <PageHead
          title='Aset — Tambah aset'
          eyebrow='INVENTARIS / ASET / TAMBAH ASET · 4 TAHAP · METADATA SESUAI KOLOM DAFTAR ASET'
          note='DARI TOMBOL "Tambah aset" DI 09 ASET · BUTUH LEVEL L4'
        />

        <div className='mx-auto w-full max-w-[820px]'>
          <CardPanel
            className='flex flex-1 flex-col'
            title={`0${step} · ${STEP_LABELS[step - 1]}`}
            actions={
              <Chip tone={step === 5 ? 'pass' : 'line'}>
                {STEP_CHIPS[step - 1]}
              </Chip>
            }
          >
            {step < 5 && (
              <div className='border-b border-line px-4 pt-3 pb-2'>
                <div className='grid grid-cols-4 gap-3'>
                  {STEP_LABELS.slice(0, 4).map((label, index) => {
                    const n = index + 1
                    const done = n <= step
                    return (
                      <div key={label} className='flex flex-col gap-1.5'>
                        <span
                          aria-hidden='true'
                          className={cn(
                            'h-[3px] w-full',
                            done ? 'bg-ink' : 'bg-line'
                          )}
                        />
                        <span className='font-mono text-[9px] tracking-[.08em] text-ink-3 uppercase'>
                          {pad(n)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div
              className='flex flex-1 flex-col gap-4 p-4'
              onKeyDown={onKeyDown}
            >
              {step === 5 ? successBody : stepBody()}

              <div className='mt-auto flex flex-col gap-2 pt-4'>
                {step < 5 && !valid && (
                  <p
                    role='status'
                    className='text-[10.5px] leading-4 text-fail'
                  >
                    Tombol lanjut nonaktif sampai semua kolom wajib valid.
                  </p>
                )}
                {submitError && (
                  <p role='alert' className='text-[10.5px] leading-4 text-fail'>
                    {submitError}
                  </p>
                )}
                <Button
                  type='button'
                  disabled={step < 5 && (!valid || pending)}
                  onClick={
                    step === 5
                      ? () => void navigate({ to: '/assets' })
                      : advance
                  }
                  className='flex h-10 w-full items-center justify-between rounded-none border border-ink bg-ink px-3 text-[13px] font-semibold text-surface shadow-none hover:bg-ink-2 disabled:opacity-50'
                >
                  <span>{pending ? 'Menyimpan…' : primaryLabel}</span>
                  <span className='font-mono text-[9px] tracking-[.1em] opacity-70'>
                    ENTER
                  </span>
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  disabled={pending}
                  onClick={
                    step === 5
                      ? reset
                      : step === 1
                        ? () => void navigate({ to: '/assets' })
                        : () => setStep((step - 1) as Step)
                  }
                  className='h-10 w-full rounded-none border-line bg-surface text-[13px] font-normal text-ink shadow-none hover:bg-surface-2'
                >
                  {step === 5 ? 'Tambah aset lain' : secondaryLabel}
                </Button>
              </div>
            </div>
          </CardPanel>
        </div>
      </Main>
    </>
  )
}
