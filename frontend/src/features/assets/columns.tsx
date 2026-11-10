import { Link } from '@tanstack/react-router'
import { type ColumnDef, type FilterFn } from '@tanstack/react-table'
import { assets, TODAY, type Asset, type Criticality } from '@/data/grc'
import { DataTableColumnHeader } from '@/components/data-table'
import {
  AssetStatusBadge,
  CriticalityBadge,
  ReviewStatusBadge,
} from '@/components/status-badge'

const DAY_MS = 86_400_000

// ponytail: 365-day rule is fixed; move to a per-site review policy when real schedules exist
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

const includesAny: FilterFn<Asset> = (row, columnId, value: string[]) =>
  value.includes(String(row.getValue(columnId)))

const uniqueOptions = (key: 'type' | 'sector' | 'purdueLevel') =>
  Array.from(new Set(assets.map((asset) => asset[key])))
    .sort()
    .map((value) => ({ label: value, value }))

export const assetFilterOptions = {
  sector: uniqueOptions('sector'),
  type: uniqueOptions('type'),
  purdueLevel: uniqueOptions('purdueLevel'),
  criticality: [
    { label: 'High', value: 'high' },
    { label: 'Medium', value: 'medium' },
    { label: 'Low', value: 'low' },
  ],
  status: [
    { label: statusLabel.active, value: 'active' },
    { label: statusLabel.maintenance, value: 'maintenance' },
    { label: statusLabel.retired, value: 'retired' },
  ],
}

export const assetColumns: ColumnDef<Asset>[] = [
  {
    accessorKey: 'id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='ID' />
    ),
    cell: ({ row }) => (
      <Link
        to='/assets/$assetId'
        params={{ assetId: row.original.id }}
        className='font-mono underline underline-offset-4'
      >
        {row.original.id}
      </Link>
    ),
  },
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Name' />
    ),
    cell: ({ row }) => <span className='font-medium'>{row.original.name}</span>,
  },
  {
    accessorKey: 'type',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Type' />
    ),
    filterFn: includesAny,
  },
  {
    accessorKey: 'site',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Site' />
    ),
  },
  {
    accessorKey: 'sector',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Sector' />
    ),
    filterFn: includesAny,
  },
  {
    accessorKey: 'purdueLevel',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Purdue level' />
    ),
    enableHiding: true,
    cell: ({ row }) => (
      <span className='font-mono'>{row.original.purdueLevel}</span>
    ),
    filterFn: includesAny,
  },
  {
    accessorKey: 'zone',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='IEC 62443 zone' />
    ),
  },
  {
    accessorKey: 'criticality',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Criticality' />
    ),
    cell: ({ row }) => (
      <CriticalityBadge criticality={row.original.criticality} />
    ),
    sortingFn: (rowA, rowB, columnId) =>
      criticalityRank[rowA.getValue<Criticality>(columnId)] -
      criticalityRank[rowB.getValue<Criticality>(columnId)],
    filterFn: includesAny,
  },
  {
    accessorKey: 'status',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Status' />
    ),
    cell: ({ row }) => <AssetStatusBadge status={row.original.status} />,
    filterFn: includesAny,
  },
  {
    accessorKey: 'lastReviewed',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Last reviewed' />
    ),
    cell: ({ row }) => (
      <div className='flex flex-wrap items-center gap-x-2'>
        <span className='font-mono tabular-nums'>
          {row.original.lastReviewed}
        </span>
        {isReviewOverdue(row.original.lastReviewed) && (
          <ReviewStatusBadge days={-1} />
        )}
      </div>
    ),
  },
]
