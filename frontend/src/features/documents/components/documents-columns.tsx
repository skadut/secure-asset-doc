import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { type ColumnDef } from '@tanstack/react-table'
import { type Document as GrcDocument } from '@/data/grc'
import { Eye, EyeOff } from 'lucide-react'
import { explainAccess } from '@/lib/access-api'
import { getMe } from '@/lib/session'
import { DataTableColumnHeader } from '@/components/data-table'
import { TlpMark } from '@/components/tlp-mark'
import { DocStatusBadge, ReviewStatusBadge } from '@/components/status-badge'
import { daysUntil, reviewLabel } from '../helpers'

export type DocRow = GrcDocument

const DASH = '-'

// Server decides access; this only explains the result for the signed-in user. Null when no session.
export const accessFor = (doc: DocRow) => {
  const me = getMe()
  return me ? explainAccess(me, doc.tlp, doc.granted === true) : null
}

function TitleCell({ doc }: { doc: DocRow }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = expanded ? EyeOff : Eye
  return (
    <span className='flex min-w-0 items-start gap-1'>
      <button
        type='button'
        aria-label={
          expanded ? 'Sembunyikan judul lengkap' : 'Tampilkan judul lengkap'
        }
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className='-ms-1 inline-flex size-6 flex-none items-center justify-center text-ink-3 hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus)]'
      >
        <Icon className='size-3.5' aria-hidden='true' />
      </button>
      <span className='flex min-w-0 flex-col gap-0.5'>
        <Link
          to='/documents/$documentId'
          params={{ documentId: doc.id }}
          title={doc.title}
          className={`min-w-0 text-[12px] font-medium leading-[1.35] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus)] ${expanded ? 'break-words' : 'line-clamp-2'}`}
        >
          {doc.title}
        </Link>
        <TlpMark tlp={doc.tlp} />
      </span>
    </span>
  )
}

export const documentColumns: ColumnDef<DocRow>[] = [
  {
    accessorKey: 'id',
    size: 104,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='ID' />
    ),
    cell: ({ row }) => (
      <Link
        to='/documents/$documentId'
        params={{ documentId: row.original.id }}
        className='font-mono text-[11px] font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--focus)]'
      >
        {row.original.id}
      </Link>
    ),
  },
  {
    accessorKey: 'title',
    size: 360,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Dokumen' />
    ),
    cell: ({ row }) => <TitleCell doc={row.original} />,
  },
  {
    id: 'status',
    size: 132,
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
        {row.original.granted && (
          <span className='font-mono text-[8px] uppercase tracking-[.06em] text-ink-3'>
            Diberikan
          </span>
        )}
      </span>
    ),
  },
  {
    id: 'version',
    size: 68,
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
    size: 188,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Tinjauan' />
    ),
    cell: ({ row }) => (
      <span className='flex min-w-0 items-center gap-1.5 whitespace-nowrap'>
        <span className='font-mono text-[11px] tabular-nums text-ink-2'>
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
    size: 84,
    accessorFn: (doc) => {
      const access = accessFor(doc)
      return access ? (access.permit ? 'Izin' : 'Tolak') : ''
    },
    header: 'Akses',
    cell: ({ row }) => {
      const access = accessFor(row.original)
      if (!access)
        return <span className='font-mono text-[11px] text-ink-3'>{DASH}</span>
      return (
        <span
          className={`font-mono text-[9px] uppercase tracking-[.06em] ${access.permit ? 'text-pass' : 'text-fail'}`}
        >
          {access.permit ? 'Izin' : 'Tolak'}
        </span>
      )
    },
  },
]
