import { Link } from '@tanstack/react-router'
import { type ColumnDef } from '@tanstack/react-table'
import { type Document as GrcDocument } from '@/data/grc'
import { DataTableColumnHeader } from '@/components/data-table'
import { TitleCell } from './title-cell'
import { Chip } from '@/components/chip'
import { DocStatusBadge, ReviewStatusBadge } from '@/components/status-badge'
import {
  accessFor,
  daysUntil,
  isGrantOnly,
  reviewLabel,
} from '../helpers'

export type DocRow = GrcDocument

const DASH = '-'

export const documentColumns: ColumnDef<DocRow>[] = [
  {
    accessorKey: 'id',
    size: 84,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='ID' />
    ),
    cell: ({ row }) => (
      <Link
        to='/documents/$documentId'
        params={{ documentId: row.original.id }}
        className='font-mono text-[10px] font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus)]'
      >
        {row.original.id}
      </Link>
    ),
  },
  {
    accessorKey: 'title',
    size: 380,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Dokumen' />
    ),
    cell: ({ row }) => <TitleCell doc={row.original} />,
  },
  {
    id: 'status',
    size: 120,
    accessorFn: (doc) => doc.status,
    header: 'Status',
    cell: ({ row }) => (
      <span className='flex min-w-0 flex-wrap items-center gap-1'>
        <DocStatusBadge status={row.original.status} />
        {row.original.tokenOnly && (
          <span className='font-mono text-[8px] uppercase tracking-[.06em] text-ink-3'>
            Terkunci
          </span>
        )}
      </span>
    ),
  },
  {
    id: 'version',
    size: 56,
    accessorFn: (doc) => doc.versions[0]?.version ?? '',
    header: 'Versi',
    cell: ({ getValue }) => (
      <span className='font-mono text-[11px] tabular-nums text-ink-2'>
        {String(getValue()) || DASH}
      </span>
    ),
  },
  {
    id: 'nextReview',
    accessorFn: (doc) => doc.nextReview,
    size: 170,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Tinjauan' />
    ),
    cell: ({ row }) => (
      <span className='flex min-w-0 flex-col items-start gap-1 whitespace-nowrap'>
        <span className='font-mono text-[10px] tabular-nums text-ink-2'>
          {row.original.nextReview}
        </span>
        <ReviewStatusBadge
          days={daysUntil(row.original.nextReview)}
          date={reviewLabel(row.original.nextReview)}
        />
      </span>
    ),
  },
  {
    id: 'access',
    size: 72,
    accessorFn: (doc) => {
      const access = accessFor(doc)
      return access ? (access.permit ? 'Izin' : 'Tolak') : ''
    },
    header: 'Akses',
    cell: ({ row }) => {
      const access = accessFor(row.original)
      if (!access)
        return <span className='font-mono text-[11px] text-ink-3'>{DASH}</span>
      if (!access.permit) return <Chip tone='fail'>Tolak</Chip>
      return (
        <Chip tone={isGrantOnly(row.original.tlp) ? 'warn' : 'pass'}>
          {isGrantOnly(row.original.tlp) ? 'Grant' : 'Level'}
        </Chip>
      )
    },
  },
]
