import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { assets, evidenceLinks, type Asset, type Criticality } from '@/data/grc'
import { Columns3, ScrollText, Search as SearchIcon } from 'lucide-react'
import { getMe } from '@/lib/session'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CardPanel } from '@/components/card-panel'
import { ConfigDrawer } from '@/components/config-drawer'
import { EmptyState } from '@/components/empty-state'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { PageHead } from '@/components/page-head'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { StatStrip } from '@/components/stat-strip'
import { ThemeSwitch } from '@/components/theme-switch'
import {
  assetColumns,
  assetFilterOptions,
  criticalityLabel,
  isReviewOverdue,
  statusLabel,
} from './columns'

const PAGE_SIZE = 9

// Pen gQAhw: 34px select, sentence-case label, 9px mono; chevron overridden to 12px below.
const selectClass =
  'h-[34px] rounded-none border-line bg-surface px-2.5 font-mono text-[10.5px] text-ink shadow-none hover:bg-surface-2 dark:bg-surface dark:hover:bg-surface-2 focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink max-sm:h-11 [&_svg]:size-3 [&_svg]:opacity-100'

const FILTERS: {
  id: string
  label: string
  width: string
  options: readonly string[]
}[] = [
  {
    id: 'sector',
    label: 'Sektor',
    width: 'w-[140px]',
    options: assetFilterOptions.sector,
  },
  {
    id: 'type',
    label: 'Tipe',
    width: 'w-[140px]',
    options: assetFilterOptions.type,
  },
  {
    id: 'criticality',
    label: 'Kritikalitas',
    width: 'w-[160px]',
    options: assetFilterOptions.criticality,
  },
  {
    id: 'status',
    label: 'Status',
    width: 'w-[136px]',
    options: assetFilterOptions.status,
  },
  {
    id: 'purdueLevel',
    label: 'Purdue',
    width: 'w-[136px]',
    options: assetFilterOptions.purdueLevel,
  },
]

const COLUMN_LABELS: Record<string, string> = {
  id: 'ID',
  name: 'Nama',
  type: 'Tipe',
  site: 'Site',
  purdueLevel: 'Purdue',
  criticality: 'Kritikalitas',
  status: 'Status',
  lastReviewed: 'Tinjauan',
}

