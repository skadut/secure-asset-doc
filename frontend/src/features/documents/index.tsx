import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { documents } from '@/data/grc'
import { getMe } from '@/lib/session'
import { PageHead } from '@/components/page-head'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { type LevelFilter, filterDocs } from './helpers'
import { type DocRow } from './components/documents-columns'
import { DocumentsDetailPanel } from './components/documents-detail-panel'
import { DocumentsTable } from './components/documents-table'
import { DocumentsToolbar } from './components/documents-toolbar'

export function Documents() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<LevelFilter>('ALL')
  const rows: DocRow[] = documents
  const filtered = useMemo(() => filterDocs(rows, query, level), [rows, query, level])
  const selected = rows.find((doc) => doc.id === selectedId) ?? rows[0] ?? null
  const me = getMe()
  const versionCount = filtered.reduce((sum, doc) => sum + doc.versions.length, 0)

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
          eyebrow={`Registri · ${filtered.length} dokumen terlihat · ${versionCount} versi`}
          title='Registri dokumen'
          note='Di luar akses tidak ditampilkan'
          actions={
            selected && (
              <>
                {me?.can.access?.request && (
                  <Button asChild variant='outline' className='min-h-9 rounded-none border-line-strong text-[11px]'>
                    <Link to='/requests' search={{ doc: selected.id }}>
                      Ajukan akses
                    </Link>
                  </Button>
                )}
                <Button asChild className='min-h-9 rounded-none text-[11px]'>
                  <Link to='/viewer' search={{ doc: selected.id }}>
                    Buka penampil aman
                  </Link>
                </Button>
              </>
            )
          }
        />

        {rows.length === 0 ? (
          <p className='text-[11px] text-ink-2'>Belum ada dokumen.</p>
        ) : (
          <>
            <DocumentsToolbar
              docs={rows}
              query={query}
              onQueryChange={setQuery}
              level={level}
              onLevelChange={setLevel}
            />
            <div className='flex min-w-0 flex-col gap-3.5 min-[1200px]:flex-row min-[1200px]:items-start'>
              <div className='min-w-0 flex-1'>
                <DocumentsTable
                  data={filtered}
                  selectedId={selected?.id}
                  onSelect={(doc) => setSelectedId(doc.id)}
                />
              </div>
              {selected && <DocumentsDetailPanel doc={selected} />}
            </div>
          </>
        )}
      </Main>
    </>
  )
}
