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
const rowNames = ['Jaringan', 'Kode autentikator', 'Layanan kripto', 'Jam']
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
    <svg className='lg-glyph' viewBox='0 0 24 24' aria-hidden='true'>
      <path d='M5 12h14M13 6l6 6-6 6' />
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
    setStep(next)
    setShaking(false)
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
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700
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
      return `Di dalam jaringan terisolasi${item.ip ? ` (${item.ip})` : ''}`
    if (i === 0 && item.status === 'warn')
      return `Di luar jaringan enclave${item.ip ? ` (${item.ip})` : ''}`
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

  return (
    <main className={`lg-root${leaving ? 'lg-leave' : ''}`}>
      <div className='lg-layout'>
        <section className='lg-about' aria-label='Tentang sistem'>
          <div className='lg-scan' aria-hidden='true' />
          <div className='lg-brand lg-in'>
            <svg className='lg-shield' viewBox='0 0 24 24' aria-hidden='true'>
              <path d='M12 3 20 6v6c0 4.5-3.2 7.6-8 9-4.8-1.4-8-4.5-8-9V6z' />
              <path d='M9 11h6M9 14.5h6' />
            </svg>
            <div>
              <div className='lg-brand-name'>Secure Asset Doc</div>
              <div className='lg-muted lg-brand-sub'>
                Manajemen dokumen terkendali
              </div>
            </div>
          </div>
          <div className='lg-intro lg-in2'>
            <h1>Masuk ke Secure Asset Doc</h1>
            <p>
              Akses ditentukan untuk setiap dokumen. Nama yang tercantum dalam
              dokumen RED yang memberikan akses, bukan pangkat.
            </p>
          </div>
          <div className='lg-facts lg-in3'>
            {[
              ['Faktor', 'Kata sandi, kode autentikator'],
              ['Jaminan', 'AAL2, SP 800-63B'],
              ['Enclave', 'ENC-2, jaringan terisolasi'],
              ['Sesi', 'Kunci idle 5 mnt, batas 30 mnt'],
            ].map(([title, value]) => (
              <div className='lg-fact' key={title}>
                <div className='lg-muted lg-fact-label'>{title}</div>
                <div className='lg-mono'>{value}</div>
              </div>
            ))}
          </div>
          <div className='lg-help'>
            Terkunci atau kehilangan autentikator: petugas keamanan sistem,
            [EKSTENSI TELEPON]
          </div>
        </section>
        <section className='lg-main' aria-label='Masuk'>
          <div className='lg-column lg-in'>
            <div className='lg-toolbar'>
              <ThemeSwitch />
            </div>
            <ol className='lg-progress' aria-label='Tahapan masuk'>
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
              ref={cardRef}
              tabIndex={-1}
              className={shaking ? 'lg-card lg-shake-a' : 'lg-card'}
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget) setShaking(false)
              }}
              key={step}
            >
              <div className='lg-step'>
                {step === 'notice' && (
                  <div className='lg-stack'>
                    <header>
                      <div className='lg-eyebrow'>Tahap 1 dari 5</div>
                      <h2>Pemberitahuan penggunaan sistem</h2>
                    </header>
                    <div className='lg-notice'>
                      <p>
                        Anda mengakses sistem terbatas milik Arasaka Corporation.
                        Penggunaan hanya untuk pengguna berwenang dan keperluan
                        resmi.
                      </p>
                      <p>
                        Semua aktivitas dipantau dan dicatat, termasuk setiap
                        keputusan akses dan setiap percobaan gagal. Catatan
                        dapat ditinjau untuk keperluan keamanan, audit, dan
                        hukum.
                      </p>
                      <p>
                        Upaya mengakses dokumen yang tidak mencantumkan nama
                        Anda dapat berujung pada tindakan disipliner atau hukum.
                        [TEKS HUKUM DARI ORGANISASI]
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
                      Lanjutkan
                    </button>
                  </div>
                )}
                {step === 'password' && (
                  <div className='lg-stack'>
                    <header>
                      <div className='lg-eyebrow'>Tahap 2 dari 5</div>
                      <h2>Masuk</h2>
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
                      <button
                        className='lg-primary'
                        type='submit'
                        disabled={busy || !username.trim() || !password}
                        aria-busy={busy}
                      >
                        {busy && <Spinner />}
                        {busy ? 'Memeriksa' : 'Lanjutkan'}
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
                      <div className='lg-eyebrow'>Tahap 3 dari 5</div>
                      <h2>Masukkan kode autentikator</h2>
                      <p>
                        Buka Google Authenticator pada telepon terdaftar, lalu
                        masukkan kode 6 digit untuk Secure Asset Doc.
                      </p>
                    </header>
                    <div className='lg-account'>
                      <svg
                        viewBox='0 0 36 36'
                        role='img'
                        aria-label='Hitung mundur kode'
                      >
                        <circle cx='18' cy='18' r='16' className='track' />
                        <circle cx='18' cy='18' r='16' className='lg-totp' />
                      </svg>
                      <div className='lg-account-caption'>
                        <div className='lg-mono lg-account-name'>
                          {username}
                        </div>
                        <div className='lg-muted'>
                          Kode berubah setiap 30 detik
                        </div>
                      </div>
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
                          className={`lg-code-input${invalid ? 'invalid' : ''}`}
                          aria-invalid={invalid || undefined}
                          aria-describedby={invalid ? 'lg-alert' : undefined}
                          required
                        />
                      </div>
                      <div className='lg-dots' aria-hidden='true'>
                        {Array.from({ length: 6 }, (_, i) => (
                          <span
                            key={i}
                            className={i < code.length ? 'filled' : ''}
                          />
                        ))}
                      </div>
                      <button
                        className='lg-primary'
                        type='submit'
                        disabled={busy || code.length !== 6}
                        aria-busy={busy}
                      >
                        {busy && <Spinner />}
                        {busy ? 'Memverifikasi' : 'Verifikasi kode'}
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
                      <div className='lg-eyebrow'>Tahap 4 dari 5</div>
                      <h2>Memeriksa perangkat ini</h2>
                      <p>
                        Masuk hanya diizinkan dari perangkat terdaftar di dalam
                        enclave.
                      </p>
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
                        return (
                          <div
                            className={`lg-check-row${shown ? 'lg-row' : ''}`}
                            key={name}
                          >
                            <span
                              className={`lg-check-mark ${shown ? (item?.status ?? '') : ''}`}
                            >
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
                                <span className='lg-muted'>
                                  {rowValue(item!, i)}
                                </span>
                              )}
                            </span>
                            <span
                              className={`lg-check-status ${shown ? (item?.status ?? '') : ''}`}
                            >
                              {isLoading
                                ? 'Memeriksa'
                                : shown
                                  ? item?.status === 'pass'
                                    ? 'Lulus'
                                    : item?.status === 'warn'
                                      ? 'Perhatian'
                                      : item?.status === 'fail'
                                        ? 'Gagal'
                                        : 'Belum terverifikasi'
                                  : 'Menunggu'}
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
                        Lanjutkan
                      </button>
                    )}
                  </div>
                )}
                {step === 'welcome' && (
                  <div className='lg-stack'>
                    <header>
                      <div className='lg-eyebrow'>Tahap 5 dari 5</div>
                      <h2>Identitas terverifikasi</h2>
                    </header>
                    <div className='lg-verified'>
                      <CheckIcon />
                      <div>
                        <strong>Identitas terverifikasi</strong>
                        <span>
                          Password, kode autentikator, dan perangkat telah lulus
                          pemeriksaan.
                        </span>
                      </div>
                    </div>
                    <div className='lg-details'>
                      <div>
                        <small>Nama</small>
                        <div>{me?.name ?? authUser?.username}</div>
                      </div>
                      <div>
                        <small>Peran</small>
                        <div>
                          {me?.rankName ?? authUser?.rankName}
                          {(me?.unit ?? authUser?.unit)
                            ? ` · ${me?.unit ?? authUser?.unit}`
                            : ''}
                        </div>
                      </div>
                      <div>
                        <small>Masuk sebelumnya</small>
                        <div>
                          {lastLoginAt
                            ? new Date(lastLoginAt).toLocaleString('id-ID')
                            : 'Ini adalah masuk pertama Anda'}
                        </div>
                      </div>
                      <div>
                        <small>Percobaan gagal sejak saat itu</small>
                        <div className='lg-mono'>{failedSinceLast}</div>
                      </div>
                    </div>
                    <p
                      className={failedSinceLast > 0 ? 'lg-warning' : 'lg-note'}
                    >
                      Jika percobaan masuk ini bukan dari Anda, segera laporkan
                      kepada petugas keamanan.
                    </p>
                    <div className='lg-session-note'>
                      Sesi terkunci setelah 5 menit tanpa aktivitas dan berakhir
                      setelah 30 menit.
                    </div>
                    <button
                      className='lg-primary'
                      type='button'
                      onClick={enter}
                      disabled={leaving}
                    >
                      {leaving ? 'Membuka' : 'Masuk ke Secure Asset Doc'}
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
                    <svg
                      className='lg-lock-icon'
                      viewBox='0 0 24 24'
                      aria-hidden='true'
                    >
                      <rect x='5' y='11' width='14' height='9' rx='1' />
                      <path d='M8 11V8a4 4 0 0 1 8 0v3' />
                    </svg>
                    <h2>Akun dikunci</h2>
                    <p>
                      Terlalu banyak percobaan gagal. Akun ini dikunci selama 15
                      menit. Percobaan telah dicatat. Jika bukan Anda, segera
                      hubungi petugas keamanan.
                    </p>
                    {lockedUntil && (
                      <p>
                        Akun dapat digunakan kembali:{' '}
                        {new Date(lockedUntil).toLocaleString('id-ID')}
                      </p>
                    )}
                    <p>Petugas keamanan sistem: [EKSTENSI TELEPON]</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
