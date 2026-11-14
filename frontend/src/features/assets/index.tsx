import { useMemo, useState } from 'react'
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
import { useGrcVersion } from '@/lib/grc-refresh'
import { getMe } from '@/lib/session'
import { cn } from '@/lib/utils'
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
import { TablePager } from '@/components/table-pager'
import { ThemeSwitch } from '@/components/theme-switch'
import { assetActionsColumn } from './asset-actions'
import {
  assetColumns,
  assetFilterOptions,
  criticalityLabel,
  isReviewOverdue,
  statusLabel,
} from './columns'
import { DeleteAssetDialog } from './delete-dialog'
import { EditAssetDialog } from './edit-dialog'

const PAGE_SIZE = 9

type AssetTile = 'ALL' | 'HIGH' | 'OVERDUE' | 'RETIRED' | 'CSF'

// Accents use the existing tokens border-t-fail, border-t-warn, border-t-pass and border-t-line-strong; the mark uses the matching bg-* token.
const TILES: {
  value: AssetTile
  label: string
  accent: string
  mark: string
}[] = [
  { value: 'ALL', label: 'Semua aset', accent: '', mark: '' },
  {
    value: 'HIGH',
    label: 'Kritikalitas tinggi',
    accent: 'border-t-fail',
    mark: 'bg-fail',
  },
  {
    value: 'OVERDUE',
    label: 'Review terlambat',
    accent: 'border-t-warn',
    mark: 'bg-warn',
  },
  {
    value: 'RETIRED',
    label: 'Status retired',
    accent: 'border-t-line-strong',
    mark: 'bg-line-strong',
  },
  {
    value: 'CSF',
    label: 'Punya bukti CSF',
    accent: 'border-t-pass',
    mark: 'bg-pass',
  },
]

const tileMatch: Record<
  AssetTile,
  (asset: Asset, evidence: Set<string>) => boolean
> = {
  ALL: () => true,
  HIGH: (asset) => asset.criticality === 'high',
  OVERDUE: (asset) => isReviewOverdue(asset.lastReviewed),
  RETIRED: (asset) => asset.status === 'retired',
  CSF: (asset, evidence) => evidence.has(asset.id),
}

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
  actions: 'Aksi',
}

