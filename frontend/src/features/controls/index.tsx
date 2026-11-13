import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
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
import { decisionFlow } from './data'

const families = ['AC', 'AU', 'IA', 'MP', 'PS', 'RA', 'SC', 'SI']
const flowNames = ['Policy Administration', 'Policy Information', 'Policy Decision', 'Policy Enforcement']

export function Controls() {
  const [family, setFamily] = useState('All')
  const [query, setQuery] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['controls'],
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/controls', { credentials: 'same-origin' })
      if (!res.ok) {
        if (res.status === 404) return { controls: [] }
        throw new Error('Gagal memuat kontrol')
      }
      const json: unknown = await res.json()
      const raw = typeof json === 'object' && json !== null && 'controls' in json ? (json as { controls?: unknown }).controls : undefined
      if (!Array.isArray(raw)) return { controls: [] }
      const controls = raw.filter((item): item is { id: string; family: string; name: string; implementation: string; location: string } => {
        if (typeof item !== 'object' || item === null) return false
        const c = item as Record<string, unknown>
        return ['id', 'family', 'name', 'implementation', 'location'].every((key) => typeof c[key] === 'string')
      })
      return { controls }
    }
  })

  const allControls = data?.controls ?? []
  const normalizedQuery = query.trim().toLowerCase()
  const filteredControls = allControls.filter((control) => {
    const matchesFamily = family === 'All' || control.family === family || control.id.split('-')[0].toUpperCase() === family
    const matchesQuery = normalizedQuery === '' || [control.id, control.name, control.implementation].some((value) => value.toLowerCase().includes(normalizedQuery))
    return matchesFamily && matchesQuery
  })

  return <>
    <Header fixed><Search className='me-auto' /><ThemeSwitch /><ConfigDrawer /><ProfileDropdown /></Header>
    <Main className='flex flex-1 flex-col gap-5'>
      <PageHead title='Kontrol NIST 800-53' eyebrow='SP 800-53 Rev. 5 · 8 keluarga' note='Pemetaan desain, bukan bukti kepatuhan' />

      <CardPanel title='Alur keputusan akses'>
        <ol className='grid gap-3 p-3 sm:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)_32px_minmax(0,1fr)_32px_minmax(0,1fr)]'>
          {decisionFlow.map((step, index) => <li key={step.label} className='contents'>
            <div className='min-w-0 border border-line bg-surface px-3 py-2'>
              <div className='flex items-center gap-2'><Chip tone='line'>{step.label.slice(3, 6)}</Chip><strong className='text-[11px] leading-tight text-ink'>{flowNames[index]}</strong></div>
              <p className='mt-2 text-[10px] leading-[1.45] text-ink-2'>{step.detail}</p>
            </div>
            {index < decisionFlow.length - 1 && <span aria-hidden='true' className='hidden items-center justify-center font-mono text-ink-3 2xl:flex'>›</span>}
          </li>)}
        </ol>
      </CardPanel>

      <div className='flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between'>
        <label className='flex min-h-11 w-full max-w-[360px] items-center gap-2 border border-line bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink'>
          <span className='sr-only'>Cari kontrol NIST</span>
          <svg aria-hidden='true' viewBox='0 0 24 24' className='size-4 shrink-0' fill='none' stroke='currentColor' strokeWidth='1.6'><circle cx='10.8' cy='10.8' r='6.4' /><path d='m16 16 4.2 4.2' /></svg>
          <input type='search' value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Cari ID, nama, implementasi' className='min-w-0 flex-1 bg-transparent text-[11px] text-ink outline-none placeholder:text-ink-3' />
        </label>
        <div className='flex flex-wrap gap-1' role='group' aria-label='Saring keluarga kontrol'>
          {['All', ...families].map((option) => <button key={option} type='button' aria-pressed={family === option} onClick={() => setFamily(option)} className={cn('inline-flex min-h-11 min-w-11 items-center justify-center border px-3 font-mono text-[9px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink', family === option ? 'border-ink bg-ink text-surface' : 'border-line text-ink-2 hover:bg-surface-2')}>
            {option === 'All' ? 'Semua' : option}
          </button>)}
        </div>
      </div>

      <CardPanel title='Kontrol NIST 800-53' meta={isLoading ? 'Dataset server belum tersedia' : allControls.length > 0 ? `${filteredControls.length} dari ${allControls.length} kontrol · /api/controls` : 'Dataset server belum tersedia'} className='min-w-0'>
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[680px] border-collapse text-left'>
            <caption className='sr-only'>Tabel kontrol NIST 800-53, nama kontrol, implementasi, dan lokasi</caption>
            <thead className='bg-surface-2 font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'><tr>
              <th scope='col' className='w-[100px] px-3 py-2 font-medium'>ID</th>
              <th scope='col' className='w-[240px] px-3 py-2 font-medium'>Nama kontrol</th>
              <th scope='col' className='px-3 py-2 font-medium'>Implementasi</th>
              <th scope='col' className='w-[260px] px-3 py-2 font-medium'>Lokasi</th>
            </tr></thead>
            <tbody>
              {isLoading && <tr><td colSpan={4} className='border-t border-line px-3 py-5'>Memuat kontrol…</td></tr>}
              {!isLoading && allControls.length === 0 && <tr><td colSpan={4} className='border-t border-line px-3 py-5'>
                <EmptyState title='Dataset kontrol NIST belum tersedia dari server' desc='Pemetaan NIST belum disediakan oleh /api/controls. Tidak ada baris kontrol ditampilkan.' />
              </td></tr>}
              {!isLoading && allControls.length > 0 && filteredControls.length === 0 && <tr><td colSpan={4} className='border-t border-line px-3 py-5'>Tidak ada kontrol yang cocok dengan filter.</td></tr>}
              {!isLoading && filteredControls.map((control) => <tr key={control.id} className='border-t border-line'>
                <td className='px-3 py-2'>{control.id}</td>
                <td className='px-3 py-2'>{control.name}</td>
                <td className='px-3 py-2'>{control.implementation}</td>
                <td className='px-3 py-2'>{control.location}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <footer className='flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 font-mono text-[9px] text-ink-3'>
          <span>Data kontrol: {isLoading || allControls.length === 0 ? 'pending' : '/api/controls'}</span><span>{family === 'All' ? 'Semua keluarga' : `Keluarga ${family}`} · Filter hanya mengatur pilihan</span>
        </footer>
      </CardPanel>
    </Main>
  </>
}
