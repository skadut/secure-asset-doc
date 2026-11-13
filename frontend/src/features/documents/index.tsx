import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { documents } from '@/data/grc'
import { ExternalLink, Lock } from 'lucide-react'
import { getMe } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { PageHead } from '@/components/page-head'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { type DocRow } from './components/documents-columns'
import { DocumentsDetailPanel } from './components/documents-detail-panel'
import { DocumentsTable } from './components/documents-table'
import { DocumentsToolbar } from './components/documents-toolbar'
import { type LevelFilter, filterDocs } from './helpers'

export function Documents() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<LevelFilter>('ALL')
  const rows: DocRow[] = documents
  const filtered = useMemo(
    () => filterDocs(rows, query, level),
    [rows, query, level]
  )
  const selected = selectedId
    ? (rows.find((doc) => doc.id === selectedId) ?? null)
    : null
  // Header actions target the selection, else the first visible document (as before).
  const actionDoc = selected ?? filtered[0] ?? rows[0] ?? null
  const me = getMe()
  const versionCount = filtered.reduce(
    (sum, doc) => sum + doc.versions.length,
    0
  )

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
          note={
            <span className='font-mono text-[9px] tracking-[.08em] text-ink-3 uppercase'>
              Di luar akses tidak ditampilkan
            </span>
          }
          actions={
            actionDoc && (
              <>
                {me?.can.access?.request && (
                  <Button
                    asChild
                    variant='outline'
                    className='h-9 gap-2 rounded-none border-[.67px] border-line bg-surface px-[14.67px] text-[12.5px] font-semibold'
                  >
                    <Link to='/requests' search={{ doc: actionDoc.id }}>
                      <Lock aria-hidden='true' className='size-3.5' />
                      Ajukan akses
                    </Link>
                  </Button>
                )}
                <Button
                  asChild
                  className='h-9 gap-2 rounded-none border-[.67px] border-ink bg-ink px-[14.67px] text-[12.5px] font-semibold text-bg hover:bg-ink'
                >
                  <Link to='/viewer' search={{ doc: actionDoc.id }}>
                    <ExternalLink aria-hidden='true' className='size-3.5' />
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
              {selected && (
                <DocumentsDetailPanel
                  doc={selected}
                  onClose={() => setSelectedId(null)}
                />
              )}
            </div>
          </>
        )}
      </Main>
    </>
  )
}
