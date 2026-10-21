import { Badge } from '@/components/ui/badge'
import type { Criticality, Document } from '@/data/grc'

const docStatus: Record<
  Document['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  draft: { label: 'Draft', variant: 'outline' },
  'in review': { label: 'In review', variant: 'secondary' },
  approved: { label: 'Approved', variant: 'default' },
  expired: { label: 'Expired', variant: 'destructive' },
}

const coverageLabel = {
  covered: { label: 'Covered', variant: 'default' },
  partial: { label: 'Partial', variant: 'secondary' },
  gap: { label: 'Gap', variant: 'destructive' },
} as const

const criticalityLabel: Record<Criticality, string> = {
  high: 'High criticality',
  medium: 'Medium criticality',
  low: 'Low criticality',
}

export function DocStatusBadge({ status }: { status: Document['status'] }) {
  const { label, variant } = docStatus[status]
  return <Badge variant={variant}>{label}</Badge>
}

export function CoverageBadge({
  coverage,
}: {
  coverage: keyof typeof coverageLabel
}) {
  const { label, variant } = coverageLabel[coverage]
  return <Badge variant={variant}>{label}</Badge>
}

export function CriticalityBadge({ criticality }: { criticality: Criticality }) {
  return (
    <Badge variant={criticality === 'high' ? 'destructive' : 'secondary'}>
      {criticalityLabel[criticality]}
    </Badge>
  )
}
