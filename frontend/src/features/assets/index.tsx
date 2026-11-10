import { useState } from 'react'
import {
  type ColumnFiltersState,
  type PaginationState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { assets } from '@/data/grc'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfigDrawer } from '@/components/config-drawer'
import { DataTablePagination, DataTableToolbar } from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { assetColumns, assetFilterOptions } from './columns'

const SEARCH_LABEL = 'Search assets by name'
const SEARCH_PLACEHOLDER = 'Search by name...'

export function Assets() {
  // ponytail: local table state; move to useTableUrlState for shareable filters
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    sector: false,
    purdueLevel: false,
    zone: false,
  })
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
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
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  const rows = table.getRowModel().rows

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='focus-strong flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h1 className='page-title tracking-tight'>Assets</h1>
          <p className='text-muted-foreground'>
            Asset inventory with sector, Purdue level, IEC 62443 zone,
            criticality and last review. Sample data.
          </p>
        </div>

        <div
          className={cn(
            'max-sm:has-[div[role="toolbar"]]:mb-16',
            'flex flex-1 flex-col gap-4'
          )}
        >
          <div className='max-w-full overflow-x-auto'>
            <DataTableToolbar
              table={table}
              searchPlaceholder={SEARCH_PLACEHOLDER}
              searchLabel={SEARCH_LABEL}
              filters={[
                {
                  columnId: 'sector',
                  title: 'Sector',
                  options: assetFilterOptions.sector,
                },
                {
                  columnId: 'type',
                  title: 'Type',
                  options: assetFilterOptions.type,
                },
                {
                  columnId: 'criticality',
                  title: 'Criticality',
                  options: assetFilterOptions.criticality,
                },
                {
                  columnId: 'purdueLevel',
                  title: 'Purdue level',
                  options: assetFilterOptions.purdueLevel,
                },
                {
                  columnId: 'status',
                  title: 'Status',
                  options: assetFilterOptions.status,
                },
              ]}
            />
          </div>

          <div className='overflow-x-auto rounded-md border'>
            <Table className='doc-table min-w-4xl'>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
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
                    <TableRow key={row.id} className='h-14'>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
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
                      className='h-24 text-center'
                    >
                      No assets match the current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <DataTablePagination table={table} className='mt-auto' />
        </div>
      </Main>
    </>
  )
}
