import { Link } from '@tanstack/react-router'
import { type ColumnDef, type FilterFn } from '@tanstack/react-table'
import { assets, TODAY, type Asset, type Criticality } from '@/data/grc'
import { DataTableColumnHeader } from '@/components/data-table'
import { StatusDot } from '@/components/status-dot'

const DAY_MS = 86_400_000

// ponytail: fixed 365-day review threshold; replace when asset-specific schedules exist.
export const isReviewOverdue = (lastReviewed: string) =>
  (Date.parse(TODAY) - Date.parse(lastReviewed)) / DAY_MS > 365

export const statusLabel: Record<Asset['status'], string> = {
  active: 'Active',
  maintenance: 'Maintenance',
  retired: 'Retired',
}

const criticalityRank: Record<Criticality, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export const includesAny: FilterFn<Asset> = (row, columnId, value: string) =>
  value === '' || String(row.getValue(columnId)) === value

const uniqueOptions = (key: 'type' | 'sector' | 'purdueLevel') =>
  [...new Set(assets.map((asset) => asset[key]))].sort()

export const assetFilterOptions = {
  sector: uniqueOptions('sector'),
  type: uniqueOptions('type'),
  purdueLevel: uniqueOptions('purdueLevel'),
  criticality: ['high', 'medium', 'low'] as const,
  status: ['active', 'maintenance', 'retired'] as const,
}

const criticalityTone: Record<Criticality, 'fail' | 'warn' | 'ink'> = {
  high: 'fail',
  medium: 'warn',
  low: 'ink',
}

export const criticalityLabel: Record<Criticality, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export const assetColumns: ColumnDef<Asset>[] = [
  {
    accessorKey: 'id',
    size: 112,
    header: ({ column }) => <DataTableColumnHeader column={column} title='ID' />,
    cell: ({ row }) => (
      <Link to='/assets/$assetId' params={{ assetId: row.original.id }} className='font-mono text-[10px] underline underline-offset-4'>
        {row.original.id}
      </Link>
    ),
  },
  {
    accessorKey: 'name',
    size: 486,
    header: ({ column }) => <DataTableColumnHeader column={column} title='NAMA' />,
    cell: ({ row }) => <span className='font-medium text-ink'>{row.original.name}</span>,
  },
  {
    accessorKey: 'type',
    size: 180,
    header: ({ column }) => <DataTableColumnHeader column={column} title='TIPE' />,
    filterFn: includesAny,
  },
  {
    accessorKey: 'site',
    size: 160,
    header: ({ column }) => <DataTableColumnHeader column={column} title='SITE' />,
  },
  {
    accessorKey: 'purdueLevel',
    size: 74,
    header: ({ column }) => <DataTableColumnHeader column={column} title='PURDUE' />,
    cell: ({ row }) => <span className='font-mono tabular-nums'>{row.original.purdueLevel}</span>,
    filterFn: includesAny,
  },
  {
    accessorKey: 'criticality',
    size: 126,
    header: ({ column }) => <DataTableColumnHeader column={column} title='KRITIKALITAS' />,
    cell: ({ row }) => <StatusDot tone={criticalityTone[row.original.criticality]}>{criticalityLabel[row.original.criticality]}</StatusDot>,
    sortingFn: (rowA, rowB, columnId) => criticalityRank[rowA.getValue<Criticality>(columnId)] - criticalityRank[rowB.getValue<Criticality>(columnId)],
    filterFn: includesAny,
  },
  {
    accessorKey: 'status',
    size: 112,
    header: ({ column }) => <DataTableColumnHeader column={column} title='STATUS' />,
    cell: ({ row }) => <StatusDot tone={row.original.status === 'active' ? 'pass' : row.original.status === 'maintenance' ? 'warn' : 'ink'}>{statusLabel[row.original.status]}</StatusDot>,
    filterFn: includesAny,
  },
  {
    accessorKey: 'lastReviewed',
    size: 166,
    header: ({ column }) => <DataTableColumnHeader column={column} title='TINJAUAN' />,
    cell: ({ row }) => {
      const overdue = isReviewOverdue(row.original.lastReviewed)
      return (
        <div className='flex flex-col gap-0.5'>
          <time className='font-mono text-[9.5px] tabular-nums text-ink-2' dateTime={row.original.lastReviewed}>{row.original.lastReviewed}</time>
          <span className={`font-mono text-[7.5px] ${overdue ? 'text-fail' : 'text-ink-3'}`}>{overdue ? 'Terlambat' : 'Dalam 365 hari'}</span>
        </div>
      )
    },
  },
]
