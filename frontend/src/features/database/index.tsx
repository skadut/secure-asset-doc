import { useState } from 'react'
import { RefreshCw, Scissors, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CardPanel } from '@/components/card-panel'
import { Chip } from '@/components/chip'
import { ConfigDrawer } from '@/components/config-drawer'
import { EmptyState } from '@/components/empty-state'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { PageHead } from '@/components/page-head'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { SkeletonRows } from '@/components/skeleton-rows'
import { ThemeSwitch } from '@/components/theme-switch'
import { DbError, useDbTable, useDbTables } from './use-database'

const LIMIT = 50
const CELL_LIMIT = 300 // must match MAX_CELL in backend/dbview.mjs
const touchClass = 'min-h-11 min-w-11 max-sm:min-h-11'
const formatCount = (value: number) => value.toLocaleString('id-ID')

// Credential material only. Ciphertext, hashes and integrity tags stay visible: the view shows data at rest.
const SENSITIVE = /password|totp|secret/i
const isSensitive = (name: string) => SENSITIVE.test(name)

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
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + (data?.rows.length ?? 0), total)

  const choose = (n: string) => {
    setPicked(n)
    setOffset(0)
  }

  const refresh = async () => {
    try {
      await Promise.all([tables.refetch(), detail.refetch()])
      toast.success('Tabel dimuat ulang (READ ONLY)')
    } catch {
      toast.error('Gagal memuat ulang')
    }
  }

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4'>
        <PageHead
          title='Database view'
          eyebrow='SUPER ADMIN · TRANSAKSI READ ONLY'
          note={`SCHEMA PUBLIC · SEL DIPOTONG ${CELL_LIMIT} KARAKTER`}
          actions={
            <div className='flex items-center gap-2'>
              <Chip tone='line'>SUPER ADMIN</Chip>
              <Button
                variant='outline'
                className='h-9 gap-1.5 bg-surface px-3.5 font-mono text-[10px] tracking-[.04em] text-ink max-sm:min-h-11'
                onClick={() => void refresh()}
                disabled={tables.isFetching || detail.isFetching}
              >
                <RefreshCw aria-hidden='true' className='size-3.5' />
                Muat ulang
              </Button>
            </div>
          }
        />

        <div className='grid min-w-0 flex-1 items-stretch gap-3.5 lg:grid-cols-[288px_minmax(0,1fr)]'>
          <CardPanel
            title='TABEL'
            actions={
              tables.data ? (
                <span className='font-mono text-[8.5px] text-ink-3 tabular-nums'>
                  {formatCount(list.length)}
                </span>
              ) : undefined
            }
            className='flex min-w-0 flex-col'
          >
            <div className='max-h-[60vh] overflow-auto lg:max-h-none lg:flex-1'>
              {tables.isPending && <SkeletonRows rows={6} cols={2} />}
              {tables.isError && (
                <div className='p-3'>
                  <ErrorAlert
                    error={tables.error}
                    onRetry={() => void tables.refetch()}
                  />
                </div>
              )}
              {tables.data && list.length === 0 && (
                <p className='px-3 py-4 text-[11px] text-ink-2'>
                  Tidak ada tabel.
                </p>
              )}
              {list.map((t) => {
                const selected = t.name === name
                return (
                  <button
                    key={t.name}
                    type='button'
                    onClick={() => choose(t.name)}
                    aria-current={selected ? 'true' : undefined}
                    className={`flex min-h-9 w-full items-center justify-between gap-2 border-b border-line px-3 text-left transition-colors last:border-b-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink-3 ${selected ? 'bg-surface-2 font-semibold' : 'bg-surface hover:bg-surface-2'}`}
                  >
                    <span
                      className={`min-w-0 truncate font-mono text-[9px] ${selected ? 'text-ink' : 'text-ink-2'}`}
                    >
                      {t.name}
                    </span>
                    <span className='shrink-0 font-mono text-[8px] text-ink-3 tabular-nums'>
                      {formatCount(t.rowCount)}
                    </span>
                  </button>
                )
              })}
            </div>
          </CardPanel>

          <CardPanel
            title={
              name ? (
                <span className='inline-flex items-center gap-2'>
                  <span className='font-mono text-[9.5px] font-semibold tracking-normal text-ink normal-case'>
                    public.{name}
                  </span>
                  <Chip tone='pass'>READ ONLY</Chip>
                </span>
              ) : (
                'TABEL'
              )
            }
            meta={
              data
                ? `${formatCount(total)} baris · ${data.columns.length} kolom`
                : undefined
            }
            className='flex min-w-0 flex-col'
          >
            {detail.isError && (
              <div className='p-3'>
                <ErrorAlert
                  error={detail.error}
                  onRetry={() => void detail.refetch()}
                />
              </div>
            )}
            {detail.isPending && !detail.isError && (
              <SkeletonRows rows={6} cols={5} />
            )}

            {data && total === 0 && (
              <div className='p-4'>
                <EmptyState
                  title='Tidak ada baris'
                  desc='Tabel ini ada di schema public, tetapi belum berisi data.'
                />
              </div>
            )}

            {data && total > 0 && (
              <>
                <div className='min-w-0 flex-1 overflow-x-auto'>
                  <Table className='w-full'>
                    <TableHeader>
                      <TableRow className='hover:bg-transparent'>
                        {data.columns.map((c) => (
                          <TableHead
                            key={c.name}
                            className='h-auto px-2.5 py-2 whitespace-nowrap'
                          >
                            <span className='block font-mono text-[8px] font-medium tracking-[.02em] text-ink'>
                              {c.name}
                            </span>
                            <span className='block font-mono text-[7px] font-normal text-ink-3'>
                              {c.type}
                            </span>
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.rows.map((row, i) => (
                        <TableRow key={`${offset}-${i}`} className='h-9'>
                          {data.columns.map((c, j) => {
                            const v = row[j]
                            return (
                              <TableCell
                                key={c.name}
                                className='max-w-[300px] truncate px-2.5 font-mono text-[9px] text-ink-2'
                              >
                                {isSensitive(c.name) ? (
                                  <span className='text-ink-3'>
                                    DISEMBUNYIKAN
                                  </span>
                                ) : v === null || v === undefined ? (
                                  <span className='text-ink-3'>NULL</span>
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

                <p className='flex items-start gap-1.5 border-t border-line bg-surface-2 px-3 py-2 font-mono text-[8.5px] leading-[1.6] text-ink-3'>
                  <Scissors
                    aria-hidden='true'
                    className='mt-[1px] size-3 shrink-0'
                  />
                  <span>
                    Sel panjang dipotong: “… ({CELL_LIMIT} chars)”. Nilai NULL
                    tampil sebagai NULL, bukan string kosong. Kolom password,
                    TOTP, dan secret disembunyikan.
                  </span>
                </p>

                <footer className='flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-3 py-2'>
                  <span className='font-mono text-[9px] text-ink-3 tabular-nums'>
                    baris {formatCount(from)}–{formatCount(to)} dari{' '}
                    {formatCount(total)}
                  </span>
                  <div className='flex items-center gap-2'>
                    <span className='font-mono text-[9px] text-ink-3'>
                      {LIMIT} / halaman
                    </span>
                    <Button
                      variant='outline'
                      size='sm'
                      className='h-7 min-w-7 bg-surface px-1.5 font-mono text-[10px] max-sm:min-h-11'
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                      aria-label='Halaman sebelumnya'
                    >
                      ‹
                    </Button>
                    <Button
                      size='sm'
                      className='h-7 min-w-7 bg-ink px-1.5 font-mono text-[10px] text-surface disabled:opacity-40 max-sm:min-h-11'
                      disabled={offset + LIMIT >= total}
                      onClick={() => setOffset(offset + LIMIT)}
                      aria-label='Halaman berikutnya'
                    >
                      ›
                    </Button>
                  </div>
                </footer>
              </>
            )}
          </CardPanel>
        </div>
      </Main>
    </>
  )
}
