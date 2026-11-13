import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { ConfigDrawer } from '@/components/config-drawer'
import { EmptyState } from '@/components/empty-state'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { PageHead } from '@/components/page-head'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { decisionFlow } from './data'

const flowNames = [
  'Policy Administration',
  'Policy Information',
  'Policy Decision',
  'Policy Enforcement',
]

type Control = {
  id: string
  family: string
  name: string
  implementation: string
  location: string
}

export function Controls() {
  const [family, setFamily] = useState('All')
  const [query, setQuery] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['controls'],
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/controls', { credentials: 'same-origin' })
      if (!res.ok) {
        if (res.status === 404) return { controls: [] as Control[] }
        throw new Error('Gagal memuat kontrol')
      }
      const json: unknown = await res.json()
      const raw =
        typeof json === 'object' && json !== null && 'controls' in json
          ? (json as { controls?: unknown }).controls
          : undefined
      if (!Array.isArray(raw)) return { controls: [] as Control[] }
      const controls = raw.filter((item): item is Control => {
        if (typeof item !== 'object' || item === null) return false
        const c = item as Record<string, unknown>
        return ['id', 'family', 'name', 'implementation', 'location'].every(
          (key) => typeof c[key] === 'string'
        )
      })
      return { controls }
    },
  })

  const allControls = data?.controls ?? []
  const normalizedQuery = query.trim().toLowerCase()
  const filteredControls = allControls.filter((control) => {
    const matchesFamily =
      family === 'All' ||
      control.family === family ||
      control.id.split('-')[0].toUpperCase() === family
    const matchesQuery =
      normalizedQuery === '' ||
      [control.id, control.name, control.implementation].some((value) =>
        value.toLowerCase().includes(normalizedQuery)
      )
    return matchesFamily && matchesQuery
  })
  const hasData = !isLoading && allControls.length > 0
  const families = [
    ...new Set(allControls.map((control) => control.family)),
  ].sort()
  const shownFamilies = [
    ...new Set(filteredControls.map((control) => control.family)),
  ].sort()

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-5'>
        <PageHead
          title='Kontrol NIST 800-53'
          eyebrow={
            hasData
              ? `SP 800-53 REV.5 · ${allControls.length} KONTROL DIPETAKAN · ${families.length} KELUARGA`
              : 'SP 800-53 REV.5'
          }
          note={
            <span className='tracking-[.08em] uppercase'>
              Pemetaan desain — bukan bukti kepatuhan
            </span>
          }
        />

        <section
          aria-label='Alur keputusan akses'
          className='border border-line bg-surface'
        >
          <ol className='grid gap-x-0 gap-y-3 px-4 py-3.5 sm:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)_44px_minmax(0,1fr)_44px_minmax(0,1fr)] 2xl:items-center'>
            {decisionFlow.map((step, index) => (
              <li key={step.label} className='contents'>
                <div className='flex min-w-0 flex-col gap-1'>
                  <div className='flex items-center gap-2'>
                    <span className='inline-flex h-[18px] items-center bg-ink px-1.5 font-mono text-[7.5px] tracking-[.06em] text-surface'>
                      {step.label.slice(3, 6)}
                    </span>
                    <strong className='text-[11px] leading-tight font-semibold text-ink'>
                      {flowNames[index]}
                    </strong>
                  </div>
                  <p className='font-mono text-[8px] leading-[1.6] text-ink-3'>
                    {step.detail}
                  </p>
                </div>
                {index < decisionFlow.length - 1 && (
                  <span
                    aria-hidden='true'
                    className='hidden items-center justify-center text-ink-3 2xl:flex'
                  >
                    <svg
                      viewBox='0 0 24 24'
                      className='size-4'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='1.6'
                    >
                      <path d='M5 12h14m-5-5 5 5-5 5' />
                    </svg>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>

        <div className='flex flex-wrap items-center gap-2'>
          <label className='flex h-8 w-full max-w-[280px] items-center gap-2 border border-line bg-surface px-2.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink'>
            <span className='sr-only'>Cari kontrol NIST</span>
            <svg
              aria-hidden='true'
              viewBox='0 0 24 24'
              className='size-3.5 shrink-0 text-ink-3'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.6'
            >
              <circle cx='10.8' cy='10.8' r='6.4' />
              <path d='m16 16 4.2 4.2' />
            </svg>
            <input
              type='search'
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Cari ID, nama, implementasi'
              className='min-w-0 flex-1 bg-transparent font-mono text-[9px] text-ink outline-none placeholder:text-ink-3'
            />
          </label>
          <div
            className='flex flex-wrap gap-1'
            role='group'
            aria-label='Saring keluarga kontrol'
          >
            {['All', ...families].map((option) => (
              <button
                key={option}
                type='button'
                aria-pressed={family === option}
                onClick={() => setFamily(option)}
                className={cn(
                  'inline-flex h-8 min-w-8 items-center justify-center border px-2.5 font-mono text-[8.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
                  family === option
                    ? 'border-ink bg-ink text-surface'
                    : 'border-line text-ink-2 hover:bg-surface-2'
                )}
              >
                {option === 'All'
                  ? allControls.length > 0
                    ? `Semua ${allControls.length}`
                    : 'Semua'
                  : option}
              </button>
            ))}
          </div>
          <span className='ms-auto font-mono text-[8px] tracking-[.06em] text-ink-3'>
            {hasData
              ? `${filteredControls.length} KONTROL TAMPIL`
              : 'DATASET SERVER BELUM TERSEDIA'}
          </span>
        </div>

        <section
          aria-label='Kontrol NIST 800-53'
          className='flex min-w-0 flex-1 flex-col border border-line bg-surface'
        >
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[720px] border-collapse text-left'>
              <caption className='sr-only'>
                Tabel kontrol NIST 800-53, nama kontrol, implementasi, dan
                lokasi
              </caption>
              <thead className='bg-surface-2 font-mono text-[7.5px] tracking-[.12em] text-ink-3 uppercase'>
                <tr>
                  <th scope='col' className='w-[84px] px-3 py-2 font-normal'>
                    ID
                  </th>
                  <th scope='col' className='w-[250px] px-3 py-2 font-normal'>
                    Nama kontrol
                  </th>
                  <th scope='col' className='px-3 py-2 font-normal'>
                    Implementasi di aplikasi
                  </th>
                  <th scope='col' className='w-[300px] px-3 py-2 font-normal'>
                    Lokasi
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td
                      colSpan={4}
                      className='border-t border-line px-3 py-5 font-mono text-[9px] text-ink-3'
                    >
                      Memuat kontrol…
                    </td>
                  </tr>
                )}
                {!isLoading && allControls.length === 0 && (
                  <tr>
                    <td colSpan={4} className='border-t border-line px-3 py-5'>
                      <EmptyState
                        title='Dataset kontrol NIST belum tersedia dari server'
                        desc='Pemetaan NIST belum disediakan oleh /api/controls. Tidak ada baris kontrol ditampilkan.'
                      />
                    </td>
                  </tr>
                )}
                {!isLoading &&
                  allControls.length > 0 &&
                  filteredControls.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className='border-t border-line px-3 py-5 text-[11px] text-ink-2'
                      >
                        Tidak ada kontrol yang cocok dengan filter.
                      </td>
                    </tr>
                  )}
                {!isLoading &&
                  filteredControls.map((control) => (
                    <tr
                      key={control.id}
                      className='border-t border-line align-top'
                    >
                      <th
                        scope='row'
                        className='px-3 py-2.5 text-left font-mono text-[9.5px] font-medium text-ink'
                      >
                        {control.id}
                      </th>
                      <td className='px-3 py-2.5 text-[11.5px] font-medium text-ink'>
                        {control.name}
                      </td>
                      <td className='px-3 py-2.5 text-[10.5px] leading-[1.5] text-ink-2'>
                        {control.implementation}
                      </td>
                      <td className='px-3 py-2.5 font-mono text-[8px] leading-[1.7] text-ink-3'>
                        {control.location}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <footer className='mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 font-mono text-[8.5px] text-ink-3'>
            <span>
              Menampilkan {filteredControls.length} dari {allControls.length}{' '}
              kontrol
              {shownFamilies.length > 0 &&
                ` · keluarga ${shownFamilies.join(', ')}`}
            </span>
            <span>Tidak ada status kepatuhan terstruktur di data</span>
          </footer>
        </section>
      </Main>
    </>
  )
}
