import type { ReactNode } from 'react'
import type { Asset, Criticality, Document } from '@/data/grc'
import { StatusDot } from '@/components/status-dot'

// Criticality and workflow statuses remain textual; tone supplies a secondary cue.
type Tone = 'pass' | 'warn' | 'fail' | 'erase' | 'ink'

const docStatus: Record<Document['status'], { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'ink' },
  'in review': { label: 'In review', tone: 'warn' },
  approved: { label: 'Approved', tone: 'pass' },
  expired: { label: 'Expired', tone: 'fail' },
}

const coverageLabel = {
  covered: { label: 'Covered', tone: 'pass' },
  partial: { label: 'Partial', tone: 'warn' },
  gap: { label: 'Gap', tone: 'fail' },
} as const satisfies Record<string, { label: string; tone: Tone }>

const criticalityLabel: Record<Criticality, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export const criticalityColor: Record<Criticality, string> = {
  high: 'var(--fail)',
  medium: 'var(--warn)',
  low: 'var(--ink-3)',
}

const criticalityTone: Record<Criticality, Tone> = {
  high: 'fail',
  medium: 'warn',
  low: 'ink',
}

const assetStatus: Record<Asset['status'], { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'pass' },
  maintenance: { label: 'Maintenance', tone: 'warn' },
  retired: { label: 'Retired', tone: 'ink' },
}

function StateBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <StatusDot tone={tone}>{children}</StatusDot>
}

export function DocStatusBadge({ status }: { status: Document['status'] }) {
  const { label, tone } = docStatus[status]
  return <StateBadge tone={tone}>{label}</StateBadge>
}

export function CoverageBadge({
  coverage,
}: {
  coverage: keyof typeof coverageLabel
}) {
  const { label, tone } = coverageLabel[coverage]
  return <StateBadge tone={tone}>{label}</StateBadge>
}

export function CriticalityBadge({
  criticality,
}: {
  criticality: Criticality
}) {
  return (
    <StateBadge tone={criticalityTone[criticality]}>
      {criticalityLabel[criticality]}
    </StateBadge>
  )
}

export function AssetStatusBadge({ status }: { status: Asset['status'] }) {
  const { label, tone } = assetStatus[status]
  return <StateBadge tone={tone}>{label}</StateBadge>
}

export function ReviewStatusBadge({
  days,
  date,
}: {
  days: number
  date?: string
}) {
  const overdue = days < 0
  const dueSoon = days >= 0 && days <= 30
  const label = overdue
    ? 'Overdue'
    : dueSoon
      ? days === 0
        ? 'Due today'
        : `Due in ${days} day${days === 1 ? '' : 's'}`
      : date
  return (
    <StateBadge tone={overdue ? 'fail' : dueSoon ? 'warn' : 'ink'}>
      {label}
    </StateBadge>
  )
}

export function FileTypeBadge({ type }: { type: 'PDF' | 'Excel' | 'None' }) {
  if (type === 'None') return <span>None</span>
  return (
    <span className='inline-flex border border-line px-1.5 py-0.5 font-mono text-[9px] leading-[1.4] text-ink-2 uppercase'>
      {type}
    </span>
  )
}
