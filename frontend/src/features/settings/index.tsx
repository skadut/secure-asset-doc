import { Link, useLocation } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fonts } from '@/config/fonts'
import { getCookie } from '@/lib/cookies'
import { getMe } from '@/lib/session'
import { cn } from '@/lib/utils'
import { useDirection } from '@/context/direction-provider'
import { useFont } from '@/context/font-provider'
import { useLayout } from '@/context/layout-provider'
import { useTheme } from '@/context/theme-provider'
import { CardPanel } from '@/components/card-panel'
import { Chip } from '@/components/chip'
import { EmptyState } from '@/components/empty-state'
import { PageHead } from '@/components/page-head'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { NotificationsForm } from './notifications/notifications-form'
import { DisplayForm } from './display/display-form'

const tabs = [
  { to: '/settings', label: 'Profil' },
  { to: '/settings/account', label: 'Akun' },
  { to: '/settings/appearance', label: 'Tampilan' },
  { to: '/settings/notifications', label: 'Notifikasi' },
  { to: '/settings/display', label: 'Display' },
] as const

const COOKIE_NAMES = [
  'vite-ui-theme',
  'font',
  'dir',
  'layout_variant',
  'layout_collapsible',
  'sidebar_state',
] as const

const THEME_OPTIONS = [
  { value: 'light', label: 'Terang', preview: 'bg-white', bar: 'bg-ink' },
  { value: 'dark', label: 'Gelap', preview: 'bg-ink', bar: 'bg-white' },
  { value: 'system', label: 'Sistem', preview: 'bg-surface-2', bar: 'bg-ink' },
] as const

const VARIANT_OPTIONS = [
  { value: 'inset', label: 'Inset' },
  { value: 'floating', label: 'Floating' },
  { value: 'sidebar', label: 'Sidebar' },
] as const

const COLLAPSE_OPTIONS = [
  { value: 'offcanvas', label: 'Offcanvas' },
  { value: 'icon', label: 'Ikon' },
  { value: 'none', label: 'Tidak ada' },
] as const

const DIR_OPTIONS = [
  { value: 'ltr', label: 'Kiri ke kanan (LTR)' },
  { value: 'rtl', label: 'Kanan ke kiri (RTL)' },
] as const

const LABEL = 'font-mono text-[7.5px] uppercase tracking-[1px] text-ink-3'
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

function normalizePath(pathname: string) {
  if (pathname === '/') return pathname
  return pathname.replace(/\/+$/, '') || '/'
}

