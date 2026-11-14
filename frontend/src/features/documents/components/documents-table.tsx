import { useState } from 'react'
import {
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/empty-state'
import { TablePager } from '@/components/table-pager'
import { type DocRow, documentColumns as columns } from './documents-columns'

const PAGE_SIZE = 8

type DocumentsTableProps = {
  data: DocRow[]
  selectedId?: string
  onSelect: (document: DocRow) => void
  onResetFilter: () => void
}

export function DocumentsTable({
  data,
  selectedId,
  onSelect,
  onResetFilter,
}: DocumentsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    initialState: {
      pagination: {
        pageSize: PAGE_SIZE,
      },
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  const versionCount = data.reduce((sum, doc) => sum + doc.versions.length, 0)
  const pageIndex = table.getState().pagination.pageIndex
  const pageCount = Math.max(1, table.getPageCount())

  return (
    <section
      aria-label='Daftar dokumen'
      className='flex min-w-0 flex-col gap-2'
    >
      <div className='focus-strong min-w-0 overflow-x-auto border border-line bg-surface'>
        <Table className='doc-table w-full min-w-[760px] table-fixed'>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className='h-[26px] border-line bg-surface-2 hover:bg-surface-2'
              >
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    style={
                      header.column.columnDef.size !== undefined
                        ? { width: header.getSize() }
                        : undefined
                    }
                    className='h-[26px] border-b border-line px-2.5 py-0 font-mono text-[8.5px] font-normal tracking-[.09em] text-ink-3 uppercase'
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
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  aria-selected={row.original.id === selectedId}
                  tabIndex={0}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('a,button'))
                      return
                    onSelect(row.original)
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(row.original)
                    }
                  }}
                  className={cn(
                    'focus-visible:outline-inset h-[52px] cursor-pointer border-b border-line bg-surface transition-colors hover:bg-surface-active focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]',
                    row.original.id === selectedId &&
                      'bg-surface-2 shadow-[inset_0_0_0_1px_var(--ink)]'
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={`px-2.5 py-1.5 ${cell.column.id === 'title' ? 'align-middle whitespace-normal' : 'align-middle whitespace-nowrap'}`}
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
              <TableRow className='hover:bg-transparent'>
                <TableCell colSpan={columns.length} className='p-4'>
                  <EmptyState
                    filterVariant
                    title='Tidak ada yang cocok'
                    icon={<Inbox />}
                    action={
                      <button
                        type='button'
                        onClick={onResetFilter}
                        className='relative inline-flex h-[30px] items-center border border-line bg-surface px-3 text-[12px] text-ink-2 after:absolute after:inset-x-0 after:-inset-y-[7px] hover:bg-surface-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]'
                      >
                        Reset filter
                      </button>
                    }
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <TablePager
        summary={
          data.length
            ? `Menampilkan ${pageIndex * PAGE_SIZE + 1}–${pageIndex * PAGE_SIZE + table.getRowModel().rows.length} dari ${data.length} dokumen · ${versionCount} versi · AKSES: Level = dari level Anda, Grant = izin khusus`
            : `Menampilkan 0 dokumen · ${versionCount} versi · AKSES: Level = dari level Anda, Grant = izin khusus`
        }
        pageIndex={pageIndex}
        pageCount={pageCount}
        onPage={(i) => table.setPageIndex(i)}
        canPrev={table.getCanPreviousPage()}
        canNext={table.getCanNextPage()}
        label='Halaman dokumen'
      />
    </section>
  )
}
