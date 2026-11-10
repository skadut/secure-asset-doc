import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { DbError, useDbTable, useDbTables } from './use-database'

const LIMIT = 50
const touchClass = 'min-h-11 min-w-11'

// Non-null values as text. Objects go through JSON.stringify.
const cellText = (v: unknown) =>
  typeof v === 'object' ? JSON.stringify(v) : String(v)

function ErrorAlert({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  if (error instanceof DbError && error.status === 403) {
    return (
      <Alert variant='destructive' role='alert'>
        <TriangleAlert />
        <AlertTitle>Hanya super admin</AlertTitle>
      </Alert>
    )
  }
  return (
    <Alert variant='destructive' role='alert'>
      <TriangleAlert />
      <AlertTitle>Gagal memuat data</AlertTitle>
      <AlertDescription>
        <Button variant='outline' className={touchClass} onClick={onRetry}>
          Coba lagi
        </Button>
      </AlertDescription>
    </Alert>
  )
}

export function DatabaseView() {
  const tables = useDbTables()
  const [picked, setPicked] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const list = tables.data?.tables ?? []
  const name = picked ?? list[0]?.name ?? ''
  const detail = useDbTable(name, LIMIT, offset)
  const data = detail.data
  const total = data?.total ?? 0
  const from = offset + 1
  const to = Math.min(offset + (data?.rows.length ?? 0), total)

  const choose = (n: string) => {
    setPicked(n)
    setOffset(0)
  }

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='focus-strong flex flex-1 flex-col gap-6'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>Database view</h1>
          <p className='text-muted-foreground'>
            Tampilan baca-saja tabel PostgreSQL untuk PoC.
          </p>
        </div>

        {tables.isPending && <Skeleton className='h-[400px] w-full' />}
        {tables.isError && (
          <ErrorAlert
            error={tables.error}
            onRetry={() => void tables.refetch()}
          />
        )}

        {tables.data && list.length === 0 && (
          <p className='text-muted-foreground'>Tidak ada tabel.</p>
        )}

        {tables.data && list.length > 0 && (
          <>
            <div className='flex flex-col gap-2'>
              <span className='text-sm font-medium'>Tabel</span>
              <Select value={name} onValueChange={choose}>
                <SelectTrigger
                  className='h-11 w-full sm:w-80'
                  aria-label='Pilih tabel'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {list.map((t) => (
                    <SelectItem key={t.name} value={t.name}>
                      {`${t.name} (${t.rowCount})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {detail.isError && (
              <ErrorAlert
                error={detail.error}
                onRetry={() => void detail.refetch()}
              />
            )}
            {detail.isPending && !detail.isError && (
              <Skeleton className='h-64 w-full' />
            )}

            {data && total === 0 && (
              <p className='text-muted-foreground'>Tidak ada baris</p>
            )}

            {data && total > 0 && (
              <>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <p className='text-sm tabular-nums'>
                    {`baris ${from}–${to} dari ${total}`}
                  </p>
                  <div className='flex gap-2'>
                    <Button
                      variant='outline'
                      className={touchClass}
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                    >
                      Sebelumnya
                    </Button>
                    <Button
                      variant='outline'
                      className={touchClass}
                      disabled={offset + LIMIT >= total}
                      onClick={() => setOffset(offset + LIMIT)}
                    >
                      Berikutnya
                    </Button>
                  </div>
                </div>

                <div className='overflow-x-auto rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {data.columns.map((c) => (
                          <TableHead
                            key={c.name}
                            className='px-1.5 whitespace-nowrap'
                          >
                            <span className='font-mono'>{c.name}</span>
                            <span className='block text-xs font-normal text-muted-foreground'>
                              {c.type}
                            </span>
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rows.map((row, i) => (
                        <TableRow key={offset + i}>
                          {data.columns.map((c, j) => {
                            const v = row[j]
                            return (
                              <TableCell
                                key={c.name}
                                className='px-1.5 font-mono'
                              >
                                {v === null || v === undefined ? (
                                  <span className='text-muted-foreground'>
                                    NULL
                                  </span>
                                ) : (
                                  cellText(v)
                                )}
                              </TableCell>
                            )
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </>
        )}
      </Main>
    </>
  )
}
