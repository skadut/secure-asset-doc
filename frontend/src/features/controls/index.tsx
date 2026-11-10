import { useMemo, useState } from 'react'

import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { cn } from '@/lib/utils'
import { decisionFlow, controlRows } from './data'

const familyCodes = [...new Set(controlRows.map((control) => control.id.slice(0, 2)))].sort()
const families = ['All', ...familyCodes]

export function Controls() {
  const [family, setFamily] = useState('All')
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const rows = useMemo(
    () =>
      controlRows.filter((control) => {
        const matchesFamily = family === 'All' || control.id.startsWith(`${family}-`)
        const searchable = `${control.id} ${control.name} ${control.implementation}`.toLocaleLowerCase()
        return matchesFamily && searchable.includes(normalizedQuery)
      }),
    [family, normalizedQuery],
  )

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-6'>
        <header className='space-y-2'>
          <h1 className='text-2xl font-bold tracking-tight'>Kontrol NIST SP 800-53</h1>
          <p className='max-w-3xl text-muted-foreground'>Pemetaan kontrol berikut menjelaskan hubungan desain aplikasi dengan NIST SP 800-53 Rev. 5.</p>
          <p className='font-medium'>Pemetaan ini adalah desain, bukan bukti kepatuhan.</p>
        </header>

        <section aria-labelledby='decision-flow-title' className='space-y-3'>
          <h2 id='decision-flow-title' className='text-lg font-semibold'>Alur keputusan akses</h2>
          <ol className='grid gap-3 sm:grid-cols-2'>
            {decisionFlow.map((step) => (
              <li key={step.label} className='rounded-lg border border-border bg-card p-4'>
                <p className='font-medium'>{step.label}</p>
                <p className='mt-1 text-sm text-muted-foreground'>{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby='mapping-title' className='space-y-3'>
          <div className='flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between'>
            <div>
              <h2 id='mapping-title' className='text-lg font-semibold'>Pemetaan SP 800-53 Rev. 5</h2>
              <p className='text-sm text-muted-foreground'>Cari berdasarkan ID, nama, atau implementasi.</p>
            </div>
            <div className='flex flex-wrap gap-2' role='group' aria-label='Saring keluarga kontrol'>
              {families.map((option) => (
                <button
                  key={option}
                  type='button'
                  aria-pressed={family === option}
                  onClick={() => setFamily(option)}
                  className={cn(
                    'min-h-11 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    family === option
                      ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'border-border hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {option === 'All' ? 'Semua' : option}
                </button>
              ))}
            </div>
          </div>

          <div className='space-y-2'>
            <label htmlFor='control-search' className='text-sm font-medium'>Cari kontrol</label>
            <input
              id='control-search'
              type='search'
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Contoh: AC-2 atau audit'
              className='flex h-11 w-full max-w-xl rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
            />
          </div>

          <p role='status' aria-live='polite' className='text-sm text-muted-foreground'>{rows.length} kontrol</p>

          <div className='overflow-x-auto rounded-lg border border-border'>
            <table className='w-full min-w-[48rem] text-left text-sm'>
              <caption className='sr-only'>Tabel pemetaan kontrol NIST SP 800-53</caption>
              <thead className='bg-muted/50 text-muted-foreground'>
                <tr>
                  <th scope='col' className='px-4 py-3 font-medium'>ID kontrol</th>
                  <th scope='col' className='px-4 py-3 font-medium'>Nama</th>
                  <th scope='col' className='px-4 py-3 font-medium'>Implementasi di aplikasi</th>
                  <th scope='col' className='px-4 py-3 font-medium'>Lokasi (berkas/modul)</th>
                </tr>
              </thead>
              <tbody className='divide-y divide-border'>
                {rows.length > 0 ? (
                  rows.map((control) => (
                    <tr key={control.id} className='align-top'>
                      <th scope='row' className='whitespace-nowrap px-4 py-3 font-mono font-medium'>{control.id}</th>
                      <td className='px-4 py-3 font-medium'>{control.name}</td>
                      <td className='min-w-[20rem] px-4 py-3 text-muted-foreground'>{control.implementation}</td>
                      <td className='min-w-[16rem] px-4 py-3 font-mono text-xs text-muted-foreground'>{control.location}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className='px-4 py-8 text-center text-muted-foreground'>Tidak ada kontrol yang cocok dengan filter ini.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </Main>
    </>
  )
}
