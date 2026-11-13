import { Link } from '@tanstack/react-router'
import { type ColumnDef } from '@tanstack/react-table'
import { type Document as GrcDocument } from '@/data/grc'
import { DataTableColumnHeader } from '@/components/data-table'
import { StatusDot } from '@/components/status-dot'
import { accessFor, daysUntil, isGrantOnly, reviewLabel } from '../helpers'
import { TitleCell } from './title-cell'

export type DocRow = GrcDocument

const DASH = '-'

export const documentColumns: ColumnDef<DocRow>[] = [
  {
    accessorKey: 'id',
    size: 76,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='ID' />
    ),
    cell: ({ row }) => (
      <Link
        to='/documents/$documentId'
        params={{ documentId: row.original.id }}
        className='font-mono text-[10px] text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus)]'
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
    size: 84,
    accessorFn: (doc) => doc.status,
    header: 'Status',
    cell: ({ row }) => (
      <span className='flex min-w-0 flex-wrap items-center gap-1'>
        <StatusDot
          tone={
            row.original.status === 'approved'
              ? 'pass'
              : row.original.status === 'in review'
                ? 'warn'
                : row.original.status === 'expired'
                  ? 'fail'
                  : 'ink'
          }
        >
          {row.original.status === 'in review'
            ? 'In review'
            : row.original.status === 'approved'
              ? 'Approved'
              : row.original.status === 'expired'
                ? 'Expired'
                : 'Draft'}
        </StatusDot>
        {row.original.tokenOnly && (
          <span className='font-mono text-[8px] tracking-[.06em] text-ink-3 uppercase'>
            Terkunci
          </span>
        )}
      </span>
    ),
  },
  {
    id: 'version',
    size: 50,
    accessorFn: (doc) => doc.versions[0]?.version ?? '',
    header: 'Versi',
    cell: ({ getValue }) => (
      <span className='font-mono text-[10px] text-ink tabular-nums'>
        {String(getValue()) || DASH}
      </span>
    ),
  },
  {
    id: 'nextReview',
    accessorFn: (doc) => doc.nextReview,
    size: 100,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Tinjauan' />
    ),
    cell: ({ row }) => (
      <span className='flex min-w-0 flex-col items-start gap-0.5 whitespace-nowrap'>
        <span className='font-mono text-[9.5px] text-ink tabular-nums'>
          {row.original.nextReview}
        </span>
        <span
          className={`font-mono text-[8.5px] tabular-nums ${daysUntil(row.original.nextReview) < 0 ? 'text-fail' : daysUntil(row.original.nextReview) <= 30 ? 'text-warn' : 'text-ink-3'}`}
        >
          {reviewLabel(row.original.nextReview)}
        </span>
      </span>
    ),
  },
  {
    id: 'access',
    size: 54,
    accessorFn: (doc) => {
      const access = accessFor(doc)
      return access ? (access.permit ? 'Izin' : 'Tolak') : ''
    },
    header: 'Akses',
    cell: ({ row }) => {
      const access = accessFor(row.original)
      if (!access)
        return <span className='font-mono text-[10px] text-ink-3'>{DASH}</span>
      if (!access.permit)
        return (
          <span className='inline-flex border border-fail px-1.5 py-0.5 font-mono text-[7.5px] tracking-[.03em] text-fail uppercase'>
            Tolak
          </span>
        )
      const grantOnly = isGrantOnly(row.original.tlp)
      return (
        <span
          className={`inline-flex border px-1.5 py-0.5 font-mono text-[7.5px] tracking-[.03em] uppercase ${grantOnly ? 'border-pass text-pass' : 'border-ink-3 text-ink-3'}`}
        >
          {grantOnly ? 'Grant' : 'Level'}
        </span>
      )
    },
  },
]
