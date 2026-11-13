import { useState } from 'react'
import { documents } from '@/data/grc'
import { PageHead } from '@/components/page-head'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { type DocRow } from './components/documents-columns'
import { DocumentsDetailPanel } from './components/documents-detail-panel'
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

      <Main className='focus-strong flex min-w-0 flex-1 flex-col gap-4'>
        <PageHead
          eyebrow='AKSES DOKUMEN / INVENTARIS'
          title='Registri dokumen'
          note={`${rows.length} dokumen · ${rows.reduce((sum, doc) => sum + doc.versions.length, 0)} versi`}
        />

        {rows.length === 0 ? (
          <p className='text-[11px] text-ink-2'>Belum ada dokumen.</p>
        ) : (
          <div className='flex min-w-0 flex-col gap-4 min-[1200px]:flex-row min-[1200px]:items-start'>
            <div className='min-w-0 flex-1'>
              <DocumentsTable
                data={rows}
                selectedId={selected?.id}
                onSelect={(doc) => setSelectedId(doc.id)}
              />
            </div>
            {selected && <DocumentsDetailPanel doc={selected} />}
          </div>
        )}
      </Main>
    </>
  )
}
