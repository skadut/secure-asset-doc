import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { KeyRound } from 'lucide-react'
import { ApiError, listUsers } from '@/lib/access-api'
import { getMe } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { documentsKey, listDocuments, usersKey } from './api'
import { AccessPanel } from './components/access-matrix'
import { AccessTester } from './components/access-tester'
import './operation.css'

export function Operation() {
  const me = getMe()
  const allowed = me?.accessLevel === 5 || me?.securityOfficer === true
  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='focus-strong flex min-w-0 flex-1 flex-col gap-4 sm:gap-6'>
        <header className='flex min-w-0 flex-wrap items-end justify-between gap-4'>
          <div className='min-w-0'>
            <p className='mb-1 font-mono text-[9px] uppercase tracking-[.14em] text-ink-3'>
              Grant per dokumen · khusus level 5
            </p>
            <h1 className='page-title tracking-tight'>Akses operasi</h1>
          </div>
          {allowed && (
            <div className='ms-auto flex flex-wrap items-center justify-end gap-3'>
              <span className='font-mono text-[9px] uppercase tracking-[.08em] text-ink-3'>
                Grant baru lewat otorisasi ganda
              </span>
              <Button variant='outline' asChild>
                <Link to='/requests'>
                  <KeyRound aria-hidden='true' />
                  Buka otorisasi ganda
                </Link>
              </Button>
            </div>
          )}
        </header>
        {allowed ? (
          <OperationContent />
        ) : (
          <p className='text-muted-foreground'>Tidak diizinkan</p>
        )}
      </Main>
    </>
  )
}

function OperationContent() {
  const users = useQuery({
    queryKey: usersKey,
    queryFn: listUsers,
    retry: false,
  })
  const docs = useQuery({
    queryKey: documentsKey,
    queryFn: listDocuments,
    retry: false,
  })

  if (users.isError) return <p role='alert'>{errorText(users.error)}</p>
  if (docs.isError) return <p role='alert'>{errorText(docs.error)}</p>
  if (!users.data || !docs.data)
    return (
      <p role='status' className='text-muted-foreground'>
        Memuat...
      </p>
    )
  if (docs.data.length === 0)
    return (
      <p className='text-muted-foreground'>
        Belum ada dokumen yang dapat dikelola
      </p>
    )
  if (users.data.length === 0)
    return <p className='text-muted-foreground'>Belum ada pengguna</p>

  return (
    <div className='grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,.8fr)_minmax(0,1.5fr)_minmax(0,1fr)]'>
      <AccessPanel users={users.data} docs={docs.data} />
      <AccessTester users={users.data} docs={docs.data} />
    </div>
  )
}

const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Gagal memuat'
