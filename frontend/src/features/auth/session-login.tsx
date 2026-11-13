import { useEffect, useRef, useState } from 'react'
import { setMe, type Me } from '@/lib/session'
import { ThemeSwitch } from '@/components/theme-switch'
import './session-login.css'

type Step = 'notice' | 'password' | 'code' | 'device' | 'welcome' | 'locked'
type CheckStatus = 'pass' | 'warn' | 'fail' | 'pending' | 'unverified'
type DeviceCheck = {
  status: CheckStatus
  ip?: string
  driftMs?: number
  note?: string
  latencyMs?: number
}
type DeviceChecks = {
  network: DeviceCheck
  code: DeviceCheck
  crypto: DeviceCheck & { status: 'pass' | 'fail' }
  clock: DeviceCheck
}
type AuthUser = {
  username: string
  rankName: string
  accessLevel: Me['accessLevel']
  unit: string | null
  unitHead: boolean
  securityOfficer: boolean
}

const labels = ['Pemberitahuan', 'Masuk', 'Kode', 'Perangkat', 'Konfirmasi']
const stepNames = ['PEMBERITAHUAN', 'MASUK', 'KODE', 'PERANGKAT', 'KONFIRMASI']
const rowNames = ['Jaringan', 'Kode autentikator', 'Modul Enkripsi', 'Jam']
const tlpLevels = [
  'CLEAR',
  'GREEN',
  'AMBER',
  'AMBER+STRICT',
  'RED',
  'RED+STRICT',
] as const
const jsonFetch = (url: string, body?: unknown) =>
  fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

function Spinner() {
  return <span className='lg-spinner' aria-hidden='true' />
}
function CheckIcon() {
  return (
    <svg className='lg-icon lg-draw' viewBox='0 0 24 24' aria-hidden='true'>
      <path d='m5 12.5 4.5 4.5L19 7.5' />
    </svg>
  )
}
function ArrowIcon() {
  return (
    <svg className='lg-arrow' viewBox='0 0 16 16' aria-hidden='true'>
      <path d='M2.8 8h9.9M8.6 3.9 12.7 8l-4.1 4.1' />
    </svg>
  )
}
function EyeIcon() {
  return (
    <svg className='lg-glyph' viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z' />
      <circle cx='12' cy='12' r='3' />
    </svg>
  )
}
function EyeOffIcon() {
  return (
    <svg className='lg-glyph' viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M3 3l18 18M10.6 6.2A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.6 7.7C3.9 9.4 2 12 2 12s4 6 10 6c1.5 0 2.9-.4 4.1-.9' />
      <path d='M9.9 9.9a3 3 0 0 0 4.2 4.2' />
    </svg>
  )
}

