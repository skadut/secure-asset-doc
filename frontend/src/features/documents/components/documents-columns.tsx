import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { type ColumnDef } from '@tanstack/react-table'
import { Eye, EyeOff } from 'lucide-react'
import { DataTableColumnHeader } from '@/components/data-table'
import { DocStatusBadge, ReviewStatusBadge } from '@/components/status-badge'
import { TlpBadge } from '@/components/tlp-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { type Document as GrcDocument } from '@/data/grc'
import { explainAccess } from '@/lib/access-api'
import { getMe } from '@/lib/session'
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
    <span className='flex min-w-0 items-center gap-2'>
      <Link
        to='/documents/$documentId'
        params={{ documentId: doc.id }}
        title={doc.title}
        className={expanded
          ? 'min-w-0 flex-1 whitespace-normal break-words font-medium underline underline-offset-4'
          : 'min-w-0 flex-1 line-clamp-2 whitespace-normal break-words font-medium underline underline-offset-4'}
      >
        {doc.title}
      </Link>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='shrink-0 flex-none whitespace-nowrap size-11 md:size-8'
        aria-label={expanded ? 'Sembunyikan judul lengkap' : 'Tampilkan judul lengkap'}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Icon />
      </Button>
      {doc.tokenOnly && <Badge variant='outline' className='shrink-0 flex-none whitespace-nowrap'>Terkunci</Badge>}
      {doc.granted && <Badge variant='outline' className='shrink-0 flex-none whitespace-nowrap'>Diberikan</Badge>}
      <span className='shrink-0 flex-none whitespace-nowrap'>
        <DocStatusBadge status={doc.status} />
      </span>
    </span>
  )
}

export const documentColumns: ColumnDef<DocRow>[] = [
  {
    accessorKey: 'id',
    size: 120,
    header: ({ column }) => <DataTableColumnHeader column={column} title='ID' />,
    cell: ({ row }) => (
      <Link
        to='/documents/$documentId'
        params={{ documentId: row.original.id }}
        className='font-mono text-sm font-medium underline underline-offset-4'
      >
        {row.original.id}
      </Link>
    ),
  },
  {
    accessorKey: 'title',
    size: 360,
    header: ({ column }) => <DataTableColumnHeader column={column} title='Judul dan status' />,
    cell: ({ row }) => <TitleCell doc={row.original} />,
  },
  {
    accessorKey: 'tlp',
    size: 168,
    header: 'TLP',
    cell: ({ row }) => <TlpBadge tlp={row.original.tlp} />,
  },
  {
    id: 'version',
    size: 80,
    accessorFn: (doc) => doc.versions[0]?.version ?? '',
    header: 'Versi',
    cell: ({ getValue }) => <span className='font-mono'>{String(getValue()) || DASH}</span>,
  },
  {
    id: 'nextReview',
    accessorFn: (doc) => doc.nextReview,
    size: 200,
    header: ({ column }) => <DataTableColumnHeader column={column} title='Tinjauan berikutnya' />,
    cell: ({ row }) => (
      <span className='flex min-w-0 items-center gap-2 whitespace-nowrap overflow-hidden'>
        <span className='font-mono tabular-nums'>{row.original.nextReview}</span>
        <ReviewStatusBadge days={daysUntil(row.original.nextReview)} date={reviewLabel(row.original.nextReview)} />
      </span>
    ),
  },
  {
    id: 'access',
    size: 96,
    accessorFn: (doc) => {
      const access = accessFor(doc)
      return access ? (access.permit ? 'Izin' : 'Tolak') : ''
    },
    header: 'Akses',
    cell: ({ row }) => {
      const access = accessFor(row.original)
      if (!access) return DASH
      return (
        <span className={access.permit ? 'text-sm text-pass' : 'text-sm text-fail'}>
          {access.permit ? 'Izin' : 'Tolak'}
        </span>
      )
    },
  },
]
