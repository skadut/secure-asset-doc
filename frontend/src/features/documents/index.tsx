import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { documents } from '@/data/grc'
import { ExternalLink, Lock, Upload } from 'lucide-react'
import { getMe } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { UploadDialog } from './uploads/upload-dialog'
import { UploadsPanel } from './uploads/uploads-panel'

export function Documents({ autoUpload = false }: { autoUpload?: boolean }) {
  const navigate = useNavigate()
  const [uploadOpen, setUploadOpen] = useState(false)
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
  const canUpload = me?.can.upload?.c === true
  const canReadUploads = me?.can.upload?.r === true
  const showUpload = canUpload && (uploadOpen || autoUpload)
  const setShowUpload = (next: boolean) => {
    setUploadOpen(next)
    if (!next && autoUpload)
      void navigate({ to: '/documents', search: {}, replace: true })
  }

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
            <span className='font-mono text-[10.5px] tracking-[.08em] text-ink-3 uppercase'>
              Di luar akses tidak ditampilkan
            </span>
          }
          actions={
            <>
              {canUpload && (
                <Button
                  type='button'
                  onClick={() => setShowUpload(true)}
                  className='h-11 gap-2 rounded-none border-[.67px] border-ink bg-ink px-[14.67px] text-[14.5px] font-semibold text-bg hover:bg-ink'
                >
                  <Upload aria-hidden='true' className='size-3.5' />
                  Unggah dokumen
                </Button>
              )}
              {actionDoc && (
                <>
                  {me?.can.access?.request && (
                    <Button
                      asChild
                      variant='outline'
                      className='h-9 gap-2 rounded-none border-[.67px] border-line bg-surface px-[14.67px] text-[14.5px] font-semibold'
                    >
                      <Link to='/requests' search={{ doc: actionDoc.id }}>
                        <Lock aria-hidden='true' className='size-3.5' />
                        Ajukan akses
                      </Link>
                    </Button>
                  )}
                  <Button
                    asChild
                    className='h-9 gap-2 rounded-none border-[.67px] border-ink bg-ink px-[14.67px] text-[14.5px] font-semibold text-bg hover:bg-ink'
                  >
                    <Link to='/viewer' search={{ doc: actionDoc.id }}>
                      <ExternalLink aria-hidden='true' className='size-3.5' />
                      Buka penampil aman
                    </Link>
                  </Button>
                </>
              )}
            </>
          }
        />

        {rows.length === 0 ? (
          <p className='text-[12.5px] text-ink-2'>Belum ada dokumen.</p>
        ) : (
          <Tabs
            defaultValue='documents'
            className='flex min-w-0 flex-col gap-3.5'
          >
            {canReadUploads && (
              <TabsList
                aria-label='Tampilan registri'
                className='h-auto w-fit gap-0 rounded-none border border-line bg-surface p-0 text-ink-3'
              >
                <TabsTrigger
                  value='documents'
                  className='min-h-11 flex-none rounded-none border-0 px-3 font-mono text-[10px] tracking-[.08em] uppercase data-[state=active]:bg-ink data-[state=active]:text-bg data-[state=active]:shadow-none'
                >
                  Daftar dokumen
                </TabsTrigger>
                <TabsTrigger
                  value='uploads'
                  className='min-h-11 flex-none rounded-none border-0 border-l border-line px-3 font-mono text-[10px] tracking-[.08em] uppercase data-[state=active]:bg-ink data-[state=active]:text-bg data-[state=active]:shadow-none'
                >
                  Unggahan terenkripsi
                </TabsTrigger>
              </TabsList>
            )}
            <TabsContent
              value='documents'
              className='flex min-w-0 flex-col gap-3.5'
            >
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
                    onResetFilter={() => {
                      setQuery('')
                      setLevel('ALL')
                    }}
                  />
                </div>
                {selected && (
                  <DocumentsDetailPanel
                    doc={selected}
                    onClose={() => setSelectedId(null)}
                  />
                )}
              </div>
            </TabsContent>
            {canReadUploads && (
              <TabsContent value='uploads' className='min-w-0'>
                <UploadsPanel />
              </TabsContent>
            )}
          </Tabs>
        )}

        <UploadDialog open={showUpload} onOpenChange={setShowUpload} />
      </Main>
    </>
  )
}
