import { Link } from '@tanstack/react-router'
import { type ColumnDef } from '@tanstack/react-table'
import { DataTableColumnHeader } from '@/components/data-table'
import { DocStatusBadge } from '@/components/status-badge'
import { TlpBadge } from '@/components/tlp-badge'
import { type Document as GrcDocument } from '@/data/grc'
import { reviewLabel } from '../helpers'

const multiValueFilter = (row: { getValue: (id: string) => unknown }, id: string, value: string[]) =>
  value.includes(String(row.getValue(id)))

export const documentColumns: ColumnDef<GrcDocument>[] = [
  {
    accessorKey: 'id',
    header: ({ column }) => <DataTableColumnHeader column={column} title='ID' />,
    cell: ({ row }) => (
      <Link
        to='/documents/$documentId'
        params={{ documentId: row.original.id }}
        className='font-mono font-medium underline underline-offset-4'
      >
        {row.original.id}
      </Link>
    ),
  },
  {
    accessorKey: 'title',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Title' />,
    cell: ({ row }) => (
      <Link
        to='/documents/$documentId'
        params={{ documentId: row.original.id }}
        className='font-medium underline underline-offset-4'
      >
        {row.original.title}
      </Link>
    ),
  },
  {
    accessorKey: 'type',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Type' />,
    filterFn: multiValueFilter,
  },
  {
    accessorKey: 'tlp',
    header: ({ column }) => <DataTableColumnHeader column={column} title='TLP' />,
    cell: ({ row }) => <TlpBadge tlp={row.original.tlp} />,
    filterFn: multiValueFilter,
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Status' />,
    cell: ({ row }) => <DocStatusBadge status={row.original.status} />,
    filterFn: multiValueFilter,
  },
  {
    accessorKey: 'owner',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Owner' />,
  },
  {
    id: 'version',
    accessorFn: (doc) => doc.versions[0]?.version ?? '',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Current version' />,
    cell: ({ getValue }) => <span className='font-mono'>{String(getValue())}</span>,
  },
  {
    accessorKey: 'nextReview',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Next review' />,
    cell: ({ row }) => <span className='font-mono'>{reviewLabel(row.original.nextReview)}</span>,
  },
]
