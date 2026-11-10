import { useMemo, useState } from 'react'
import {
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type Tlp } from '@/data/grc'
import { TLP_LEVELS } from '../helpers'
import { type DocRow, documentColumns as columns } from './documents-columns'

type DocumentsTableProps = {
  data: DocRow[]
  selectedId?: string
  onSelect: (document: DocRow) => void
}

type LevelFilter = { value: Tlp | 'ALL'; exact: boolean }

const TILE_LEVELS: { value: Tlp | 'ALL'; label: string; color: string }[] = [
  { value: 'ALL', label: 'Semua versi dokumen', color: 'text-foreground' },
  { value: 'RED', label: 'TLP:RED (termasuk STRICT)', color: 'text-fail' },
  { value: 'AMBER', label: 'TLP:AMBER (termasuk STRICT)', color: 'text-warn' },
  { value: 'GREEN', label: 'TLP:GREEN', color: 'text-pass' },
  { value: 'CLEAR', label: 'TLP:CLEAR', color: 'text-muted-foreground' },
]

export function DocumentsTable({ data, selectedId, onSelect }: DocumentsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<LevelFilter>({ value: 'ALL', exact: false })

  // Tile (exact: false) groups RED with RED+STRICT and AMBER with AMBER+STRICT. Select (exact: true) matches one level only.
  const matchesLevel = (doc: DocRow, { value, exact }: LevelFilter) => value === 'ALL'
    || doc.tlp === value
    || (!exact && value === 'RED' && doc.tlp === 'RED+STRICT')
    || (!exact && value === 'AMBER' && doc.tlp === 'AMBER+STRICT')

  const filteredData = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    return data.filter((doc) => {
      const matchesSearch = !q || doc.id.toLocaleLowerCase().includes(q) || doc.title.toLocaleLowerCase().includes(q)
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
  const countFor = (value: Tlp | 'ALL') => data.filter((doc) => {
    const q = query.trim().toLocaleLowerCase()
    const matchesSearch = !q || doc.id.toLocaleLowerCase().includes(q) || doc.title.toLocaleLowerCase().includes(q)
    return matchesLevel(doc, { value, exact: false }) && matchesSearch
  }).reduce((sum, doc) => sum + doc.versions.length, 0)

  return (
    <section aria-label='Registri dokumen' className='flex min-w-0 flex-col gap-5'>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5'>
        {TILE_LEVELS.map((tile) => {
          const active = level.value === tile.value && (!level.exact || tile.value === 'ALL')
          return (
            <button
              key={tile.value}
              type='button'
              aria-pressed={active}
              onClick={() => setLevel({ value: tile.value, exact: false })}
              className={cn('flex min-h-[76px] flex-col justify-center gap-1 rounded-sm border bg-card px-3 py-2 text-left transition-colors duration-150 hover:bg-accent active:scale-[.98]', active ? 'border-ring bg-accent' : 'border-border')}
            >
              <span className={cn('font-heading text-[28px] leading-none font-semibold tabular-nums', tile.color)}>{countFor(tile.value)}</span>
              <span className='text-xs text-muted-foreground'>{tile.label}</span>
            </button>
          )
        })}
      </div>

      <div className='flex flex-wrap items-end gap-3'>
        <div className='min-w-0 flex-1 basis-60'>
          <Label htmlFor='document-search' className='mb-1 block text-xs text-muted-foreground'>Cari nomor kontrol atau judul</Label>
          <Input id='document-search' type='search' value={query} onChange={(event) => setQuery(event.target.value)} placeholder='ID dokumen atau judul' className='h-11 font-mono text-sm' />
        </div>
        <div className='w-full sm:w-56'>
          <Label htmlFor='document-level' className='mb-1 block text-xs text-muted-foreground'>Filter TLP</Label>
          <Select value={level.value} onValueChange={(value) => setLevel({ value: value as Tlp | 'ALL', exact: true })}>
            <SelectTrigger id='document-level' className='w-full' aria-label='Filter tingkat TLP'><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value='ALL'>Semua tingkat</SelectItem>
              {TLP_LEVELS.map((tlp) => <SelectItem key={tlp} value={tlp}>TLP:{tlp}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className='focus-strong min-w-0 overflow-x-auto rounded-sm border bg-card'>
        {/* ponytail: table fixed 1024px, scrolls inside wrapper on narrow screens; upgrade path = card layout below md. */}
        <Table className='doc-table table-fixed w-full min-w-[1024px]'>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan} style={header.column.columnDef.size !== undefined ? { width: header.getSize() } : undefined}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => (
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
                className={cn('h-14 cursor-pointer', row.original.id === selectedId && 'bg-accent ring-1 ring-inset ring-ring')}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={cell.column.id === 'title' ? 'align-middle' : 'whitespace-nowrap align-middle'}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            )) : (
              <TableRow><TableCell colSpan={columns.length} className='h-24 text-center text-muted-foreground'>Tidak ada dokumen yang sesuai dengan filter.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <p className='text-xs text-muted-foreground' aria-live='polite'>Menampilkan {filteredData.length} dokumen, {filteredData.reduce((sum, doc) => sum + doc.versions.length, 0)} versi</p>
    </section>
  )
}
