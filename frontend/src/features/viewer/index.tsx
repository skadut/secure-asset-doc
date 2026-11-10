import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { TlpBadge } from '@/components/tlp-badge'
import { documents, type Tlp } from '@/data/grc'
import { FilePreview } from '@/features/documents/components/file-preview'
import { DocumentUnavailable } from '@/features/errors/document-unavailable'
import { getDocument } from '@/lib/grc'
import { getMe } from '@/lib/session'
import './viewer.css'

const pad = (n: number) => String(n).padStart(2, '0')

export function sessionLimitSeconds(tlp: Tlp): number | null {
  switch (tlp) {
    case 'RED':
    case 'RED+STRICT':
      return 600
    case 'AMBER':
    case 'AMBER+STRICT':
      return 900
    case 'GREEN':
    case 'CLEAR':
      return null
  }
}

export function Viewer() {
  const { doc } = useSearch({ from: '/_authenticated/viewer/' })

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex min-w-0 flex-1 flex-col gap-4'>
        {doc ? <ViewerBody key={doc} docId={doc} /> : <Picker />}
      </Main>
    </>
  )
}

// ponytail: picker lists only readable documents; lockedDocuments have no file and would only lead to DocumentUnavailable.
function Picker() {
  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <div className='flex min-w-0 flex-col gap-1'>
        <h1 className='text-2xl font-bold tracking-tight'>Penampil aman</h1>
        <p className='break-words text-muted-foreground'>
          Pilih dokumen untuk dibuka. Akses diputuskan di server.
        </p>
      </div>
      {documents.length ? (
        <div className='flex min-w-0 flex-col gap-2'>
          <div className='flex items-center gap-3 px-4 text-xs text-muted-foreground'>
            <div className='w-24 shrink-0'>No. dokumen</div>
            <div className='min-w-0 flex-1'>Nama dokumen</div>
            <div className='shrink-0'>TLP</div>
          </div>
          <ul className='flex min-w-0 flex-col divide-y rounded-md border'>
            {documents.map((d) => (
              <li key={d.id}>
                <Link
                  to='/viewer'
                  search={{ doc: d.id }}
                  className='flex min-h-11 min-w-0 flex-wrap items-center gap-3 px-4 py-3 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none'
                >
                  <span className='w-24 shrink-0 break-all font-mono text-sm text-muted-foreground'>{d.id}</span>
                  <span className='min-w-0 flex-1 break-words font-medium'>{d.title}</span>
                  <span className='shrink-0'>
                    <TlpBadge tlp={d.tlp} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className='text-muted-foreground'>Belum ada dokumen yang tersedia untuk dibuka.</p>
      )}
    </div>
  )
}

function ViewerBody({ docId }: { docId: string }) {
  const [selected, setSelected] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const doc = getDocument(docId)
  const limit = doc ? sessionLimitSeconds(doc.tlp) : null
  const remaining = limit === null ? null : Math.max(0, limit - elapsed)
  const expired = remaining !== null && remaining === 0

  useEffect(() => {
    const id = setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const current = doc?.versions[selected]
  const url = current?.file?.url
  const me = getMe()

  // Status probe: FilePreview hides HTTP status, so check it here. ponytail: one extra GET; cancelled body.
  const probe = useQuery({
    queryKey: ['viewer-file-status', url],
    enabled: Boolean(url),
    retry: false,
    queryFn: async () => {
      if (!url) return 0
      const res = await fetch(url, { credentials: 'same-origin' })
      await res.body?.cancel()
      return res.status
    },
  })

  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.body.classList.add('viewer-active')
    return () => document.body.classList.remove('viewer-active')
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const t = e.target
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
      ) {
        return
      }
      if (!(t instanceof Node) || !rootRef.current?.contains(t)) return
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'c'].includes(e.key.toLowerCase())) {
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!doc || probe.data === 403 || probe.data === 404) return <DocumentUnavailable />

  return (
    <>
      <div ref={rootRef} className='viewer-content flex min-w-0 flex-col gap-4'>
        <nav aria-label='Navigasi dokumen' className='flex flex-wrap items-center gap-x-4 gap-y-2 text-sm'>
          <Link
            to='/documents/$documentId'
            params={{ documentId: doc.id }}
            className='inline-flex min-h-11 items-center underline underline-offset-4'
          >
            Kembali ke detail dokumen
          </Link>
          <Link to='/documents' className='inline-flex min-h-11 items-center text-muted-foreground underline underline-offset-4'>
            Registri dokumen
          </Link>
        </nav>
        <header className='flex min-w-0 flex-wrap items-center justify-between gap-3 border-b pb-3'>
          <div className='flex min-w-0 flex-col gap-1'>
            <h1 className='text-xl font-bold tracking-tight break-words'>{doc.title}</h1>
            <div className='flex flex-wrap items-center gap-2 text-sm'>
              <span className='font-mono break-all'>{doc.id}</span>
              <TlpBadge tlp={doc.tlp} />
            </div>
          </div>
          <SessionTimer remaining={remaining} elapsed={elapsed} />
        </header>

        <div className='grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)_16rem]'>
          <aside aria-labelledby='viewer-versions' className='flex min-w-0 flex-col gap-3'>
            <h2 id='viewer-versions' className='text-sm font-semibold'>
              Riwayat versi
            </h2>
            <ol className='flex flex-col gap-2 text-sm'>
              {doc.versions.map((v, i) => (
                <li key={v.version}>
                  <button
                    type='button'
                    aria-pressed={i === selected}
                    onClick={() => setSelected(i)}
                    className={`flex min-h-11 w-full min-w-0 flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${i === selected ? 'border-primary bg-muted' : ''}`}
                  >
                    <span className='font-mono break-all'>
                      {v.version}
                      {i === 0 && ' (saat ini)'}
                    </span>
                    <time dateTime={v.date} className='font-mono tabular-nums text-muted-foreground'>
                      {v.date}
                    </time>
                  </button>
                </li>
              ))}
            </ol>
          </aside>

          <section
            aria-labelledby='viewer-preview'
            onContextMenu={(e) => e.preventDefault()}
            onCopy={(e) => e.preventDefault()}
            className='relative order-first flex min-w-0 flex-col gap-3 lg:order-none'
          >
            <h2 id='viewer-preview' className='text-sm font-semibold'>
              Pratinjau versi {current?.version}
            </h2>
            {expired ? (
              <p role='alert'>
                Sesi berakhir. Buka kembali dokumen dari registri untuk memulai sesi baru.
              </p>
            ) : (
              <FilePreview file={current?.file} />
            )}
            <Watermark user={me?.username ?? '-'} />
          </section>

          <aside
            aria-labelledby='viewer-blocked'
            className='flex min-w-0 flex-col gap-3 rounded-md border p-4'
          >
            <h2 id='viewer-blocked' className='text-sm font-semibold'>
              Tindakan diblokir
            </h2>
            <ul className='flex flex-col gap-2 text-sm'>
              <li className='flex items-center justify-between gap-2'>
                <span>Cetak</span>
                <kbd className='font-mono text-xs'>Ctrl/Cmd + P</kbd>
              </li>
              <li className='flex items-center justify-between gap-2'>
                <span>Salin</span>
                <kbd className='font-mono text-xs'>Ctrl/Cmd + C</kbd>
              </li>
              <li className='flex items-center justify-between gap-2'>
                <span>Simpan</span>
                <kbd className='font-mono text-xs'>Ctrl/Cmd + S</kbd>
              </li>
            </ul>
            <p className='text-sm text-muted-foreground break-words'>
              Pemblokiran ini hanya penangkal, bukan kontrol keamanan. Keputusan akses dibuat di server.
            </p>
          </aside>
        </div>
      </div>

      <p className='viewer-print-note'>Pencetakan halaman ini diblokir.</p>
    </>
  )
}

function SessionTimer({
  remaining,
  elapsed,
}: {
  remaining: number | null
  elapsed: number
}) {
  const expired = remaining === 0
  const label = expired ? 'Sesi berakhir' : remaining === null ? 'Sesi berjalan' : 'Sisa sesi'
  const value = expired ? 0 : (remaining ?? elapsed)

  return (
    <div role='timer' aria-label={label} className='flex flex-col items-end'>
      <span className='text-xs text-muted-foreground'>{label}</span>
      <span className='font-mono text-lg font-medium tabular-nums'>
        {pad(Math.floor(value / 60))}:{pad(value % 60)}
      </span>
    </div>
  )
}

// Repeated diagonal labels; decorative, so hidden from assistive tech.
function Watermark({ user }: { user: string }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const label = `${user} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  const line = Array(4).fill(label).join('        ')

  return (
    <div
      aria-hidden='true'
      className='pointer-events-none absolute inset-0 overflow-hidden text-foreground opacity-[0.12] select-none'
    >
      <div className='absolute -inset-1/2 flex -rotate-30 flex-col justify-around gap-20 font-mono text-sm tabular-nums'>
        {Array.from({ length: 8 }, (_, i) => (
          <p key={i} className='whitespace-nowrap'>
            {line}
          </p>
        ))}
      </div>
    </div>
  )
}
