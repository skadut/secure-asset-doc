import { useQuery } from '@tanstack/react-query'
import { ApiError, listUsers } from '@/lib/access-api'
import { getMe } from '@/lib/session'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { documentsKey, listDocuments, usersKey } from './api'
import { AccessPanel } from './components/access-matrix'
import { AccessTester } from './components/access-tester'

export function Operation() {
  const allowed = getMe()?.accessLevel === 5
  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='focus-strong flex min-w-0 flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h1 className='page-title tracking-tight'>Akses operasi</h1>
          {allowed && (
            <p className='text-muted-foreground'>
              Pilih satu dokumen, lalu lihat dan atur akses setiap pengguna ke
              dokumen itu.
            </p>
          )}
        </div>
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
    <>
      <AccessPanel users={users.data} docs={docs.data} />
      <AccessTester users={users.data} docs={docs.data} />
    </>
  )
}

const errorText = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Gagal memuat'
