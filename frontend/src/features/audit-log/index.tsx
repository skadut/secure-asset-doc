// ponytail: local table state; move to URL search params for shareable filters
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { auditEvents, type AuditEvent } from '@/data/grc'
import { DataTableColumnHeader } from '@/components/data-table'
import { getMe } from '@/lib/session'
import { PurgeDialog } from './purge-dialog'

const selectClass =
  'h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

function ObjectLink({ event }: { event: AuditEvent }) {
  const className = 'font-mono text-sm underline underline-offset-4'
  if (event.objectType === 'asset') {
    return (
      <Link to='/assets/$assetId' params={{ assetId: event.objectId }} className={className}>
        {event.objectId}
      </Link>
    )
  }
  if (event.objectType === 'document') {
    return (
      <Link to='/documents/$documentId' params={{ documentId: event.objectId }} className={className}>
        {event.objectId}
      </Link>
    )
  }
  if (event.objectType !== 'evidence') return <span className='font-mono text-sm'>{event.objectId}</span>
  return (
    <Link
      to='/evidence'
      hash={`subcategory-${event.objectId}`}
      className={className}
    >
      {event.objectId}
    </Link>
  )
}

export function AuditLog() {
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('all')
  const [objectType, setObjectType] = useState('all')
  const [actor, setActor] = useState('all')
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'at', desc: true },
  ])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // ponytail: auditEvents is mutated in place on purge; version forces recompute. Upgrade to a store if a second source appears.
  const [version, setVersion] = useState(0)
  const { actions, objectTypes, actors } = useMemo(
    () => ({
      actions: [...new Set(auditEvents.map((event) => event.action))].sort(),
      objectTypes: [...new Set(auditEvents.map((event) => event.objectType))].sort(),
      actors: [...new Set(auditEvents.map((event) => event.actor))].sort(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  )
  const canPurge = getMe()?.can?.audit?.purge === true
  const [purgeOpen, setPurgeOpen] = useState(false)

  // ponytail: mirrors main.tsx hydrate; move to an exported loader if a second caller appears.
  async function reloadAudit() {
    try {
      const r = await fetch('/api/grc', { credentials: 'same-origin' })
      if (!r.ok) throw new Error()
      const d = await r.json()
      if (!Array.isArray(d?.auditEvents)) throw new Error()
      auditEvents.length = 0
      auditEvents.push(...d.auditEvents)
      setVersion((v) => v + 1)
    } catch {
      window.location.reload()
    }
  }

  const filteredEvents = useMemo(
    () =>
      auditEvents.filter(
        (event) =>
          event.summary.toLowerCase().includes(search.toLowerCase()) &&
          (action === 'all' || event.action === action) &&
          (objectType === 'all' || event.objectType === objectType) &&
          (actor === 'all' || event.actor === actor)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, action, objectType, actor, version]
  )

  const columns: ColumnDef<AuditEvent>[] = [
    {
      accessorKey: 'at',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Time' />,
      cell: ({ row }) => (
        <time className='whitespace-nowrap font-mono text-sm tabular-nums' dateTime={row.original.at}>
          {row.original.at}
        </time>
      ),
    },
    { accessorKey: 'actor', header: 'Actor' },
    {
      accessorKey: 'action',
      header: 'Action',
      cell: ({ row }) => (
        <div className='flex gap-1'>
          <Badge variant='outline'>{row.original.action}</Badge>
          {row.original.action === 'purge' && <Badge variant='destructive'>permanent</Badge>}
        </div>
      ),
    },
    { accessorKey: 'objectType', header: 'Object type' },
    {
      accessorKey: 'objectId',
      header: 'Object',
      cell: ({ row }) => <ObjectLink event={row.original} />,
    },
    {
      accessorKey: 'summary',
      header: 'Summary',
      cell: ({ row }) => <span className='min-w-56'>{row.original.summary}</span>,
    },
    {
      id: 'changes',
      header: 'Changes',
      enableSorting: false,
      cell: ({ row }) => {
        const changes = row.original.changes ?? []
        if (!changes.length) return <span>None</span>
        const isExpanded = !!expanded[row.original.id]
        return (
          <div className='min-w-36'>
            <Button
              variant='link'
              className='h-auto p-0'
              aria-expanded={isExpanded}
              aria-controls={`changes-${row.original.id}`}
              onClick={() =>
                setExpanded((current) => ({
                  ...current,
                  [row.original.id]: !current[row.original.id],
                }))
              }
            >
              {changes.length} {changes.length === 1 ? 'field' : 'fields'}
            </Button>
            {isExpanded && (
              <ul id={`changes-${row.original.id}`} className='mt-2 flex flex-col gap-1 text-sm'>
                {changes.map((change, index) => (
                  <li key={`${change.field}-${index}`}>
                    <span className='font-medium'>{change.field}:</span>{' '}
                    <span>{change.from} → {change.to}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      },
    },
  ]

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredEvents,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  })
  const pageCount = table.getPageCount()

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex flex-wrap items-start justify-between gap-4'>
          <div>
            <h1 className='page-title tracking-tight'>Audit log</h1>
            <p className='text-muted-foreground'>
              Recorded changes to assets, documents and evidence links. Sample data.
            </p>
          </div>
          {canPurge && (
            <Button
              variant='outline'
              className='border-destructive text-destructive hover:bg-destructive/10'
              onClick={() => setPurgeOpen(true)}
            >
              Purge old entries
            </Button>
          )}
        </div>
        {canPurge && (
          <PurgeDialog open={purgeOpen} onOpenChange={setPurgeOpen} onPurged={() => void reloadAudit()} />
        )}

        <div className='flex flex-wrap items-end gap-4'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='audit-search'>Search summary</Label>
            <input
              id='audit-search'
              type='search'
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder='Search summaries'
              className={`${selectClass} w-64 max-w-full`}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='audit-action'>Action</Label>
            <select id='audit-action' className={selectClass} value={action} onChange={(e) => setAction(e.target.value)}>
              <option value='all'>All actions</option>
              {actions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='audit-object-type'>Object type</Label>
            <select id='audit-object-type' className={selectClass} value={objectType} onChange={(e) => setObjectType(e.target.value)}>
              <option value='all'>All object types</option>
              {objectTypes.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='audit-actor'>Actor</Label>
            <select id='audit-actor' className={selectClass} value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value='all'>All actors</option>
              {actors.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
        </div>

        <div className='overflow-x-auto rounded-md border'>
          <Table className='min-w-[68rem]'>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => (
                <TableRow key={row.original.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className='align-top'>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className='h-24 text-center text-muted-foreground'>
                    No results match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className='flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <p className='text-sm text-muted-foreground'>
            {filteredEvents.length} events, 20 per page
          </p>
          <div className='flex items-center gap-2'>
            <Button variant='outline' size='sm' onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Previous
            </Button>
            <span className='text-sm tabular-nums'>
              Page {pageCount ? table.getState().pagination.pageIndex + 1 : 0} of {pageCount}
            </span>
            <Button variant='outline' size='sm' onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Next
            </Button>
          </div>
        </div>
      </Main>
    </>
  )
}
