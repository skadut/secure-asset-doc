import { Link, useLocation } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
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

      <Main className='flex flex-1 flex-col gap-5'>
        <PageHead
          title='Pengaturan'
          eyebrow='PENGATURAN / PREFERENSI'
          note='Preferensi tampilan tersimpan di cookie browser'
        />

        <nav aria-label='Bagian pengaturan' className='flex min-w-0 overflow-x-auto border border-line bg-surface'>
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={active === tab.to ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center border-b-2 border-transparent px-3.5 font-mono text-[9px] uppercase tracking-[.08em] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
                active === tab.to
                  ? 'border-ink text-ink'
                  : 'text-ink-3 hover:bg-surface-2 hover:text-ink-2'
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

function Choice({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type='button'
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'min-h-11 border px-3 py-2 text-left text-[11px] leading-[1.4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
        pressed
          ? 'border-ink bg-ink text-surface'
          : 'border-line bg-surface text-ink-2 hover:bg-surface-2'
      )}
    >
      {children}
    </button>
  )
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme()
  const { variant, collapsible, setVariant, setCollapsible } = useLayout()
  const { dir, setDir } = useDirection()
  const { font, setFont } = useFont()
  const pendingRef = useRef<Partial<{ theme: string; font: string; dir: string; layout: { variant?: string; collapsible?: string } }>>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const savePreference = (key: 'theme' | 'font' | 'dir' | 'layoutVariant' | 'layoutCollapsible', value: string) => {
    if (key === 'layoutVariant' || key === 'layoutCollapsible') {
      pendingRef.current.layout = {
        variant: key === 'layoutVariant' ? value : variant,
        collapsible: key === 'layoutCollapsible' ? value : collapsible,
      }
    } else {
      pendingRef.current[key] = value
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const pending = pendingRef.current
      pendingRef.current = {}
      fetch('/api/me/preferences', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending),
      }).catch(() => {})
    }, 400)
  }

  const updateTheme = (value: 'light' | 'dark' | 'system') => { setTheme(value); savePreference('theme', value) }
  const updateVariant = (value: 'inset' | 'floating' | 'sidebar') => { setVariant(value); savePreference('layoutVariant', value) }
  const updateCollapsible = (value: 'offcanvas' | 'icon' | 'none') => { setCollapsible(value); savePreference('layoutCollapsible', value) }
  const updateDir = (value: 'ltr' | 'rtl') => { setDir(value); savePreference('dir', value) }
  const updateFont = (value: (typeof fonts)[number]) => { setFont(value); savePreference('font', value) }

  return (
    <div className='grid min-w-0 items-start gap-3 lg:grid-cols-2'>
      <CardPanel title='Tema'>
        <div className='grid gap-2 p-3.5 sm:grid-cols-3' role='group' aria-label='Pilih tema'>
          {([
            ['light', 'Terang'],
            ['dark', 'Gelap'],
            ['system', 'Sistem'],
          ] as const).map(([value, label]) => (
            <Choice key={value} pressed={theme === value} onClick={() => updateTheme(value)}>
              {label}
            </Choice>
          ))}
        </div>
      </CardPanel>

      <CardPanel title='Varian sidebar'>
        <div className='grid gap-2 p-3.5 sm:grid-cols-3' role='group' aria-label='Pilih varian sidebar'>
          {([
            ['inset', 'Inset'],
            ['floating', 'Floating'],
            ['sidebar', 'Sidebar'],
          ] as const).map(([value, label]) => (
            <Choice key={value} pressed={variant === value} onClick={() => updateVariant(value)}>
              {label}
            </Choice>
          ))}
        </div>
      </CardPanel>

      <CardPanel title='Mode lipat sidebar'>
        <div className='grid gap-2 p-3.5 sm:grid-cols-3' role='group' aria-label='Pilih mode lipat sidebar'>
          {([
            ['offcanvas', 'Offcanvas'],
            ['icon', 'Ikon'],
            ['none', 'Tidak ada'],
          ] as const).map(([value, label]) => (
            <Choice key={value} pressed={collapsible === value} onClick={() => updateCollapsible(value)}>
              {label}
            </Choice>
          ))}
        </div>
      </CardPanel>

      <CardPanel title='Arah teks'>
        <div className='grid gap-2 p-3.5 sm:grid-cols-2' role='group' aria-label='Pilih arah teks'>
          {([
            ['ltr', 'LTR · Kiri ke kanan'],
            ['rtl', 'RTL · Kanan ke kiri'],
          ] as const).map(([value, label]) => (
            <Choice key={value} pressed={dir === value} onClick={() => updateDir(value)}>
              {label}
            </Choice>
          ))}
        </div>
      </CardPanel>

      <CardPanel title='Huruf'>
        <div className='p-3.5'>
          <label className='block max-w-[280px]'>
            <span className='mb-1.5 block font-mono text-[9px] uppercase tracking-[.08em] text-ink-3'>
              Huruf antarmuka
            </span>
            <select
              value={font}
              onChange={(event) => updateFont(event.target.value as (typeof fonts)[number])}
              className='min-h-11 w-full border border-line bg-surface px-3 text-[11px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
            >
              {fonts.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>
      </CardPanel>

      <div className='lg:col-span-2'>
        <p className='flex flex-wrap items-center gap-2 border border-line bg-surface-2 px-3.5 py-2.5 text-[11px] leading-[1.5] text-ink-2'>
          Pilihan di atas disimpan ke cookie browser dan disinkronkan ke /api/me/preferences. Bila server menolak, cookie tetap berlaku.
        </p>
      </div>

      <div className='lg:col-span-2'>
        <CookiePanel />
      </div>
    </div>
  )
}

function CookiePanel() {
  return (
    <CardPanel title='Cookie preferensi' meta='Nilai dari documents.cookie'>
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
            <Row key={name} label={name}>
              <span className='block break-all font-mono text-[11px]'>{value ?? 'Tidak diset'}</span>
            </Row>
          )
        })}
      </dl>
    </CardPanel>
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