export function Assets() {
  // ponytail: local table state; move to URL search params when filters need sharing.
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: assets,
    columns: assetColumns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      globalFilter,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    globalFilterFn: (row, _columnId, value: string) =>
      row.original.name.toLowerCase().includes(value.toLowerCase()),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const rows = table.getRowModel().rows
  const filtered = table.getFilteredRowModel().rows.length
  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const evidenceAssets = new Set(evidenceLinks.map((link) => link.assetId))
  const canOpenAudit = (() => {
    const me = getMe()
    return me?.securityOfficer === true || me?.superAdmin === true
  })()

  const filterValue = (id: string) =>
    String(table.getColumn(id)?.getFilterValue() ?? '')

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
          title='Aset'
          eyebrow={`INVENTARIS OT · ${assets.length} ASET · IEC 62443 ZONE`}
          note='DATA /api/grc · TANPA ENDPOINT TULIS'
          actions={
            canOpenAudit ? (
              <Link
                to='/audit-log'
                className='inline-flex h-9 items-center gap-1.5 border border-line-strong bg-surface px-3 font-sans text-[14.5px] font-semibold text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
              >
                <ScrollText aria-hidden='true' className='size-3.5' />
                Buka audit log
              </Link>
            ) : undefined
          }
        />

        <StatStrip
          compact
          items={[
            { label: 'TOTAL ASET', value: assets.length },
            {
              label: 'KRITIKALITAS TINGGI',
              value: assets.filter((a) => a.criticality === 'high').length,
              tone: 'fail',
            },
            {
              label: 'REVIEW TERLAMBAT',
              value: assets.filter((a) => isReviewOverdue(a.lastReviewed))
                .length,
              tone: 'warn',
            },
            {
              label: 'STATUS RETIRED',
              value: assets.filter((a) => a.status === 'retired').length,
              tone: 'muted',
            },
            {
              label: 'PUNYA BUKTI CSF',
              value: assets.filter((a) => evidenceAssets.has(a.id)).length,
              tone: 'pass',
            },
          ]}
        />

        <div
          className='flex flex-wrap items-center gap-2'
          role='toolbar'
          aria-label='Filter aset'
        >
          <div className='flex h-[34px] w-[300px] min-w-0 flex-1 items-center gap-2 border border-line bg-surface px-2.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink max-sm:h-11 sm:flex-none'>
            <label className='sr-only' htmlFor='asset-search'>
              Cari nama aset
            </label>
            <SearchIcon
              aria-hidden='true'
              className='size-3 shrink-0 text-ink-3'
            />
            <input
              id='asset-search'
              type='search'
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              placeholder='Cari nama aset'
              className='h-full min-w-0 flex-1 bg-transparent font-mono text-[11px] text-ink outline-none placeholder:text-ink-3'
            />
          </div>
          {FILTERS.map((filter) => (
            <Select
              key={filter.id}
              value={filterValue(filter.id) || 'all'}
              onValueChange={(value) =>
                table
                  .getColumn(filter.id)
                  ?.setFilterValue(value === 'all' ? '' : value)
              }
            >
              <SelectTrigger
                aria-label={filter.label}
                className={`${filter.width} max-sm:w-full ${selectClass}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className='rounded-none'>
                <SelectItem
                  value='all'
                  className='font-mono text-[10.5px]'
                >{`${filter.label}: semua`}</SelectItem>
                {filter.options.map((option) => (
                  <SelectItem
                    key={option}
                    value={option}
                    className='font-mono text-[10.5px]'
                  >
                    {filter.id === 'criticality'
                      ? criticalityLabel[option as Criticality]
                      : filter.id === 'status'
                        ? statusLabel[option as Asset['status']]
                        : option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
          <div className='flex flex-1 items-center justify-end gap-2 max-sm:w-full'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='outline'
                  size='icon'
                  className='size-[34px] max-sm:size-11'
                  aria-label='Atur kolom tampil'
                >
                  <Columns3 aria-hidden='true' className='size-3.5' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-44'>
                <DropdownMenuLabel className='font-mono text-[10.5px] tracking-[.08em] uppercase'>
                  Kolom
                </DropdownMenuLabel>
                {table
                  .getAllLeafColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className='font-mono text-[11.5px]'
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) =>
                        column.toggleVisibility(!!value)
                      }
                      onSelect={(event) => event.preventDefault()}
                    >
                      {COLUMN_LABELS[column.id] ?? column.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <CardPanel className='flex flex-1 flex-col'>
          <div className='flex-1 overflow-x-auto'>
            <Table className='w-full min-w-[1416px] table-fixed'>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    key={headerGroup.id}
                    className='hover:bg-transparent'
                  >
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        style={{ width: header.getSize() }}
                        className='h-8 bg-surface-2 px-3.5 font-mono text-[8.5px] tracking-[.09em] text-ink-3 uppercase'
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.length ? (
                  rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className='h-[52px] transition-colors duration-150 hover:bg-surface-2'
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className='px-3.5 text-[12.5px]'
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={table.getVisibleLeafColumns().length}
                      className='p-4'
                    >
                      <EmptyState
                        title='Tidak ada aset yang cocok'
                        desc='Ubah kata kunci atau kosongkan filter untuk melihat seluruh inventaris.'
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <footer className='flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-3.5 py-2'>
            <span className='font-mono text-[10.5px] text-ink-3'>
              {filtered
                ? `Menampilkan ${pageIndex * PAGE_SIZE + 1}–${pageIndex * PAGE_SIZE + rows.length} dari ${filtered} aset`
                : 'Menampilkan 0 aset'}
            </span>
            <nav aria-label='Halaman aset' className='flex items-center gap-1'>
              <Button
                variant='outline'
                size='icon'
                className='size-6 font-mono text-[11.5px]'
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
                aria-label='Halaman sebelumnya'
              >
                ‹
              </Button>
              {Array.from({ length: pageCount }, (_, index) => (
                <Button
                  key={index}
                  variant='outline'
                  size='icon'
                  className={`size-6 font-mono text-[11.5px] tabular-nums ${index === pageIndex ? 'border-ink bg-ink text-surface hover:bg-ink' : ''}`}
                  aria-label={`Halaman ${index + 1}`}
                  aria-current={index === pageIndex ? 'page' : undefined}
                  onClick={() => table.setPageIndex(index)}
                >
                  {index + 1}
                </Button>
              ))}
              <Button
                variant='outline'
                size='icon'
                className='size-6 font-mono text-[11.5px]'
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
                aria-label='Halaman berikutnya'
              >
                ›
              </Button>
            </nav>
          </footer>
        </CardPanel>
      </Main>
    </>
  )
}
