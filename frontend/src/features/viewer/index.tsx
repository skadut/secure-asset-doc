import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import { ArrowLeft, Clock3, Lock, X } from 'lucide-react'
import { CSF_FUNCTIONS, documents } from '@/data/grc'
import { getDocument, subcategoriesForDocument } from '@/lib/grc'
import { getMe } from '@/lib/session'
import { explainAccess } from '@/lib/access-api'
import { ThemeSwitch } from '@/components/theme-switch'
import { TlpMark } from '@/components/tlp-mark'
import { Chip } from '@/components/chip'
import { FilePreview } from '@/features/documents/components/file-preview'
import { TLP_BAR, isGrantOnly, sessionLimitSeconds } from '@/features/documents/helpers'
import { DocumentUnavailable } from '@/features/errors/document-unavailable'
import './viewer.css'

const pad = (n: number) => String(n).padStart(2, '0')

export function Viewer() {
  const { doc } = useSearch({ from: '/_authenticated/viewer/' })
  const selectedDoc = doc ? getDocument(doc) : undefined

  return createPortal(
    <div className='secure-viewer fixed inset-0 z-[100] flex min-h-0 flex-col bg-background text-foreground'>
      {selectedDoc ? (
        <ViewerBody key={selectedDoc.id} docId={selectedDoc.id} />
      ) : (
        <Picker />
      )}
    </div>,
    document.body
  )
}

