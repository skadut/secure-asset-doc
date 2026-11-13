import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import { CSF_FUNCTIONS, documents } from '@/data/grc'
import { ArrowLeft, ArrowUpRight, Clock3, Lock, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { explainAccess } from '@/lib/access-api'
import { getDocument, subcategoriesForDocument } from '@/lib/grc'
import { getMe } from '@/lib/session'
import { ThemeSwitch } from '@/components/theme-switch'
import { TlpMark } from '@/components/tlp-mark'
import { FilePreview } from '@/features/documents/components/file-preview'
import {
  TLP_BAR,
  daysUntil,
  isGrantOnly,
  sessionLimitSeconds,
} from '@/features/documents/helpers'
import { DocumentUnavailable } from '@/features/errors/document-unavailable'
import './viewer.css'

const pad = (n: number) => String(n).padStart(2, '0')

const versionLabel = (version: string) =>
  version.startsWith('v') ? version : `v${version}`

export function Viewer() {
  const { doc } = useSearch({ from: '/_authenticated/viewer/' })
  const selectedDoc = doc ? getDocument(doc) : undefined

  return createPortal(
    <div className='secure-viewer fixed inset-0 z-[100] flex min-h-0 flex-col bg-rail text-rail-ink'>
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
      <header className='flex min-h-[52px] items-center border-b border-rail-line px-4'>
        <Link
          to='/documents'
          className='inline-flex min-h-11 items-center gap-2 font-mono text-[11.5px] tracking-[.06em] text-rail-dim uppercase underline-offset-2 hover:text-rail-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]'
        >
          <ArrowLeft aria-hidden='true' className='size-3.5' /> Registri
        </Link>
        <div className='mx-3 h-5 border-l border-rail-line' />
        <h1 className='text-[15px] font-semibold'>Penampil aman</h1>
      </header>
      <main className='mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6'>
        <p className='text-[12.5px] text-rail-dim'>
          Pilih dokumen yang tersedia untuk akun Anda.
        </p>
        {documents.length ? (
          <ul className='flex flex-col divide-y divide-rail-line border-y border-rail-line'>
            {documents.map((document) => (
              <li key={document.id}>
                <Link
                  to='/viewer'
                  search={{ doc: document.id }}
                  className='flex min-h-12 min-w-0 flex-wrap items-center gap-2 py-2 text-[12.5px] hover:bg-rail-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]'
                >
                  <span className='w-24 shrink-0 font-mono text-rail-dim'>
                    {document.id}
                  </span>
                  <span className='min-w-0 flex-1 font-medium break-words'>
                    {document.title}
                  </span>
                  <TlpMark tlp={document.tlp} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-[12.5px] text-rail-dim'>
            Belum ada dokumen yang tersedia untuk dibuka.
          </p>
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
  const [serverSession, setServerSession] = useState<null | {
    sessionId: string
    expiresAtMs: number
    ttlSeconds: number
  }>(null)
  const [sessionDenied, setSessionDenied] = useState(false)
  const doc = getDocument(docId)
  const limit = doc ? sessionLimitSeconds(doc.tlp) : null
  const serverRemaining = serverSession
    ? Math.max(0, Math.ceil((serverSession.expiresAtMs - now) / 1000))
    : null
  const remaining =
    serverRemaining !== null
      ? serverRemaining
      : limit === null
        ? null
        : Math.max(0, limit - elapsed)
  const expired = remaining !== null && remaining === 0
  const me = getMe()
  const access =
    doc && me ? explainAccess(me, doc.tlp, doc.granted === true) : null
  const evidence = doc ? subcategoriesForDocument(doc.id) : []

  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/documents/${encodeURIComponent(docId)}/viewer-sessions`, {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          if (!controller.signal.aborted) setSessionDenied(true)
          return null
        }
        const payload: unknown = await response.json()
        if (typeof payload !== 'object' || payload === null) return null
        const body = payload as Record<string, unknown>
        const expiresAtMs =
          typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN
        if (
          typeof body.sessionId !== 'string' ||
          !body.sessionId ||
          !Number.isFinite(expiresAtMs) ||
          typeof body.ttlSeconds !== 'number' ||
          !Number.isFinite(body.ttlSeconds)
        )
          return null
        if (!controller.signal.aborted) setSessionDenied(false)
        return {
          sessionId: body.sessionId,
          expiresAtMs,
          ttlSeconds: body.ttlSeconds,
        }
      })
      .then((session) => {
        if (!controller.signal.aborted) setServerSession(session)
      })
      .catch(() => {
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
  const sessionUrl =
    current?.file?.url && serverSession
      ? addViewerSession(current.file.url, serverSession.sessionId)
      : current?.file?.url
  const previewFile =
    current?.file && sessionUrl
      ? { ...current.file, url: sessionUrl }
      : current?.file
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
  const fileUnavailable =
    sessionDenied || probe.data === 403 || probe.data === 404

  const rootRef = useRef<HTMLDivElement>(null)
  // Watermark per pen: username + time stamped once on open.
  const [openedAt] = useState(() => new Date())
  const stamp = `${pad(openedAt.getHours())}:${pad(openedAt.getMinutes())}`
  const watermark = me?.username ?? '—'
  const sessionEnd = serverSession
    ? new Date(serverSession.expiresAtMs)
    : limit !== null
      ? new Date(openedAt.getTime() + limit * 1000)
      : null
  const sessionEndLabel = sessionEnd
    ? `${pad(sessionEnd.getHours())}:${pad(sessionEnd.getMinutes())}`
    : '—'

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
      )
        return
      if (!(target instanceof Node) || !rootRef.current?.contains(target))
        return
      if (
        (e.ctrlKey || e.metaKey) &&
        ['p', 's', 'c'].includes(e.key.toLowerCase())
      ) {
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!doc)
    return (
      <div className='flex min-h-0 flex-1 flex-col'>
        <header className='flex min-h-[52px] items-center gap-3 border-b border-rail-line px-4'>
          <Link
            to='/documents'
            className='inline-flex min-h-11 items-center gap-2 border border-rail-line px-2 font-mono text-[10.5px] tracking-[.06em] text-rail-dim uppercase hover:bg-rail-active hover:text-rail-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]'
          >
            <ArrowLeft aria-hidden='true' className='size-3.5' /> Registri
          </Link>
          <span className='font-mono text-[11.5px] text-rail-dim'>
            Dokumen tidak tersedia
          </span>
        </header>
        <DocumentUnavailable />
      </div>
    )

  return (
    <div
      ref={rootRef}
      className='viewer-content flex min-h-0 min-w-0 flex-1 flex-col'
    >
      <p className='sr-only'>
        Pencegahan salin dan cetak bersifat penghalang antarmuka, bukan kontrol
        keamanan. Server tetap memeriksa setiap akses.
      </p>
      <header className='flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1 border-b border-rail-line bg-rail px-4 py-1.5'>
        <div className='flex min-w-0 items-center gap-3'>
          <Link
            to='/documents'
            aria-label='Kembali ke registri dokumen'
            className='inline-flex h-7 shrink-0 items-center gap-1.5 border border-rail-line px-2 text-rail-ink hover:bg-rail-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]'
          >
            <ArrowLeft aria-hidden='true' className='size-[11px]' />
            <span className='font-mono text-[9px] tracking-[.11em] uppercase'>
              Registri
            </span>
          </Link>
          <div className='hidden h-[18px] border-l border-rail-line sm:block' />
          <span className='font-mono text-[11.5px] font-medium text-rail-ink'>
            {doc.id}
          </span>
          <span
            className={`inline-flex h-[18px] shrink-0 items-center px-[5px] font-mono text-[8px] font-medium tracking-[.09em] whitespace-nowrap uppercase ${TLP_BAR[doc.tlp]}`}
          >
            TLP:{doc.tlp}
          </span>
          <span className='min-w-0 flex-1 basis-full truncate text-[12.5px] text-rail-dim sm:basis-auto'>
            {doc.title} · {versionLabel(current?.version ?? '-')}
          </span>
        </div>
        <div className='ml-auto flex shrink-0 items-center gap-3'>
          <SessionTimer remaining={remaining} elapsed={elapsed} />
          <span className='hidden font-mono text-[9px] whitespace-nowrap text-rail-dim md:inline'>
            {watermark} · {stamp}
          </span>
          <ThemeSwitch />
          <Link
            to='/documents'
            aria-label='Tutup penampil aman'
            className='relative inline-flex size-7 shrink-0 items-center justify-center text-rail-ink after:absolute after:-inset-2 hover:bg-rail-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]'
          >
            <X aria-hidden='true' className='size-[13px]' />
          </Link>
        </div>
      </header>

      <div className='grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[214px_minmax(0,1fr)_300px] lg:overflow-hidden'>
        <aside
          aria-labelledby='viewer-versions'
          className='flex min-w-0 flex-col border-b border-rail-line bg-rail lg:overflow-y-auto lg:border-r lg:border-b-0'
        >
          <h2
            id='viewer-versions'
            className='flex h-[38px] shrink-0 items-center border-b border-rail-line px-3.5 font-mono text-[9px] tracking-[.15em] text-rail-dim uppercase'
          >
            Versi
          </h2>
          <ol className='flex min-w-0 flex-col'>
            {doc.versions.map((version, index) => (
              <li key={version.version}>
                <button
                  type='button'
                  aria-pressed={index === selected}
                  onClick={() => setSelected(index)}
                  className={`focus-visible:outline-inset flex w-full flex-col items-start gap-[3px] border-b border-rail-line px-3.5 py-2.5 text-left hover:bg-rail-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)] ${index === selected ? 'bg-rail-active' : ''}`}
                >
                  <span className='flex items-center gap-1.5'>
                    <span
                      className={`font-mono text-[12px] text-rail-ink ${index === 0 ? 'font-semibold' : 'font-normal'}`}
                    >
                      {versionLabel(version.version)}
                    </span>
                    {index === 0 && (
                      <span className='font-mono text-[7.5px] tracking-[.08em] text-rail-dim'>
                        SAAT INI
                      </span>
                    )}
                  </span>
                  <span className='font-mono text-[8.5px] text-rail-dim'>
                    {version.date} · {version.author}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className='mt-auto hidden gap-1.5 border-t border-rail-line px-3.5 py-3 text-[8.5px] leading-[13px] text-rail-dim lg:flex lg:flex-col'>
            <Lock aria-hidden='true' className='size-[13px]' />
            Salin, cetak, dan simpan diblokir di area ini. Watermark mengikuti
            akun Anda setiap menit.
          </p>
        </aside>

        <main
          aria-label='Pratinjau dokumen'
          onContextMenu={(event) => event.preventDefault()}
          onCopy={(event) => event.preventDefault()}
          className='relative order-first flex min-w-0 items-start justify-center overflow-auto bg-rail px-3 py-5 lg:order-none lg:px-6 lg:py-7'
        >
          <div className='relative w-full max-w-[660px] shrink-0 bg-[var(--paper-bg)] text-[color:var(--paper-ink)]'>
            <div
              className='pointer-events-none absolute inset-0 overflow-hidden'
              aria-hidden='true'
            >
              <div className='absolute inset-0 grid -rotate-[32deg] place-content-around gap-28 opacity-[.16]'>
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    className='font-mono text-[15px] tracking-[1px] whitespace-nowrap text-[color:var(--paper-ink)]'
                  >
                    {watermark} · {stamp} · {doc.id}
                  </span>
                ))}
              </div>
            </div>
            <article className='relative flex min-h-[560px] flex-col gap-4 px-6 py-8 sm:min-h-[888px] sm:px-12 sm:py-[52px]'>
              <div className='flex flex-col gap-2'>
                <p className='font-mono text-[9px] tracking-[.16em] text-[color:var(--paper-mute)] uppercase'>
                  {doc.type} · {doc.id}
                </p>
                <h1 className='font-heading text-[27px] leading-[30px] font-semibold'>
                  {doc.title}
                </h1>
                <div className='h-px w-full bg-[var(--paper-ink)]' />
                <dl className='flex flex-wrap items-center gap-4'>
                  <PaperMeta label='VERSI' value={current?.version ?? '-'} />
                  <PaperMeta label='TANGGAL' value={current?.date ?? '-'} />
                  <PaperMeta label='PENYUSUN' value={current?.author ?? '-'} />
                  <PaperMeta label='STATUS' value={doc.status} />
                </dl>
              </div>
              <p className='text-[13px] leading-5 text-[color:var(--paper-body)]'>
                {current?.summary ?? 'Belum ada ringkasan untuk versi ini.'}
              </p>
              <h2 className='font-heading text-[14px] font-semibold'>
                1. Informasi dokumen
              </h2>
              <dl className='border-t border-[var(--paper-line)]'>
                <PaperRow label='Jenis dokumen' value={doc.type} />
                <PaperRow label='Pemilik' value={doc.owner} />
                <PaperRow
                  label='Penyetuju'
                  value={current?.approvedBy ?? doc.approver}
                />
                <PaperRow
                  label='Tinjauan berikutnya'
                  value={
                    doc.nextReview +
                    (daysUntil(doc.nextReview) < 0 ? ' · terlambat' : '')
                  }
                />
              </dl>
              <h2 className='font-heading text-[14px] font-semibold'>
                2. Berkas terkontrol
              </h2>
              <div
                className='min-h-0 flex-1'
                onContextMenu={(event) => event.preventDefault()}
                onCopy={(event) => event.preventDefault()}
              >
                {expired ? (
                  <p
                    role='alert'
                    className='text-[13px] leading-5 text-[color:var(--paper-body)]'
                  >
                    Sesi berakhir. Buka kembali dokumen dari registri untuk
                    memulai sesi baru.
                  </p>
                ) : fileUnavailable ? (
                  <div className='min-h-0 [&>*]:min-h-0'>
                    <DocumentUnavailable />
                  </div>
                ) : (
                  <FilePreview file={previewFile} secure />
                )}
              </div>
              <footer className='mt-auto flex flex-wrap items-end justify-between gap-2 font-mono text-[9px] text-[color:var(--paper-mute)]'>
                <span>
                  {doc.id} · {versionLabel(current?.version ?? '-')} · Halaman 1
                  dari 1
                </span>
                <span>Salinan terkendali — dilarang menyebarkan</span>
              </footer>
            </article>
          </div>
        </main>

        <aside
          aria-label='Metadata dokumen dan akses'
          className='flex min-w-0 flex-col border-t border-rail-line bg-rail lg:overflow-y-auto lg:border-t-0 lg:border-l'
        >
          <h2 className='flex h-[38px] shrink-0 items-center border-b border-rail-line px-4 font-mono text-[9px] tracking-[.15em] text-rail-dim uppercase'>
            Dokumen
          </h2>
          <dl className='px-4 pt-1 pb-3.5'>
            <MetaField label='JENIS'>{doc.type}</MetaField>
            <MetaField label='PEMILIK'>{doc.owner}</MetaField>
            <MetaField label='PENYETUJU'>{doc.approver}</MetaField>
            <MetaField label='TINJAUAN'>
              {doc.nextReview}
              {daysUntil(doc.nextReview) < 0 ? ' · terlambat' : ''}
            </MetaField>
            <MetaField label='KLAIM TLP'>
              {doc.tlp}
              {isGrantOnly(doc.tlp) ? ' · grant' : ''}
            </MetaField>
          </dl>
          <section className='border-b border-rail-line'>
            <h3 className='px-4 pt-2.5 pb-1.5 font-mono text-[8.5px] tracking-[.14em] text-rail-dim uppercase'>
              Bukti CSF 2.0
            </h3>
            {evidence.length ? (
              <ul className='flex flex-col'>
                {evidence.map((item) => (
                  <li key={item.id}>
                    <Link
                      to='/evidence'
                      title={`${CSF_FUNCTIONS[item.fn]} · ${item.categoryName}`}
                      className='focus-visible:outline-inset flex items-center gap-2 px-4 py-[7px] font-mono text-[10.5px] text-rail-ink hover:bg-rail-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]'
                    >
                      <span className='inline-flex h-4 w-[22px] shrink-0 items-center justify-center border border-rail-line text-[8px]'>
                        {item.fn}
                      </span>
                      {item.id}
                      <ArrowUpRight
                        aria-hidden='true'
                        className='size-[10px] shrink-0 text-rail-dim'
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='px-4 pb-2 text-[11.5px] text-rail-dim'>
                Tidak ada bukti CSF tertaut.
              </p>
            )}
          </section>
          <section className='border-b border-rail-line px-4 py-3.5'>
            <div className='flex items-center justify-between gap-2'>
              <h3 className='font-mono text-[8.5px] tracking-[.14em] text-rail-dim uppercase'>
                Batas sesi
              </h3>
              <span className='font-mono text-[10.5px] text-rail-ink tabular-nums'>
                {sessionEndLabel}
              </span>
            </div>
            <div
              className='mt-2 h-[3px] w-full bg-rail-line'
              role='progressbar'
              aria-label={
                serverSession ? 'Waktu sesi server' : 'Waktu sesi lokal'
              }
              aria-valuemin={0}
              aria-valuemax={serverSession?.ttlSeconds ?? limit ?? 0}
              aria-valuenow={
                serverSession
                  ? (remaining ?? 0)
                  : limit === null
                    ? 0
                    : (remaining ?? 0)
              }
            >
              {serverSession ? (
                <div
                  className='h-full bg-rail-ink'
                  style={{
                    width: `${serverSession.ttlSeconds > 0 ? Math.max(0, (remaining ?? 0) / serverSession.ttlSeconds) * 100 : 0}%`,
                  }}
                />
              ) : (
                limit !== null && (
                  <div
                    className='h-full bg-rail-ink'
                    style={{
                      width: `${Math.max(0, (remaining ?? 0) / limit) * 100}%`,
                    }}
                  />
                )
              )}
            </div>
            <p className='mt-2 text-[8.5px] leading-[13px] text-rail-dim'>
              {serverSession
                ? 'Server menutup sesi otomatis saat batas tercapai; angka di atas hanya pengingat.'
                : 'Batas waktu lokal — server tidak mengembalikan sesi penampil.'}
            </p>
          </section>
          <section className='border-b border-rail-line px-4 py-3.5'>
            <h3 className='font-mono text-[8.5px] tracking-[.14em] text-rail-dim uppercase'>
              Akses Anda
            </h3>
            <p className='mt-1.5 flex items-center gap-1.5 text-[11.5px] text-rail-ink'>
              <span
                className={`size-[5px] shrink-0 rounded-full ${access?.permit ? 'bg-tlp-green' : 'bg-fail'}`}
                aria-hidden='true'
              />
              {access?.reasons.join(' · ') ??
                'Keputusan akses server tidak tersedia.'}
            </p>
          </section>
        </aside>
      </div>
      <p className='viewer-print-note'>Pencetakan halaman ini diblokir.</p>
    </div>
  )
}

function MetaField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='flex flex-col gap-px border-b border-rail-line py-[7px]'>
      <dt className='font-mono text-[7.5px] tracking-[.15em] text-rail-dim uppercase'>
        {label}
      </dt>
      <dd className='text-[12px] leading-[1.4] break-words text-rail-ink'>
        {children}
      </dd>
    </div>
  )
}

function PaperMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex flex-col gap-px'>
      <dt className='font-mono text-[7.5px] tracking-[.15em] text-[color:var(--paper-mute)] uppercase'>
        {label}
      </dt>
      <dd className='font-mono text-[11px] text-[color:var(--paper-ink)]'>
        {value}
      </dd>
    </div>
  )
}

function PaperRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex flex-wrap items-center gap-2.5 border-b border-[var(--paper-line)] py-[7px]'>
      <dt className='text-[11.5px] text-[color:var(--paper-mute)]'>{label}</dt>
      <dd className='font-mono text-[11px] text-[color:var(--paper-ink)]'>
        {value}
      </dd>
    </div>
  )
}

function SessionTimer({
  remaining,
  elapsed,
}: {
  remaining: number | null
  elapsed: number
}) {
  const value = remaining === 0 ? 0 : (remaining ?? elapsed)
  const label =
    remaining === 0
      ? 'Sesi berakhir'
      : remaining === null
        ? 'Sesi berjalan'
        : 'Sisa sesi'
  return (
    <div
      role='timer'
      aria-label={label}
      className='flex h-7 shrink-0 items-center gap-[7px] border border-rail-line px-[9px]'
    >
      <Clock3 aria-hidden='true' className='size-[11px] text-rail-dim' />
      <span className='font-mono text-[8px] tracking-[.11em] text-rail-dim uppercase'>
        Sisa sesi
      </span>
      <span className='font-mono text-[11.5px] text-rail-ink tabular-nums'>
        {remaining === null
          ? '—'
          : `${pad(Math.floor(value / 60))}:${pad(value % 60)}`}
      </span>
    </div>
  )
}