export function Settings() {
  const { pathname } = useLocation()
  const { setTheme } = useTheme()
  const { setVariant, setCollapsible } = useLayout()
  const { setDir } = useDirection()
  const { setFont } = useFont()
  const path = normalizePath(pathname)
  const active = tabs.find((tab) => tab.to === path)?.to ?? '/settings'
  const hydratedRef = useRef(false)

  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    fetch('/api/me/preferences', { method: 'GET', credentials: 'same-origin' })
      .then((response) => response.ok ? response.json() : null)
      .then((data: unknown) => {
        if (typeof data !== 'object' || data === null) return
        const prefs = data as Record<string, unknown>
        if (!getCookie('vite-ui-theme') && (prefs.theme === 'light' || prefs.theme === 'dark' || prefs.theme === 'system')) setTheme(prefs.theme)
        if (!getCookie('font') && typeof prefs.font === 'string' && fonts.some((font) => font === prefs.font)) setFont(prefs.font as (typeof fonts)[number])
        if (!getCookie('dir') && (prefs.dir === 'ltr' || prefs.dir === 'rtl')) setDir(prefs.dir)
        const layout = (typeof prefs.layout === 'object' && prefs.layout !== null) ? (prefs.layout as Record<string, unknown>) : undefined
        const layoutVariant = layout?.variant
        if (!getCookie('layout_variant') && (layoutVariant === 'inset' || layoutVariant === 'sidebar' || layoutVariant === 'floating')) setVariant(layoutVariant)
        const layoutCollapsible = layout?.collapsible
        if (!getCookie('layout_collapsible') && (layoutCollapsible === 'offcanvas' || layoutCollapsible === 'icon' || layoutCollapsible === 'none')) setCollapsible(layoutCollapsible)
      })
      .catch(() => {})
  }, [setDir, setFont, setTheme, setVariant, setCollapsible])

  return (
    <>
      <Header>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-3.5'>
        <PageHead
          title='Pengaturan'
          eyebrow='PREFERENSI · 5 HALAMAN · ROUTE TETAP'
          note='Disimpan di cookie browser dan dikirim ke /api/me/preferences'
        />

        <nav aria-label='Bagian pengaturan' className='flex min-w-0 overflow-x-auto border-b border-line'>
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={active === tab.to ? 'page' : undefined}
              className={cn(
                '-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3.5 text-[12.5px] no-underline transition-colors motion-reduce:transition-none',
                FOCUS,
                active === tab.to
                  ? 'border-ink font-semibold text-ink'
                  : 'border-transparent text-ink-3 hover:text-ink-2'
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {active === '/settings' && <ProfileTab />}
        {active === '/settings/account' && <AccountTab />}
        {active === '/settings/appearance' && <AppearanceTab />}
        {active === '/settings/notifications' && <NotificationsTab />}
        {active === '/settings/display' && <DisplayTab />}
      </Main>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='grid grid-cols-[minmax(96px,160px)_minmax(0,1fr)] gap-3 border-b border-line px-3.5 py-2.5 last:border-0'>
      <dt className='font-mono text-[9px] uppercase leading-[1.4] tracking-[.08em] text-ink-3'>
        {label}
      </dt>
      <dd className='min-w-0 text-[12px] leading-5 text-ink'>{children}</dd>
    </div>
  )
}

function PendingNote({ children }: { children: React.ReactNode }) {
  return (
    <p className='flex flex-wrap items-center gap-2 border border-line bg-surface-2 px-3.5 py-2.5 text-[11px] leading-[1.5] text-ink-2'>
      <Chip tone='warn'>PENDING</Chip>
      <span className='min-w-0'>{children}</span>
    </p>
  )
}

function ProfileTab() {
  const me = getMe()

  if (!me) {
    return (
      <EmptyState
        title='Data personel belum tersedia'
        desc='Sesi ini tidak memuat respons /api/me. Muat ulang halaman setelah login.'
      />
    )
  }

  const roles = [
    me.securityOfficer && 'Security Officer',
    me.superAdmin && 'Super Admin',
  ].filter(Boolean) as string[]

  return (
    <div className='grid min-w-0 items-start gap-3 lg:grid-cols-2'>
      <CardPanel title='Identitas personel' meta='/api/me'>
        <dl>
          <Row label='Nama'>{me.name}</Row>
          <Row label='Pangkat'>
            {me.rankName || me.rank}
            <span className='ms-2 font-mono text-[10px] text-ink-3'>{me.rank}</span>
          </Row>
          <Row label='Golongan'>{me.golongan}</Row>
          <Row label='Unit'>{me.unit ?? 'Belum ditetapkan'}</Row>
          <Row label='TLP maksimal'>
            <Chip tone='line'>{me.tlpMax}</Chip>
          </Row>
          <Row label='Tingkat akses'>Tingkat {me.accessLevel} dari 5</Row>
          <Row label='ID personel'>
            <span className='font-mono text-[11px]'>{me.id}</span>
          </Row>
        </dl>
      </CardPanel>

      <CardPanel title='Peran dan kewenangan' meta='Read-only'>
        <dl>
          <Row label='Peran'>
            <span className='flex flex-wrap gap-1.5'>
              {roles.length ? roles.map((role) => <Chip key={role} tone='line'>{role}</Chip>) : <Chip tone='line'>Personel</Chip>}
            </span>
          </Row>
          <Row label='Kepala unit'>{me.unitHead ? 'Ya' : 'Tidak'}</Row>
          <Row label='Label pemilik'>{me.ownerLabel ?? 'Tidak ada'}</Row>
          <Row label='Kelola akun'>{me.can.account.u ? 'Diizinkan' : 'Tidak diizinkan'}</Row>
          <Row label='Setujui dokumen'>{me.can.document.approve ? 'Diizinkan' : 'Tidak diizinkan'}</Row>
          <Row label='Purge audit'>{me.can.audit?.purge ? 'Diizinkan' : 'Tidak diizinkan'}</Row>
        </dl>
        <div className='border-t border-line p-3.5'>
          <PendingNote>
            Data profil dibaca dari sesi. Penyuntingan profil ke server belum tersedia.
          </PendingNote>
        </div>
      </CardPanel>
    </div>
  )
}

function AccountTab() {
  const me = getMe()

  return (
    <div className='grid min-w-0 items-start gap-3 lg:grid-cols-2'>
      <CardPanel title='Akun' meta='Read-only'>
        <dl>
          <Row label='Username'>
            <span className='font-mono text-[11px]'>{me?.username ?? 'Tidak tersedia'}</span>
          </Row>
          <Row label='ID akun'>
            <span className='font-mono text-[11px]'>{me?.id ?? 'Tidak tersedia'}</span>
          </Row>
          <Row label='Unit'>{me?.unit ?? 'Belum ditetapkan'}</Row>
          <Row label='Kepala unit'>{me?.unitHead ? 'Ya' : 'Tidak'}</Row>
          <Row label='Label pemilik'>{me?.ownerLabel ?? 'Tidak ada'}</Row>
        </dl>
      </CardPanel>

      <CardPanel title='Penyimpanan akun'>
        <div className='space-y-3 p-3.5'>
          <PendingNote>
            Formulir perubahan akun tidak mengirim data ke server. Penyimpanan akun di server belum tersedia.
          </PendingNote>
          <p className='text-[11px] leading-[1.5] text-ink-2'>
            Nilai di samping berasal dari sesi aktif dan hanya dapat dibaca.
          </p>
        </div>
      </CardPanel>
    </div>
  )
}

type Pending = Partial<{ theme: string; font: string; dir: string; layout: { variant: string; collapsible: string } }>

function Seg<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <fieldset className='flex min-w-0 flex-col gap-1.5'>
      <legend className={LABEL}>{legend}</legend>
      <div className='flex flex-wrap gap-px border border-line bg-line'>
        {options.map((option) => {
          const pressed = option.value === value
          return (
            <button
              key={option.value}
              type='button'
              aria-pressed={pressed}
              onClick={() => onChange(option.value)}
              className={cn(
                'h-[34px] min-w-0 flex-1 px-3 font-mono text-[9px] transition-colors motion-reduce:transition-none',
                FOCUS,
                pressed ? 'bg-ink text-surface' : 'bg-surface text-ink-2 hover:bg-surface-2'
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme()
  const { variant, collapsible, setVariant, setCollapsible } = useLayout()
  const { dir, setDir } = useDirection()
  const { font, setFont } = useFont()
  const pendingRef = useRef<Pending>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const serverOkRef = useRef(true)
  const [status, setStatus] = useState('')

  // Sends queued changes now. Returns whether the server accepted the last request.
  const send = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    const pending = pendingRef.current
    pendingRef.current = {}
    if (Object.keys(pending).length === 0) return serverOkRef.current
    try {
      const response = await fetch('/api/me/preferences', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending),
      })
      serverOkRef.current = response.ok
    } catch {
      serverOkRef.current = false
    }
    return serverOkRef.current
  }, [])

  // Pending changes still go out if the user leaves the tab before the debounce ends.
  useEffect(() => () => { void send() }, [send])

  const queue = (patch: Pending) => {
    pendingRef.current = { ...pendingRef.current, ...patch }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void send(), 400)
  }

  const updateTheme = (value: (typeof THEME_OPTIONS)[number]['value']) => {
    setTheme(value)
    queue({ theme: value })
  }
  const updateVariant = (value: (typeof VARIANT_OPTIONS)[number]['value']) => {
    setVariant(value)
    queue({ layout: { variant: value, collapsible } })
  }
  const updateCollapsible = (value: (typeof COLLAPSE_OPTIONS)[number]['value']) => {
    setCollapsible(value)
    queue({ layout: { variant, collapsible: value } })
  }
  const updateDir = (value: (typeof DIR_OPTIONS)[number]['value']) => {
    setDir(value)
    queue({ dir: value })
  }
  const updateFont = (value: (typeof fonts)[number]) => {
    setFont(value)
    queue({ font: value })
  }

  const reset = () => {
    setTheme('system')
    setFont(fonts[0])
    setDir('ltr')
    setVariant('inset')
    setCollapsible('icon')
    queue({ theme: 'system', font: fonts[0], dir: 'ltr', layout: { variant: 'inset', collapsible: 'icon' } })
    setStatus('Default diterapkan. Dikirim ke server setelah jeda singkat.')
  }

  const save = async () => {
    setStatus('Menyimpan...')
    const ok = await send()
    setStatus(ok
      ? 'Tersimpan. Cookie dan server sudah sinkron.'
      : 'Tersimpan di cookie browser. Server belum menerima preferensi, coba simpan lagi.')
  }

  return (
    <div className='grid min-w-0 items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_400px]'>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        className='flex min-w-0 flex-col gap-4 border border-line bg-surface px-5 py-[18px]'
      >
        <div className='flex flex-col gap-1'>
          <h2 className='text-[17px] font-semibold text-ink'>Tampilan</h2>
          <p className='text-[10.5px] leading-[1.5] text-ink-3'>
            Perubahan langsung berlaku di browser ini. Server menerima preferensi setelah jeda singkat.
          </p>
        </div>

        <label className='flex w-full flex-col gap-1.5'>
          <span className={LABEL}>Font antarmuka</span>
          <select
            value={font}
            onChange={(event) => updateFont(event.target.value as (typeof fonts)[number])}
            className={cn('h-[38px] w-full border border-line bg-surface px-2.5 text-[12px] text-ink', FOCUS)}
          >
            {fonts.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <fieldset className='flex min-w-0 flex-col gap-1.5'>
          <legend className={LABEL}>Tema</legend>
          <div className='grid gap-2.5 sm:grid-cols-3'>
            {THEME_OPTIONS.map((option) => {
              const pressed = theme === option.value
              return (
                <button
                  key={option.value}
                  type='button'
                  aria-pressed={pressed}
                  onClick={() => updateTheme(option.value)}
                  className={cn(
                    'flex flex-col gap-2 border p-2 text-left transition-colors motion-reduce:transition-none',
                    FOCUS,
                    pressed ? 'border-ink' : 'border-line hover:bg-surface-2'
                  )}
                >
                  <span className={cn('flex h-[46px] flex-col justify-center gap-1 border border-line p-2', option.preview)} aria-hidden>
                    <span className={cn('h-1 w-10', option.bar)} />
                    <span className={cn('h-1 w-[66px]', option.bar)} />
                  </span>
                  <span className='text-[11px] text-ink'>{option.label}</span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <Seg legend='Varian sidebar' options={VARIANT_OPTIONS} value={variant} onChange={updateVariant} />
        <Seg legend='Mode lipat sidebar' options={COLLAPSE_OPTIONS} value={collapsible} onChange={updateCollapsible} />
        <Seg legend='Arah teks' options={DIR_OPTIONS} value={dir} onChange={updateDir} />

        <div className='flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4'>
          <p role='status' aria-live='polite' className='min-w-0 text-[10.5px] text-ink-3'>{status}</p>
          <div className='flex gap-2'>
            <button
              type='button'
              onClick={reset}
              className={cn('h-9 border border-line px-3.5 text-[12px] text-ink-2 transition-colors hover:bg-surface-2 motion-reduce:transition-none', FOCUS)}
            >
              Reset ke default
            </button>
            <button
              type='submit'
              className={cn('h-9 bg-ink px-4 text-[12px] font-semibold text-surface transition-opacity hover:opacity-90 motion-reduce:transition-none', FOCUS)}
            >
              Simpan preferensi
            </button>
          </div>
        </div>
      </form>

      <div className='flex min-w-0 flex-col gap-3.5'>
        <CookiePanel />

        <section className='flex flex-col gap-2 border border-line bg-surface p-3.5'>
          <h3 className={LABEL}>Catatan</h3>
          <p className='text-[10.5px] leading-[1.5] text-ink-2'>
            Sakelar tema di header hanya dua keadaan (terang atau gelap). Opsi Sistem tersedia lewat kartu Tema di formulir ini.
          </p>
          <p className='text-[10.5px] leading-[1.5] text-ink-2'>
            Bila server menolak, cookie tetap berlaku di browser ini.
          </p>
        </section>

        <section className='flex flex-col bg-[#0f1411] text-[#d7ded6]' aria-label='Pratinjau permukaan gelap'>
          <div className='flex h-[29.5px] items-center justify-between gap-2 px-3'>
            <span className='font-mono text-[7px] uppercase tracking-[1px] text-[#98a49a]'>Pratinjau · mode gelap</span>
            <span className='min-w-0 truncate font-mono text-[7px] text-[#98a49a]'>{`vite-ui-theme=${getCookie('vite-ui-theme') ?? 'tidak diset'}`}</span>
          </div>
          <div className='flex flex-col gap-2 p-3.5'>
            <p className='text-[18px] font-semibold'>Permukaan gelap</p>
            <p className='text-[10px] leading-[1.5] text-[#98a49a]'>
              Latar memakai --ink dan teks memakai --rail-ink. Warna status tetap sama.
            </p>
            <div className='flex items-center gap-2 bg-[#1c241f] px-2.5 py-2'>
              <span className='size-1.5 bg-[#1e7b45]' aria-hidden />
              <span className='font-mono text-[8.5px] text-[#d7ded6]'>Status pass tetap hijau di kedua mode</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function CookiePanel() {
  return (
    <section className='border border-line bg-surface'>
      <div className='flex h-[31.5px] items-center justify-between gap-2 bg-surface-2 px-3'>
        <span className={LABEL}>Tersimpan di perangkat</span>
        <span className='font-mono text-[7px] text-ink-3'>COOKIE</span>
      </div>
      <dl>
        {COOKIE_NAMES.map((name) => {
          const raw = getCookie(name)
          let value = raw
          if (name === 'font' && raw) {
            try {
              value = decodeURIComponent(raw)
            } catch {
              value = raw
            }
          }
          return (
            <div key={name} className='flex h-[31.5px] items-center justify-between gap-3 border-t border-line px-3'>
              <dt className='font-mono text-[8.5px] text-ink-2'>{name}</dt>
              <dd className='min-w-0 truncate text-right font-mono text-[8.5px] text-ink' title={value ?? undefined}>{value ?? 'Tidak diset'}</dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

function NotificationsTab() {
  return (
    <div className='grid min-w-0 gap-3'>
      <PendingNote>
        Formulir notifikasi tidak mengirim data ke server. Penyimpanan preferensi notifikasi belum tersedia.
      </PendingNote>
      <CardPanel title='Notifikasi'>
        <div className='max-w-xl p-3.5'>
          <NotificationsForm />
        </div>
      </CardPanel>
    </div>
  )
}

function DisplayTab() {
  return (
    <div className='grid min-w-0 gap-3'>
      <PendingNote>
        Pilihan display tidak mengirim data ke server. Penyimpanan preferensi display belum tersedia.
      </PendingNote>
      <CardPanel title='Display'>
        <div className='max-w-xl p-3.5'>
          <DisplayForm />
        </div>
      </CardPanel>
    </div>
  )
}