function Picker() {
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <header className='flex min-h-[52px] items-center border-b border-line px-4'>
        <Link
          to='/documents'
          className='inline-flex min-h-11 items-center gap-2 font-mono text-[10px] uppercase tracking-[.06em] text-ink-2 underline-offset-2 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]'
        >
          <ArrowLeft aria-hidden='true' className='size-3.5' /> Registri
        </Link>
        <div className='mx-3 h-5 border-l border-line' />
        <h1 className='text-[13px] font-semibold'>Penampil aman</h1>
      </header>
      <main className='mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6'>
        <p className='text-[11px] text-ink-2'>Pilih dokumen yang tersedia untuk akun Anda.</p>
        {documents.length ? (
          <ul className='flex flex-col divide-y divide-line border-y border-line'>
            {documents.map((document) => (
              <li key={document.id}>
                <Link
                  to='/viewer'
                  search={{ doc: document.id }}
                  className='flex min-h-12 min-w-0 flex-wrap items-center gap-2 py-2 text-[11px] hover:bg-surface-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]'
                >
                  <span className='w-24 shrink-0 font-mono text-ink-3'>{document.id}</span>
                  <span className='min-w-0 flex-1 break-words font-medium'>{document.title}</span>
                  <TlpMark tlp={document.tlp} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-[11px] text-ink-2'>Belum ada dokumen yang tersedia untuk dibuka.</p>
        )}
      </main>
    </div>
  )
}

function ViewerBody({ docId }: { docId: string }) {
  const addViewerSession = (url: string, sessionId: string): string => {
    try {
      const u = new URL(url, window.location.origin)
      u.searchParams.set('viewerSession', sessionId)
      return u.toString()
    } catch {
      return url
    }
  }
  const [selected, setSelected] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [serverSession, setServerSession] = useState<null | { sessionId: string; expiresAtMs: number; ttlSeconds: number }>(null)
  const doc = getDocument(docId)
  const limit = doc ? sessionLimitSeconds(doc.tlp) : null
  const serverRemaining = serverSession ? Math.max(0, Math.ceil((serverSession.expiresAtMs - now) / 1000)) : null
  const remaining = serverRemaining !== null ? serverRemaining : (limit === null ? null : Math.max(0, limit - elapsed))
  const expired = remaining !== null && remaining === 0
  const me = getMe()
  const access = doc && me ? explainAccess(me, doc.tlp, doc.granted === true) : null
  const evidence = doc ? subcategoriesForDocument(doc.id) : []

  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/documents/${encodeURIComponent(docId)}/viewer-sessions`, {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return null
      const payload: unknown = await response.json()
      if (typeof payload !== 'object' || payload === null) return null
      const body = payload as Record<string, unknown>
      const expiresAtMs = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN
      if (typeof body.sessionId !== 'string' || !body.sessionId || !Number.isFinite(expiresAtMs) || typeof body.ttlSeconds !== 'number' || !Number.isFinite(body.ttlSeconds)) return null
      return { sessionId: body.sessionId, expiresAtMs, ttlSeconds: body.ttlSeconds }
    }).then((session) => {
      if (!controller.signal.aborted) setServerSession(session)
    }).catch(() => {
      if (!controller.signal.aborted) setServerSession(null)
    })
    return () => controller.abort()
  }, [docId])

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed((seconds) => seconds + 1)
      setNow(Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const current = doc?.versions[selected]
  const sessionUrl = current?.file?.url && serverSession ? addViewerSession(current.file.url, serverSession.sessionId) : current?.file?.url
  const previewFile = current?.file && sessionUrl ? { ...current.file, url: sessionUrl } : current?.file
  const url = sessionUrl
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
  // Watermark per pen: initials + access level; time stamped once on open.
  const [openedAt] = useState(() => new Date())
  const initials = (me?.name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
  const watermark = me ? `${initials} · L${me.accessLevel}` : '—'
  const stamp = `${pad(openedAt.getHours())}:${pad(openedAt.getMinutes())}`

  useEffect(() => {
    document.body.classList.add('viewer-active')
    return () => document.body.classList.remove('viewer-active')
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) return
      if (!(target instanceof Node) || !rootRef.current?.contains(target)) return
      if ((e.ctrlKey || e.metaKey) && ['p', 's', 'c'].includes(e.key.toLowerCase())) {
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!doc || probe.data === 403 || probe.data === 404)
    return (
      <div className='flex min-h-0 flex-1 flex-col'>
        <header className='flex min-h-[52px] items-center gap-3 border-b border-line px-4'>
          <Link
            to='/documents'
            className='inline-flex min-h-11 items-center gap-2 border border-line px-2 font-mono text-[9px] uppercase tracking-[.06em] text-ink-2 hover:bg-surface-active hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]'
          >
            <ArrowLeft aria-hidden='true' className='size-3.5' /> Registri
          </Link>
          <span className='font-mono text-[10px] text-ink-3'>{doc?.id ?? 'Dokumen tidak tersedia'}</span>
        </header>
        <DocumentUnavailable />
      </div>
    )

  return (
    <div ref={rootRef} className='viewer-content flex min-h-0 min-w-0 flex-1 flex-col'>
      <p className='sr-only'>Pencegahan salin dan cetak bersifat penghalang antarmuka, bukan kontrol keamanan. Server tetap memeriksa setiap akses.</p>
      <header className='flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-background px-3 py-1.5 sm:px-4'>
        <Link
          to='/documents'
          aria-label='Kembali ke registri dokumen'
          className='inline-flex min-h-11 shrink-0 items-center gap-2 border border-line px-2 text-ink-2 hover:bg-surface-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]'
        >
          <ArrowLeft aria-hidden='true' className='size-3.5' />
          <span className='font-mono text-[9px] uppercase tracking-[.06em]'>Registri</span>
        </Link>
        <div className='hidden h-5 border-l border-line sm:block' />
        <span className='font-mono text-[10px] text-ink-2'>{doc.id}</span>
        <span className={`inline-flex items-center whitespace-nowrap px-1.5 py-0.5 font-mono text-[8px] font-medium uppercase tracking-[.06em] ${TLP_BAR[doc.tlp]}`}>
          TLP:{doc.tlp}
        </span>
        <span className='min-w-0 flex-1 basis-full truncate text-[11px] text-ink-2 sm:basis-auto'>
          {doc.title} · v{current?.version ?? '-'}
        </span>
        <div className='ml-auto flex items-center gap-2'>
          <SessionTimer remaining={remaining} elapsed={elapsed} />
          <ThemeSwitch />
          <Link
            to='/documents'
            aria-label='Tutup penampil aman'
            className='inline-flex size-10 shrink-0 items-center justify-center text-ink-2 hover:bg-surface-active hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]'
          >
            <X aria-hidden='true' className='size-4' />
          </Link>
        </div>
      </header>

      <div className='grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[214px_minmax(0,1fr)_300px] lg:overflow-hidden'>
        <aside aria-labelledby='viewer-versions' className='flex min-w-0 flex-col border-b border-line bg-surface lg:overflow-y-auto lg:border-r lg:border-b-0'>
          <h2 id='viewer-versions' className='flex h-[38px] shrink-0 items-center border-b border-line px-3 font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Versi</h2>
          <ol className='flex min-w-0 flex-col'>
            {doc.versions.map((version, index) => (
              <li key={version.version}>
                <button
                  type='button'
                  aria-pressed={index === selected}
                  onClick={() => setSelected(index)}
                  className={`flex min-h-[47px] w-full flex-col items-start justify-center gap-1 border-b border-line px-3 py-2 text-left hover:bg-surface-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--focus)] ${index === selected ? 'bg-surface-active' : ''}`}
                >
                  <span className='font-mono text-[10px] text-ink'>
                    {version.version}{index === 0 && <span className='ms-1 text-[8px] text-ink-3'>SAAT INI</span>}
                  </span>
                  <span className='font-mono text-[8px] text-ink-3'>
                    {version.date} · {version.author}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className='mt-auto hidden gap-1.5 border-t border-line px-3 py-3 text-[7.5px] leading-[13px] text-ink-3 lg:flex lg:flex-col'>
            <Lock aria-hidden='true' className='size-[13px]' />
            Salin, cetak, dan simpan diblokir di area ini. Watermark mengikuti akun Anda setiap menit.
          </p>
        </aside>

        <main
          aria-label='Pratinjau dokumen'
          onContextMenu={(event) => event.preventDefault()}
          onCopy={(event) => event.preventDefault()}
          className='relative order-first flex min-w-0 items-start justify-center overflow-auto bg-bg-sunken px-3 py-5 lg:order-none lg:px-6 lg:py-7'
        >
          <div className='relative min-h-[560px] w-full max-w-[660px] shrink-0 bg-white text-[#20231f] sm:min-h-[760px] lg:min-h-[888px]'>
            <div className='pointer-events-none absolute inset-0 overflow-hidden' aria-hidden='true'>
              <div className='absolute inset-0 grid -rotate-[30deg] place-content-around gap-28 opacity-[.15]'>
                {[0, 1, 2].map((index) => (
                  <span key={index} className='whitespace-nowrap font-mono text-[10px] tracking-[.08em] text-[#68716a]'>
                    {watermark} · {stamp} · {doc.id}
                  </span>
                ))}
              </div>
            </div>
            <article className='relative flex min-h-[560px] flex-col px-6 py-8 sm:min-h-[760px] sm:px-10 sm:py-12 lg:min-h-[888px] lg:px-12'>
              <p className='font-mono text-[8px] uppercase tracking-[.12em] text-[#68716a]'>
                {doc.type} · {doc.id}
              </p>
              <h1 className='mt-2 border-b border-[#20231f] pb-2 text-[20px] font-semibold leading-tight sm:text-[24px]'>
                {doc.title}
              </h1>
              <dl className='flex flex-wrap gap-x-4 gap-y-2 border-b border-[#c5cbc4] py-2 font-mono text-[8px]'>
                <div><dt className='text-[#68716a]'>VERSI</dt><dd>{current?.version ?? '-'}</dd></div>
                <div><dt className='text-[#68716a]'>TANGGAL</dt><dd>{current?.date ?? '-'}</dd></div>
                <div><dt className='text-[#68716a]'>PENYUSUN</dt><dd>{current?.author ?? '-'}</dd></div>
                <div><dt className='text-[#68716a]'>STATUS</dt><dd>{doc.status}</dd></div>
              </dl>
              <p className='mt-4 text-[11px] leading-[1.7] text-[#424943]'>
                {current?.summary ?? 'Belum ada ringkasan untuk versi ini.'}
              </p>
              <h2 className='mt-5 text-[13px] font-semibold'>Informasi dokumen</h2>
              <dl className='mt-3 grid gap-0 text-[10px]'>
                <PrintField label='Jenis dokumen' value={doc.type} />
                <PrintField label='Pemilik' value={doc.owner} />
                <PrintField label='Penyetuju' value={current?.approvedBy ?? doc.approver} />
                <PrintField label='Tinjauan berikutnya' value={doc.nextReview} />
                <PrintField label='Klasifikasi' value={`TLP:${doc.tlp}`} />
              </dl>
              <div className='mt-5 min-h-0 flex-1' onContextMenu={(event) => event.preventDefault()} onCopy={(event) => event.preventDefault()}>
                {expired ? (
                  <p role='alert' className='text-[11px] text-[#424943]'>
                    Sesi berakhir. Buka kembali dokumen dari registri untuk memulai sesi baru.
                  </p>
                ) : (
                  <FilePreview file={previewFile} secure />
                )}
              </div>
              <footer className='mt-8 flex flex-wrap justify-between gap-2 border-t border-[#c5cbc4] pt-2 font-mono text-[8px] text-[#68716a]'>
                <span>{doc.id} · v{current?.version ?? '-'} · Salinan terkendali</span>
                <span>Penyebaran tidak diizinkan</span>
              </footer>
            </article>
          </div>
        </main>

        <aside aria-label='Metadata dokumen dan akses' className='flex min-w-0 flex-col border-t border-line bg-surface lg:overflow-y-auto lg:border-t-0 lg:border-l'>
          <h2 className='flex h-[38px] shrink-0 items-center border-b border-line px-3 font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Dokumen</h2>
          <dl className='px-3'>
            <MetaField label='JENIS'>{doc.type}</MetaField>
            <MetaField label='PEMILIK'>{doc.owner}</MetaField>
            <MetaField label='PENYETUJU'>{doc.approver}</MetaField>
            <MetaField label='TINJAUAN'>{doc.nextReview}</MetaField>
            <MetaField label='KLAIM TLP'>TLP:{doc.tlp}{isGrantOnly(doc.tlp) ? ' · grant' : ''}</MetaField>
          </dl>
          <section className='border-t border-line px-3 py-3'>
            <h3 className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Bukti CSF 2.0</h3>
            {evidence.length ? (
              <ul className='mt-2 flex flex-col'>
                {evidence.map((item) => (
                  <li
                    key={item.id}
                    title={`${CSF_FUNCTIONS[item.fn]} · ${item.categoryName}`}
                    className='flex h-[30px] items-center gap-2 border-b border-line-subtle font-mono text-[9px] text-ink-2'
                  >
                    <span className='inline-flex h-4 w-5 items-center justify-center border border-line text-[7px] text-ink-3'>
                      {item.fn}
                    </span>
                    {item.id}
                  </li>
                ))}
              </ul>
            ) : (
              <p className='mt-2 text-[10px] text-ink-2'>Tidak ada bukti CSF tertaut.</p>
            )}
          </section>
          <section className='border-t border-line px-3 py-3'>
            <div className='flex items-center justify-between gap-2'>
              <h3 className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Batas sesi</h3>
              <span className='font-mono text-[9px] tabular-nums text-ink-2'>
                {serverSession ? `${pad(Math.floor(serverSession.ttlSeconds / 60))}:00` : limit === null ? 'TANPA BATAS LOKAL' : `${pad(Math.floor(limit / 60))}:00`}
              </span>
            </div>
            <div className='mt-2 h-[3px] bg-bg-sunken' role='progressbar' aria-label={serverSession ? 'Waktu sesi server' : 'Waktu sesi lokal'} aria-valuemin={0} aria-valuemax={serverSession?.ttlSeconds ?? limit ?? 0} aria-valuenow={serverSession ? remaining ?? 0 : limit === null ? 0 : remaining ?? 0}>
              {serverSession ? (
                <div className='h-full bg-pass' style={{ width: `${serverSession.ttlSeconds > 0 ? Math.max(0, (remaining ?? 0) / serverSession.ttlSeconds) * 100 : 0}%` }} />
              ) : (
                limit !== null && <div className='h-full bg-pass' style={{ width: `${Math.max(0, (remaining ?? 0) / limit) * 100}%` }} />
              )}
            </div>
            <p className='mt-2 text-[9px] leading-relaxed text-ink-3'>
              {serverSession ? 'Masa berlaku ditetapkan server.' : 'Batas waktu lokal — server tidak mengembalikan sesi penampil.'}
            </p>
          </section>
          <section className='border-t border-line px-3 py-3'>
            <div className='flex items-center justify-between gap-2'>
              <h3 className='font-mono text-[8px] uppercase tracking-[.08em] text-ink-3'>Akses Anda</h3>
              <Chip tone={access === null ? 'line' : access.permit ? 'pass' : 'fail'}>
                {access === null ? 'TIDAK DIKETAHUI' : access.permit ? 'DIIZINKAN' : 'DITOLAK'}
              </Chip>
            </div>
            <p className='mt-2 text-[9px] leading-relaxed text-ink-2'>
              {access?.reasons.join(' · ') ?? 'Keputusan akses server tidak tersedia.'}
            </p>
          </section>
        </aside>
      </div>
      <p className='viewer-print-note'>Pencetakan halaman ini diblokir.</p>
    </div>
  )
}

function MetaField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex min-h-[37px] flex-col justify-center border-b border-line py-1.5'>
      <dt className='font-mono text-[7px] uppercase tracking-[.1em] text-ink-3'>{label}</dt>
      <dd className='break-words text-[10px] leading-[1.4] text-ink-2'>{children}</dd>
    </div>
  )
}

function PrintField({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex min-w-0 justify-between gap-3 border-b border-[#c5cbc4] py-1.5'>
      <dt className='text-[#68716a]'>{label}</dt>
      <dd className='text-right'>{value}</dd>
    </div>
  )
}

function SessionTimer({ remaining, elapsed }: { remaining: number | null; elapsed: number }) {
  const value = remaining === 0 ? 0 : (remaining ?? elapsed)
  const label = remaining === 0 ? 'Sesi berakhir' : remaining === null ? 'Sesi berjalan' : 'Sisa sesi'
  return (
    <div role='timer' aria-label={label} className='flex h-9 shrink-0 items-center gap-2 border border-line px-2'>
      <Clock3 aria-hidden='true' className='size-3 text-ink-3' />
      <span className='hidden font-mono text-[8px] uppercase tracking-[.04em] text-ink-3 sm:inline'>Sisa sesi</span>
      <span className='font-mono text-[10px] tabular-nums text-ink'>
        {remaining === null ? '—' : `${pad(Math.floor(value / 60))}:${pad(value % 60)}`}
      </span>
    </div>
  )
}
