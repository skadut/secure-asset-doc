import { useState } from 'react'
import {
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { type DocRow, documentColumns as columns } from './documents-columns'

type DocumentsTableProps = {
  data: DocRow[]
  selectedId?: string
  onSelect: (document: DocRow) => void
}

export function DocumentsTable({
  data,
  selectedId,
  onSelect,
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
        pageSize: 8,
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
                    className='h-[26px] border-b border-line px-2.5 py-0 font-mono text-[7.5px] font-normal tracking-[.09em] text-ink-3 uppercase'
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
                      'shadow-[inset_2px_0_0_var(--ink)]'
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
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className='h-20 text-center text-[11px] text-ink-3'
                >
                  Tidak ada dokumen yang sesuai dengan filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className='flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-2 px-3.5 py-2.5 font-mono text-[8.5px] tracking-[.08em] text-ink-3'>
        <p aria-live='polite'>
          Menampilkan {data.length} dokumen, {versionCount} versi · AKSES: Level
          = dari level Anda, Grant = izin khusus
        </p>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            aria-label='Halaman sebelumnya'
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className='inline-flex size-4 items-center justify-center text-ink-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] disabled:opacity-40'
          >
            <ChevronLeft aria-hidden='true' className='size-3' />
          </button>
          <span aria-live='polite'>
            HALAMAN {pageIndex + 1} / {pageCount}
          </span>
          <button
            type='button'
            aria-label='Halaman berikutnya'
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className='inline-flex size-4 items-center justify-center text-ink-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)] disabled:opacity-40'
          >
            <ChevronRight aria-hidden='true' className='size-3' />
          </button>
        </div>
      </div>
    </section>
  )
}