export function Assets() {
  // ponytail: local table state; move to URL search params when filters need sharing.
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [globalFilter, setGlobalFilter] = useState('')
  const [tile, setTile] = useState<AssetTile>('ALL')
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const me = getMe()
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null)
  const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null)
  const version = useGrcVersion()
  // New array per refresh so TanStack's data memo recomputes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => [...assets], [version])
  // Tile filter runs before TanStack; search and Select filters still apply after it.
  // Tile counts use the search box only, not the Select column filters.
  // ponytail: counts ignore Select filters; subtract them from the pool if that becomes confusing.
  const { tileData, counts } = useMemo(() => {
    const evidence = new Set(
      evidenceLinks
        .map((link) => link.assetId)
        .filter((id): id is string => Boolean(id))
    )
    const query = globalFilter.toLowerCase()
    const pool = query
      ? data.filter((asset) => asset.name.toLowerCase().includes(query))
      : data
    return {
      tileData: data.filter((asset) => tileMatch[tile](asset, evidence)),
      counts: Object.fromEntries(
        TILES.map(({ value }) => [
          value,
          pool.filter((asset) => tileMatch[value](asset, evidence)).length,
        ])
      ) as Record<AssetTile, number>,
    }
  }, [data, tile, globalFilter])
  const selectTile = (value: AssetTile) => {
    setTile((prev) => (prev === value && value !== 'ALL' ? 'ALL' : value))
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }
  const columns = useMemo(
    () => [
      ...assetColumns,
      assetActionsColumn({
        canEditAll: me?.can.asset.u === true,
        canEditOwn: me?.can.asset.uOwn === true,
        ownerLabel: me?.ownerLabel ?? null,
        canDelete: me?.can.asset.d === true,
        onEdit: setEditingAsset,
        onDelete: setDeletingAsset,
      }),
    ],
    [me]
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: tileData,
    columns,
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
  const canOpenAudit = (() => {
    const me = getMe()
    return me?.securityOfficer === true || me?.superAdmin === true
  })()
  const canCreateAsset = getMe()?.can.asset.c === true

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
          note='DATA /api/grc · TULIS TERAUDIT'
          actions={
            <>
              {canCreateAsset && (
                <Link
                  to='/assets/new'
                  className='inline-flex h-9 items-center border border-ink bg-ink px-3 font-sans text-[14.5px] font-semibold text-surface hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
                >
                  Tambah aset
                </Link>
              )}
              {canOpenAudit ? (
                <Link
                  to='/audit-log'
                  className='inline-flex h-9 items-center gap-1.5 border border-line-strong bg-surface px-3 font-sans text-[14.5px] font-semibold text-ink hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
                >
                  <ScrollText aria-hidden='true' className='size-3.5' />
                  Buka audit log
                </Link>
              ) : null}
            </>
          }
        />

        <section
          aria-label='Filter aset'
          className='flex min-w-0 flex-col gap-2'
        >
          <div className='grid min-w-0 grid-cols-2 gap-[.67px] border-[.67px] border-line bg-line sm:grid-cols-3 xl:grid-cols-5'>
            {TILES.map((tileDef) => {
              const active = tile === tileDef.value
              const isAll = tileDef.value === 'ALL'
              return (
                <button
                  key={tileDef.value}
                  type='button'
                  aria-pressed={active}
                  onClick={() => selectTile(tileDef.value)}
                  className={cn(
                    'flex h-[52px] min-w-0 flex-col justify-center gap-1 border-[.67px] border-line bg-surface px-3 text-left transition-colors hover:bg-surface-active focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus)]',
                    tileDef.accent,
                    active && !isAll && 'bg-surface-active',
                    isAll && 'border-ink bg-ink text-bg hover:bg-ink'
                  )}
                >
                  <span
                    className={cn(
                      'flex items-center gap-1.5 font-mono text-[8.5px] tracking-[.05em] uppercase',
                      isAll ? 'text-ink-3' : 'text-ink-2'
                    )}
                  >
                    {!isAll && (
                      <span
                        aria-hidden='true'
                        className={cn('size-[7px] shrink-0', tileDef.mark)}
                      />
                    )}
                    <span className='truncate'>{tileDef.label}</span>
                  </span>
                  <span className='flex items-baseline gap-1.5'>
                    <span
                      className={cn(
                        'font-heading text-[19px] leading-none font-semibold tabular-nums',
                        isAll ? 'text-bg' : 'text-ink'
                      )}
                    >
                      {counts[tileDef.value]}
                    </span>
                    <span className='font-mono text-[8.5px] text-ink-3'>
                      aset
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className='flex flex-wrap items-center gap-2'>
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
        </section>

        <CardPanel className='flex flex-1 flex-col'>
          <div className='flex-1 overflow-x-auto'>
            <Table className='w-full min-w-[1150px] table-fixed'>
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

          <TablePager
            summary={
              filtered
                ? `Menampilkan ${pageIndex * PAGE_SIZE + 1}–${pageIndex * PAGE_SIZE + rows.length} dari ${filtered} aset`
                : 'Menampilkan 0 aset'
            }
            pageIndex={pageIndex}
            pageCount={pageCount}
            onPage={(i) => table.setPageIndex(i)}
            canPrev={table.getCanPreviousPage()}
            canNext={table.getCanNextPage()}
            label='Halaman aset'
          />
        </CardPanel>

        {editingAsset && (
          <EditAssetDialog
            asset={editingAsset}
            open
            onOpenChange={(open) => {
              if (!open) setEditingAsset(null)
            }}
            onSaved={() => {}}
          />
        )}
        {deletingAsset && (
          <DeleteAssetDialog
            asset={deletingAsset}
            open
            onOpenChange={(open) => {
              if (!open) setDeletingAsset(null)
            }}
            onDeleted={() => {}}
          />
        )}
      </Main>
    </>
  )
}
