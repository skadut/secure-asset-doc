import { useMemo, useState } from 'react'
import {
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { type Tlp } from '@/data/grc'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { TLP_LEVELS } from '../helpers'
import { type DocRow, documentColumns as columns } from './documents-columns'

type DocumentsTableProps = {
  data: DocRow[]
  selectedId?: string
  onSelect: (document: DocRow) => void
}

type LevelFilter = { value: Tlp | 'ALL'; exact: boolean }

const TILES: { value: Tlp | 'ALL'; label: string; color: string }[] = [
  { value: 'ALL', label: 'Semua dokumen', color: 'text-ink' },
  { value: 'RED', label: 'RED termasuk STRICT', color: 'text-fail' },
  { value: 'AMBER', label: 'AMBER termasuk STRICT', color: 'text-warn' },
  { value: 'GREEN', label: 'GREEN', color: 'text-pass' },
  { value: 'CLEAR', label: 'CLEAR', color: 'text-ink-2' },
]

export function DocumentsTable({
  data,
  selectedId,
  onSelect,
}: DocumentsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<LevelFilter>({
    value: 'ALL',
    exact: false,
  })

  const matchesLevel = (doc: DocRow, filter: LevelFilter) =>
    filter.value === 'ALL' ||
    doc.tlp === filter.value ||
    (!filter.exact &&
      ((filter.value === 'RED' && doc.tlp === 'RED+STRICT') ||
        (filter.value === 'AMBER' && doc.tlp === 'AMBER+STRICT')))

  const filteredData = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    return data.filter((doc) => {
      const matchesSearch =
        !q ||
        doc.id.toLocaleLowerCase().includes(q) ||
        doc.title.toLocaleLowerCase().includes(q)
      return matchesLevel(doc, level) && matchesSearch
    })
  }, [data, level, query])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const countFor = (value: Tlp | 'ALL') =>
    data.filter((doc) => {
      const q = query.trim().toLocaleLowerCase()
      const matchesSearch =
        !q ||
        doc.id.toLocaleLowerCase().includes(q) ||
        doc.title.toLocaleLowerCase().includes(q)
      return matchesLevel(doc, { value, exact: false }) && matchesSearch
    }).length

  return (
    <section aria-label='Registri dokumen' className='flex min-w-0 flex-col gap-3'>
      <div className='grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-3 xl:grid-cols-5'>
        {TILES.map((tile) => {
          const active = level.value === tile.value && !level.exact
          return (
            <button
              key={tile.value}
              type='button'
              aria-pressed={active}
              onClick={() => setLevel({ value: tile.value, exact: false })}
              className={cn(
                'flex min-h-[58px] min-w-0 flex-col items-start justify-center gap-1 bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-active focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus)] active:bg-surface-active',
                active && 'bg-surface-active'
              )}
            >
              <span
                className={cn(
                  'font-heading text-[20px] leading-none font-semibold tabular-nums',
                  tile.color
                )}
              >
                {countFor(tile.value)}
              </span>
              <span className='text-[10px] leading-tight text-ink-2'>
                {tile.label}
              </span>
            </button>
          )
        })}
      </div>

      <div className='flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end'>
        <div className='min-w-0 flex-1'>
          <Label htmlFor='document-search' className='mb-1 block text-[10px] text-ink-3'>
            Cari dokumen
          </Label>
          <Input
            id='document-search'
            type='search'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder='ID atau judul dokumen'
            className='h-9 rounded-none border-line-strong bg-surface text-[12px] placeholder:text-ink-3'
          />
        </div>
        <div className='w-full sm:w-52'>
          <Label htmlFor='document-level' className='mb-1 block text-[10px] text-ink-3'>
            Filter TLP
          </Label>
          <Select
            value={level.value}
            onValueChange={(value) =>
              setLevel({ value: value as Tlp | 'ALL', exact: true })
            }
          >
            <SelectTrigger
              id='document-level'
              className='h-9 w-full rounded-none border-line-strong bg-surface text-[12px]'
              aria-label='Filter tingkat TLP'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='ALL'>Semua tingkat</SelectItem>
              {TLP_LEVELS.map((tlp) => (
                <SelectItem key={tlp} value={tlp}>
                  TLP:{tlp}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className='focus-strong min-w-0 overflow-x-auto border border-line bg-surface'>
        <Table className='doc-table w-full min-w-[836px] table-fixed'>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className='h-8 border-line bg-surface-2 hover:bg-surface-2'>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    style={
                      header.column.columnDef.size !== undefined
                        ? { width: header.getSize() }
                        : undefined
                    }
                    className='h-8 px-2 font-mono text-[8px] uppercase tracking-[.07em] text-ink-3'
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
                    if ((event.target as HTMLElement).closest('a,button')) return
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
                    'h-[54px] cursor-pointer border-line-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--focus)]',
                    row.original.id === selectedId && 'bg-surface-active'
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={`px-2 py-1 ${cell.column.id === 'title' ? 'align-middle whitespace-normal' : 'align-middle whitespace-nowrap'}`}
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
      <p className='font-mono text-[9px] text-ink-3' aria-live='polite'>
        {filteredData.length} dokumen ·{' '}
        {filteredData.reduce((sum, doc) => sum + doc.versions.length, 0)} versi
      </p>
    </section>
  )
}
