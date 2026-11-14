import type { ColumnDef } from '@tanstack/react-table'
import type { Asset } from '@/data/grc'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function assetActionsColumn({
  canEditAll,
  canEditOwn,
  ownerLabel,
  canDelete,
  onEdit,
  onDelete,
}: {
  canEditAll: boolean
  canEditOwn: boolean
  ownerLabel: string | null
  canDelete: boolean
  onEdit: (asset: Asset) => void
  onDelete: (asset: Asset) => void
}): ColumnDef<Asset> {
  return {
    id: 'actions',
    size: 88,
    enableSorting: false,
    enableHiding: false,
    header: () => (
      <span className='font-mono text-[9px] tracking-[.08em] uppercase'>
        AKSI
      </span>
    ),
    cell: ({ row }) => {
      const asset = row.original
      const canEdit =
        canEditAll ||
        (canEditOwn && ownerLabel !== null && asset.owner === ownerLabel)
      return (
        <div className='flex justify-end gap-1'>
          {canEdit && (
            <Button
              type='button'
              variant='outline'
              size='icon'
              className='size-[30px] rounded-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
              aria-label={`Edit aset ${asset.id}`}
              onClick={(event) => {
                event.stopPropagation()
                onEdit(asset)
              }}
            >
              <Pencil aria-hidden='true' className='size-3.5' />
            </Button>
          )}
          {canDelete && (
            <Button
              type='button'
              variant='outline'
              size='icon'
              className='size-[30px] rounded-none text-fail focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fail'
              aria-label={`Hapus aset ${asset.id}`}
              onClick={(event) => {
                event.stopPropagation()
                onDelete(asset)
              }}
            >
              <Trash2 aria-hidden='true' className='size-3.5' />
            </Button>
          )}
        </div>
      )
    },
  }
}
