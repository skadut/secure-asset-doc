import { useState } from 'react'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { documents } from '@/data/grc'
import { DocumentsDetailPanel } from './components/documents-detail-panel'
import { type DocRow } from './components/documents-columns'
import { DocumentsTable } from './components/documents-table'

export function Documents() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const rows: DocRow[] = documents
  const selected = rows.find((doc) => doc.id === selectedId) ?? rows[0] ?? null

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='focus-strong flex min-w-0 flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h1 className='page-title tracking-tight'>Registri dokumen</h1>
          <p className='text-muted-foreground'>Telusuri dokumen, klasifikasi TLP, status, dan keputusan akses akun Anda.</p>
        </div>
        {rows.length === 0 ? (
          <p className='text-muted-foreground'>Belum ada dokumen.</p>
        ) : (
          <div className='flex flex-col gap-6 min-[1200px]:flex-row min-[1200px]:items-start'>
            <div className='min-w-0 flex-1'>
              <DocumentsTable data={rows} selectedId={selected?.id} onSelect={(doc) => setSelectedId(doc.id)} />
            </div>
            {selected && <DocumentsDetailPanel doc={selected} />}
          </div>
        )}
      </Main>
    </>
  )
}