export function SessionLogin({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState<Step>('notice')
  const [accepted, setAccepted] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null)
  const [lockedUntil, setLockedUntil] = useState<string | null>(null)
  const [checks, setChecks] = useState<DeviceChecks | null>(null)
  const [revealed, setRevealed] = useState(0)
  const [deviceError, setDeviceError] = useState('')
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [me, setLocalMe] = useState<Me | null>(null)
  const [lastLoginAt, setLastLoginAt] = useState<string | null>(null)
  const [failedSinceLast, setFailedSinceLast] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [shaking, setShaking] = useState(false)
  const [outgoing, setOutgoing] = useState(false)
  const refocus = useRef<HTMLInputElement | null>(null)
  const firstRef = useRef<HTMLElement | HTMLInputElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const usernameRef = useRef<HTMLInputElement | null>(null)
  const codeRef = useRef<HTMLInputElement | null>(null)
  const mounted = useRef(true)
  const timers = useRef<number[]>([])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      timers.current.forEach(clearTimeout)
    }
  }, [])
  useEffect(() => {
    ;(firstRef.current ?? cardRef.current)?.focus()
  }, [step])
  useEffect(() => {
    if (!busy && refocus.current) {
      refocus.current.focus()
      refocus.current = null
    }
  }, [busy])

  const enterStep =
    step === 'notice'
      ? 0
      : step === 'password' || step === 'locked'
        ? 1
        : step === 'code'
          ? 2
          : step === 'device'
            ? 3
            : 4
  const later = (fn: () => void, delay: number) => {
    const id = window.setTimeout(() => {
      timers.current = timers.current.filter((timer) => timer !== id)
      if (mounted.current) fn()
    }, delay)
    timers.current.push(id)
    return id
  }
  const failShake = () => setShaking(true)
  const go = (next: Step) => {
    setShaking(false)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStep(next)
      return
    }
    setOutgoing(true)
    later(() => {
      setOutgoing(false)
      setStep(next)
    }, 180)
  }
  const lock = (until: string | null) => {
    setLockedUntil(until)
    setBusy(false)
    setError('')
    go('locked')
  }
  const generic = () => setError('Tidak dapat masuk. Coba lagi.')
  const handleErrorStatus = (status: number) => {
    if (status === 429)
      setError(
        'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.'
      )
    else generic()
    return false
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const res = await jsonFetch('/api/auth/login', {
        username: username.trim().toLowerCase(),
        password,
      })
      const data = (await res.json().catch(() => ({}))) as {
        step?: string
        challenge?: string
        error?: string
        attemptsLeft?: number
        lockedUntil?: string
      }
      if (res.status === 200 && data.step === 'code' && data.challenge) {
        setChallenge(data.challenge)
        setPassword('')
        setCode('')
        setAttemptsLeft(null)
        setBusy(false)
        go('code')
        return
      }
      if (res.status === 401) {
        setPassword('')
        if (data.attemptsLeft === 0) {
          lock(data.lockedUntil ?? null)
          return
        }
        setAttemptsLeft(data.attemptsLeft ?? null)
        setError(
          typeof data.attemptsLeft === 'number'
            ? `Username atau kata sandi salah. ${data.attemptsLeft} percobaan tersisa sebelum akun dikunci.`
            : 'Username atau kata sandi salah.'
        )
        refocus.current = usernameRef.current
        failShake()
        return
      }
      if (res.status === 423) {
        lock(data.lockedUntil ?? null)
        return
      }
      handleErrorStatus(res.status)
    } catch {
      generic()
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const res = await jsonFetch('/api/auth/otp', { challenge, code })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        user?: AuthUser
        lastLoginAt?: string | null
        failedSinceLast?: number
        attemptsLeft?: number
        lockedUntil?: string
      }
      if (res.status === 200 && data.ok && data.user) {
        setAuthUser(data.user)
        setLastLoginAt(data.lastLoginAt ?? null)
        setFailedSinceLast(data.failedSinceLast ?? 0)
        const meRes = await fetch('/api/me', { credentials: 'same-origin' })
        if (!meRes.ok) throw new Error('Tidak dapat memuat identitas.')
        const currentMe = (await meRes.json()) as Me
        setMe(currentMe)
        setLocalMe(currentMe)
        setBusy(false)
        go('device')
        void runDeviceCheck()
        return
      }
      if (res.status === 401) {
        setCode('')
        if (data.attemptsLeft === 0) {
          lock(data.lockedUntil ?? null)
          return
        }
        if (typeof data.attemptsLeft === 'number') {
          setAttemptsLeft(data.attemptsLeft)
          refocus.current = codeRef.current
          setError(
            `Kode tidak cocok. ${data.attemptsLeft} percobaan tersisa sebelum akun dikunci.`
          )
          failShake()
        } else {
          go('password')
          setPassword('')
          setAttemptsLeft(null)
          setError(
            'Sesi masuk kedaluwarsa. Masukkan kembali username dan kata sandi.'
          )
        }
        setBusy(false)
        return
      }
      if (res.status === 423) {
        lock(data.lockedUntil ?? null)
        return
      }
      handleErrorStatus(res.status)
    } catch {
      generic()
    } finally {
      setBusy(false)
    }
  }

  async function runDeviceCheck() {
    setDeviceError('')
    setChecks(null)
    setRevealed(0)
    try {
      const res = await fetch(
        `/api/auth/device-check?clientTime=${Date.now()}`,
        { credentials: 'same-origin' }
      )
      if (!res.ok) throw new Error()
      const data = (await res.json()) as { checks: DeviceChecks }
      setChecks(data.checks)
    } catch {
      setDeviceError(
        'Pemeriksaan perangkat gagal. Periksa koneksi lalu coba lagi.'
      )
    }
  }
  useEffect(() => {
    if (!checks) return
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    const ids = rowNames.map((_, i) =>
      window.setTimeout(
        () => mounted.current && setRevealed(i + 1),
        reduced ? 0 : 550 * (i + 1)
      )
    )
    timers.current.push(...ids)
    return () => ids.forEach(clearTimeout)
  }, [checks])

  async function cancelAndLogout() {
    setBusy(true)
    setError('')
    try {
      const res = await jsonFetch('/api/logout', {})
      if (!res.ok) throw new Error()
      if (!mounted.current) return
      setMe(null)
      setLocalMe(null)
      setAuthUser(null)
      setLastLoginAt(null)
      setFailedSinceLast(0)
      setAttemptsLeft(null)
      setLeaving(false)
      setShaking(false)
      setChecks(null)
      setRevealed(0)
      setDeviceError('')
      setAccepted(false)
      setUsername('')
      setPassword('')
      setCode('')
      setChallenge('')
      setError('')
      go('notice')
      setBusy(false)
    } catch {
      if (!mounted.current) return
      setError('Gagal keluar. Coba lagi.')
      setBusy(false)
    }
  }
  function enter() {
    if (leaving) return
    setLeaving(true)
    later(
      () => {
        window.history.replaceState(null, '', '/documents')
        onSuccess()
      },
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220
    )
  }

  const currentChecks = checks
    ? [checks.network, checks.code, checks.crypto, checks.clock]
    : []
  const hasFail = currentChecks.some((item) => item.status === 'fail')
  const allShown = revealed >= rowNames.length
  const failedNames = currentChecks
    .map((c, i) => (c.status === 'fail' ? rowNames[i] : null))
    .filter(Boolean)
    .join(', ')
  const rowValue = (item: DeviceCheck, i: number) => {
    if (item.status === 'pending') return 'Menunggu'
    if (i === 0 && item.status === 'pass')
      return `Alamat privat${item.ip ? ` (${item.ip})` : ''}`
    if (i === 0 && item.status === 'warn')
      return `Alamat publik${item.ip ? ` (${item.ip})` : ''}`
    if (i === 1 && item.status === 'pass') return 'Terverifikasi'
    if (i === 2 && item.status === 'pass')
      return `crypto-api tersedia (mTLS, ${Math.round(item.latencyMs ?? 0)} ms)`
    if (i === 2 && item.status === 'fail')
      return 'crypto-api tidak tersedia; login tidak dapat memverifikasi password'
    if (i === 3 && item.status === 'pass')
      return `Tersinkron, selisih ${Math.round(Math.abs(item.driftMs ?? 0) / 1000)} s`
    return (
      item.note ??
      (item.status === 'fail'
        ? 'Pemeriksaan gagal'
        : item.status === 'warn'
          ? 'Perlu perhatian'
          : item.status === 'unverified'
            ? 'Belum terverifikasi'
            : 'Terverifikasi')
    )
  }

  const invalid = Boolean(error) && attemptsLeft !== null

  const pill =
    step === 'notice'
      ? accepted
        ? { text: 'DISETUJUI', tone: 'pass' }
        : { text: 'BELUM DISETUJUI', tone: 'warn' }
      : step === 'password'
        ? username.trim() && password
          ? { text: 'INPUT VALID', tone: 'pass' }
          : { text: 'MENUNGGU INPUT', tone: 'muted' }
        : step === 'code'
          ? { text: 'KODE 6 DIGIT', tone: 'pass' }
          : step === 'device'
            ? !checks
              ? { text: 'MEMERIKSA', tone: 'muted' }
              : hasFail && allShown
                ? { text: 'ADA GAGAL', tone: 'fail' }
                : allShown
                  ? { text: 'SEMUA LULUS', tone: 'pass' }
                  : { text: 'MEMERIKSA', tone: 'muted' }
            : step === 'welcome'
              ? { text: 'AAL2 TERPENUHI', tone: 'pass' }
              : { text: 'TERMINAL', tone: 'fail' }

  return (
    <main className='lg-root'>
      <div className='lg-layout'>
        <section className='lg-about' aria-label='Tentang sistem'>
          <span className='lg-scanline' aria-hidden='true' />
          <div className='lg-brand-row lg-in'>
            <div className='lg-brand'>
              <span className='lg-mark' aria-hidden='true'>
                AR
              </span>
              <div className='lg-brand-name'>ARCA</div>
            </div>
            <div className='lg-org'>TNI-AD · DOKUMEN OPERASIONAL</div>
            <div className='lg-org'>Secure Asset Document Management · TPM 2.0 · Cryptographic Key Protection</div>
          </div>
          <div className='lg-hero lg-in2'>
            <div className='lg-eyebrow'>KENDALI AKSES DOKUMEN / AAL2</div>
            <h1>
              Masuk ke
              <br />
              ARCA
            </h1>
            <p className='lg-sub'>
              Mengamankan dokumen operasional TNI-AD. Akses ditentukan untuk
              setiap dokumen. Nama yang tercantum dalam dokumen RED yang
              memberikan akses, bukan pangkat.
            </p>
            <dl className='lg-facts'>
              {[
                ['FAKTOR', 'Kata sandi + kode autentikator'],
                ['JAMINAN', 'AAL2 · SP 800-63B'],
                ['KUNCI', 'MSK tersegel di TPM 2.0'],
                ['SESI', 'Idle 5 mnt · batas 30 mnt'],
              ].map(([title, value]) => (
                <div className='lg-fact' key={title}>
                  <dt>{title}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className='lg-tlp-block'>
              <div className='lg-tlp-label'>
                SKALA TLP — HAK BACA DITENTUKAN PER DOKUMEN
              </div>
              <div className='lg-tlp-scale' role='list' aria-label='Skala TLP'>
                {tlpLevels.map((level) => (
                  <div
                    className='lg-tlp-item'
                    role='listitem'
                    key={level}
                    aria-current={me?.tlpMax === level ? 'true' : undefined}
                  >
                    <i className='lg-tlp-bar' aria-hidden='true' />
                    <span>{level}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className='lg-footer lg-in3'>
            <div className='lg-help'>
              Bantuan teknis:{' '}
              <a
                href='https://github.com/skadut'
                target='_blank'
                rel='noopener noreferrer'
                className='underline'
              >
                github.com/skadut
              </a>
              <br />
              <span>Dikembangkan oleh Aeru Team</span>
            </div>
            <div className='lg-stamp'>SP 800-53 REV.5 / FIPS 199</div>
          </div>
        </section>
        <section className='lg-main' aria-label='Masuk'>
          <span className='lg-scanline' aria-hidden='true' />
          <div className='lg-column lg-in'>
            <div className='lg-sessionbar'>
              <span>SESI MASUK</span>
              <ThemeSwitch />
            </div>
            <div
              ref={cardRef}
              tabIndex={-1}
              className={shaking ? 'lg-card lg-shake-a' : 'lg-card'}
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget) setShaking(false)
              }}
              key={step}
            >
              <div className='lg-card-head'>
                <span className='lg-card-head-label'>
                  <b>
                    {step === 'locked'
                      ? 'LOCKED'
                      : String(enterStep + 1).padStart(2, '0')}
                  </b>
                  <span>
                    {step === 'locked'
                      ? 'TERKUNCI · 423'
                      : stepNames[enterStep]}
                  </span>
                </span>
                <span className={`lg-pill ${pill.tone}`}>
                  <i aria-hidden='true' />
                  {pill.text}
                </span>
              </div>
              <div className='lg-progress'>
                <div className='lg-bars' aria-hidden='true'>
                  {labels.map((_, i) => (
                    <i
                      key={i}
                      className={
                        i < enterStep ? 'done' : i === enterStep ? 'now' : ''
                      }
                    />
                  ))}
                </div>
                <div className='lg-nums' aria-hidden='true'>
                  {labels.map((_, i) => (
                    <b key={i} className={i === enterStep ? 'now' : ''}>
                      {String(i + 1).padStart(2, '0')}
                    </b>
                  ))}
                </div>
              </div>
              <ol className='lg-sr-only' aria-label='Tahapan masuk'>
                {labels.map((label, i) => (
                  <li
                    key={label}
                    aria-current={i === enterStep ? 'step' : undefined}
                    className={`${i < enterStep ? 'done' : i === enterStep ? 'current' : ''} ${step === 'locked' && i === 1 ? 'locked' : ''}`}
                  >
                    {label}
                  </li>
                ))}
              </ol>
              <div
                className={
                  outgoing || leaving ? 'lg-step lg-step-out' : 'lg-step'
                }
                inert={outgoing || leaving}
              >
                {step === 'notice' && (
                  <div className='lg-stack'>
                    <header>
                      <div className='lg-eyebrow'>TAHAP 1 DARI 5</div>
                      <h2>Pemberitahuan penggunaan sistem</h2>
                    </header>
                    <div className='lg-notice'>
                      <p>
                        Anda mengakses sistem terbatas milik Arasaka
                        Corporation. Penggunaan hanya untuk pengguna berwenang
                        dan keperluan resmi.
                      </p>
                      <p>
                        Semua aktivitas dipantau dan dicatat, termasuk setiap
                        keputusan akses dan setiap percobaan gagal.
                      </p>
                    </div>
                    <label className='lg-consent'>
                      <input
                        ref={(node) => {
                          if (step === 'notice') firstRef.current = node
                        }}
                        type='checkbox'
                        checked={accepted}
                        onChange={(e) => setAccepted(e.target.checked)}
                      />
                      <span>
                        Saya telah membaca pemberitahuan ini dan menyetujui
                        pemantauan.
                      </span>
                    </label>
                    <button
                      className='lg-primary'
                      disabled={!accepted || busy}
                      onClick={() => go('password')}
                    >
                      <span>Lanjutkan</span>
                      {accepted ? (
                        <ArrowIcon />
                      ) : (
                        <span className='lg-primary-hint'>
                          TERKUNCI SAMPAI DISETUJUI
                        </span>
                      )}
                    </button>
                  </div>
                )}
                {step === 'password' && (
                  <div className='lg-stack'>
                    <header>
                      <div className='lg-eyebrow'>TAHAP 2 DARI 5</div>
                      <h2>Masuk</h2>
                      <p>
                        Kredensial dinas diverifikasi, lalu kode autentikator
                        diminta pada tahap berikutnya.
                      </p>
                    </header>
                    {error && (
                      <div id='lg-alert' role='alert' className='lg-error'>
                        {error}
                      </div>
                    )}
                    <form
                      className='lg-stack lg-form'
                      onSubmit={submitPassword}
                    >
                      <div>
                        <label htmlFor='lg-username'>Nama pengguna</label>
                        <input
                          ref={(node) => {
                            usernameRef.current = node
                            if (step === 'password') firstRef.current = node
                          }}
                          id='lg-username'
                          autoComplete='username'
                          spellCheck={false}
                          value={username}
                          onChange={(e) => {
                            setUsername(e.target.value.slice(0, 64))
                            setError('')
                          }}
                          className={invalid ? 'invalid' : undefined}
                          aria-invalid={invalid || undefined}
                          aria-describedby={invalid ? 'lg-alert' : undefined}
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor='lg-password'>Kata sandi</label>
                        <div className='lg-password-row'>
                          <input
                            id='lg-password'
                            type={showPassword ? 'text' : 'password'}
                            autoComplete='current-password'
                            value={password}
                            onChange={(e) => {
                              setPassword(e.target.value.slice(0, 128))
                              setError('')
                            }}
                            className={invalid ? 'invalid' : undefined}
                            aria-invalid={invalid || undefined}
                            aria-describedby={invalid ? 'lg-alert' : undefined}
                            required
                          />
                          <button
                            type='button'
                            className='lg-toggle'
                            aria-label={
                              showPassword
                                ? 'Sembunyikan kata sandi'
                                : 'Tampilkan kata sandi'
                            }
                            aria-pressed={showPassword}
                            onClick={() => setShowPassword((v) => !v)}
                          >
                            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                          </button>
                        </div>
                      </div>
                      <div className='lg-meta'>
                        <span>
                          {attemptsLeft !== null
                            ? `${attemptsLeft} percobaan tersisa sebelum akun dikunci`
                            : 'Akun dikunci 15 menit setelah 5 percobaan gagal'}
                        </span>
                      </div>
                      <button
                        className='lg-primary'
                        type='submit'
                        disabled={busy || !username.trim() || !password}
                        aria-busy={busy}
                      >
                        {busy && <Spinner />}
                        <span>{busy ? 'Memeriksa' : 'Lanjutkan'}</span>
                        <ArrowIcon />
                      </button>
                    </form>
                    <button
                      className='lg-ghost'
                      type='button'
                      disabled={busy}
                      onClick={() => {
                        setError('')
                        setPassword('')
                        go('notice')
                      }}
                    >
                      Kembali
                    </button>
                  </div>
                )}
                {step === 'code' && (
                  <div className='lg-stack'>
                    <header>
                      <div className='lg-eyebrow'>TAHAP 3 DARI 5</div>
                      <h2>Masukkan kode autentikator</h2>
                    </header>
                    <div className='lg-who'>
                      <span className='lg-mono'>{username}</span>
                      <span>30 detik per kode</span>
                    </div>
                    <div className='lg-ring-row'>
                      <svg
                        viewBox='0 0 36 36'
                        role='img'
                        aria-label='Hitung mundur kode'
                      >
                        <circle cx='18' cy='18' r='16' className='track' />
                        <circle cx='18' cy='18' r='16' className='lg-totp' />
                      </svg>
                    </div>
                    {error && (
                      <div id='lg-alert' role='alert' className='lg-error'>
                        {error}
                      </div>
                    )}
                    <form className='lg-stack lg-form' onSubmit={submitCode}>
                      <div>
                        <label htmlFor='lg-code'>Kode 6 digit</label>
                        <input
                          ref={(node) => {
                            codeRef.current = node
                            if (step === 'code') firstRef.current = node
                          }}
                          id='lg-code'
                          inputMode='numeric'
                          autoComplete='one-time-code'
                          maxLength={6}
                          value={code}
                          onChange={(e) => {
                            setCode(
                              e.target.value.replace(/\D/g, '').slice(0, 6)
                            )
                            setError('')
                          }}
                          placeholder='······'
                          className={invalid ? 'invalid' : undefined}
                          aria-invalid={invalid || undefined}
                          aria-describedby={invalid ? 'lg-alert' : undefined}
                          required
                        />
                      </div>
                      <button
                        className='lg-primary'
                        type='submit'
                        disabled={busy || code.length !== 6}
                        aria-busy={busy}
                      >
                        {busy && <Spinner />}
                        <span>
                          {busy ? 'Memverifikasi' : 'Verifikasi kode'}
                        </span>
                        <ArrowIcon />
                      </button>
                    </form>
                    <button
                      className='lg-ghost'
                      type='button'
                      disabled={busy}
                      onClick={() => {
                        go('password')
                        setPassword('')
                        setCode('')
                        setChallenge('')
                        setError('')
                      }}
                    >
                      Kembali
                    </button>
                    <button
                      className='lg-ghost'
                      type='button'
                      onClick={() => {
                        go('password')
                        setPassword('')
                        setCode('')
                        setChallenge('')
                        setError('')
                        setUsername('')
                      }}
                    >
                      Masuk sebagai orang lain
                    </button>
                  </div>
                )}
                {step === 'device' && (
                  <div className='lg-stack'>
                    <header>
                      <div className='lg-eyebrow'>TAHAP 4 DARI 5</div>
                      <h2>Memeriksa perangkat ini</h2>
                    </header>
                    {deviceError && (
                      <div role='alert' className='lg-error'>
                        {deviceError}
                      </div>
                    )}
                    <div
                      className='lg-check-list'
                      role='status'
                      aria-live='polite'
                    >
                      {rowNames.map((name, i) => {
                        const item = currentChecks[i]
                        const shown = i < revealed
                        const isLoading = checks
                          ? i === revealed && !allShown
                          : i === 0 && !deviceError
                        const tone = shown ? (item?.status ?? '') : ''
                        return (
                          <div
                            className={
                              shown ? 'lg-check-row lg-row' : 'lg-check-row'
                            }
                            key={name}
                          >
                            <span className={`lg-check-mark ${tone}`}>
                              {isLoading ? (
                                <Spinner />
                              ) : item?.status === 'pass' ? (
                                <CheckIcon />
                              ) : (
                                <span className='lg-neutral-dot' />
                              )}
                            </span>
                            <span className='lg-check-copy'>
                              <span>{name}</span>
                              {shown && (
                                <span className='lg-check-desc'>
                                  {rowValue(item!, i)}
                                </span>
                              )}
                            </span>
                            <span className={`lg-check-status ${tone}`}>
                              {isLoading
                                ? 'MEMERIKSA'
                                : shown
                                  ? item?.status === 'pass'
                                    ? 'LULUS'
                                    : item?.status === 'warn'
                                      ? 'PERHATIAN'
                                      : item?.status === 'fail'
                                        ? 'GAGAL'
                                        : 'BELUM TERVERIFIKASI'
                                  : 'MENUNGGU'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    {hasFail && allShown && (
                      <>
                        <div role='alert' className='lg-error'>
                          Pemeriksaan gagal: {failedNames}. Hubungi petugas
                          keamanan.
                        </div>
                        <button
                          className='lg-ghost'
                          type='button'
                          onClick={() => void runDeviceCheck()}
                        >
                          Coba lagi
                        </button>
                        <button
                          className='lg-ghost'
                          type='button'
                          onClick={() => void cancelAndLogout()}
                        >
                          Batal dan keluar
                        </button>
                      </>
                    )}
                    {deviceError ? (
                      <button
                        className='lg-ghost'
                        type='button'
                        onClick={() => void runDeviceCheck()}
                      >
                        Coba lagi
                      </button>
                    ) : hasFail && allShown ? null : (
                      <button
                        className='lg-primary'
                        type='button'
                        disabled={!allShown || hasFail}
                        onClick={() => go('welcome')}
                      >
                        <span>Lanjutkan</span>
                        <ArrowIcon />
                      </button>
                    )}
                  </div>
                )}
                {step === 'welcome' && (
                  <div className='lg-stack'>
                    <header>
                      <div className='lg-eyebrow'>TAHAP 5 DARI 5</div>
                      <h2>Identitas terverifikasi</h2>
                    </header>
                    <div className='lg-verified'>
                      <span className='lg-check-mark pass'>
                        <CheckIcon />
                      </span>
                      <div>
                        <strong>Password, kode, dan perangkat lulus</strong>
                        <span>Sesi 30 menit · idle 5 menit</span>
                      </div>
                    </div>
                    <div className='lg-details'>
                      <div>
                        <small>NAMA</small>
                        <div>{me?.name ?? authUser?.username}</div>
                      </div>
                      <div>
                        <small>PERAN</small>
                        <div>
                          {me?.rankName ?? authUser?.rankName}
                          {(me?.unit ?? authUser?.unit)
                            ? ` · ${me?.unit ?? authUser?.unit}`
                            : ''}
                        </div>
                      </div>
                      <div>
                        <small>MASUK SEBELUMNYA</small>
                        <div>
                          {lastLoginAt
                            ? new Date(lastLoginAt).toLocaleString('id-ID')
                            : 'Ini adalah masuk pertama Anda'}
                        </div>
                      </div>
                    </div>
                    {failedSinceLast > 0 && (
                      <p className='lg-warning'>
                        {failedSinceLast} percobaan gagal sejak masuk terakhir.
                        Jika bukan Anda, laporkan kepada petugas keamanan.
                      </p>
                    )}
                    <button
                      className='lg-primary'
                      type='button'
                      onClick={enter}
                      disabled={leaving}
                    >
                      <span>
                        {leaving ? 'Membuka' : 'Masuk ke ARCA'}
                      </span>
                      <ArrowIcon />
                    </button>
                    <button
                      className='lg-ghost'
                      type='button'
                      onClick={() => void cancelAndLogout()}
                      disabled={busy}
                    >
                      {busy ? 'Memeriksa' : 'Batal dan keluar'}
                    </button>
                  </div>
                )}
                {step === 'locked' && (
                  <div className='lg-locked' role='alert'>
                    <div className='lg-lock-mark' aria-hidden='true'>
                      !
                    </div>
                    <h2>Akun dikunci</h2>
                    <p>
                      Terlalu banyak percobaan gagal. Akun ini dikunci selama 15
                      menit. Percobaan telah dicatat.
                    </p>
                    {lockedUntil && (
                      <p className='lg-lock-when'>
                        Akun dapat digunakan kembali
                        <br />
                        {new Date(lockedUntil).toLocaleString('id-ID')}
                      </p>
                    )}
                    <p className='lg-lock-call'>
                      Bantuan teknis:{' '}
                      <a
                        href='https://github.com/skadut'
                        target='_blank'
                        rel='noopener noreferrer'
                        className='underline'
                      >
                        github.com/skadut
                      </a>
                    </p>
                    <div className='lg-lock-noaction'>
                      TIDAK ADA AKSI PEMULIHAN DI UI
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className='lg-session-note'>
              Sesi terkunci setelah 5 menit tanpa aktivitas dan berakhir setelah
              30 menit.
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
